import type { Browser } from 'playwright';
import type { BatchManifest, CaptureConfig, RunMetadata } from '../contracts.js';
import { launchBrowser } from '../browser/launch.js';
import { hashJson, newAttemptId, newRunId, queryAttemptIdFor, queryIdFor } from '../ids.js';
import { attemptRelativeDir, isoWithOffset } from '../naming.js';
import { LocalArtifactStore } from '../storage/local.js';
import { createManifest, exitCodeFor, finalizeManifest, markRunning, markSkipped, recordQueryAttempt } from './manifest.js';
import { runQueryAttempt, TransientBrowserError, type QueryRunnerDeps } from './query-runner.js';

export const ADAPTER_VERSION = 'maps-feed-card/v1';

export interface BatchDeps {
  config: CaptureConfig;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
  launch?: () => Promise<Browser>;
  searchUrlFor?: (keyword: string) => string;
  openSearchImpl?: QueryRunnerDeps['openSearchImpl'];
  signal?: AbortSignal;
}

export interface BatchOutput { manifest: BatchManifest; attemptRoot: string; manifestPath: string; exitCode: 0 | 1 | 2 }

export function batchDeadlineMs(config: CaptureConfig): number {
  const n = config.keywords.length;
  return (60 + n * (config.keywordTimeoutMs / 1000 + 30) + 60) * 1000;
}

export async function runBatch(deps: BatchDeps): Promise<BatchOutput> {
  const { config } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const startedAtDate = now();
  const runId = newRunId(startedAtDate);
  const attemptId = newAttemptId();
  const tz = config.filenameTimezone;
  const store = new LocalArtifactStore(config.outputDirectory);
  const attemptRel = attemptRelativeDir(startedAtDate, tz, runId, attemptId);
  const attemptRoot = store.absolutePath(attemptRel);
  const metadata: RunMetadata = {
    configHash: hashJson(config),
    profileHash: hashJson({ surface: 'google-maps-desktop', locale: config.locale, browserTimezoneId: config.browserTimezoneId, viewport: config.viewport, deviceScaleFactor: 1, locationMode: 'query_only', adapterVersion: ADAPTER_VERSION }),
    adapterVersion: ADAPTER_VERSION,
    sourceCommit: process.env['GIT_COMMIT'] ?? null,
    browserVersion: null,
    imageDigest: process.env['IMAGE_DIGEST'] ?? null,
    egressProfileId: process.env['EGRESS_PROFILE_ID'] ?? null,
  };
  const startedAt = isoWithOffset(startedAtDate, tz);
  await store.writeFile(`${attemptRel}/request.json`, JSON.stringify({ runId, attemptId, startedAt, config }, null, 2));

  let manifest = createManifest({ runId, attemptId, startedAt, metadata, persistenceMode: 'local_only', keywords: config.keywords });
  const writeProgress = () => store.writeFile(`${attemptRel}/manifest.progress.json`, JSON.stringify(manifest, null, 2));
  const writeFinal = () => store.writeFile(`${attemptRel}/manifest.json`, JSON.stringify(manifest, null, 2));
  await writeProgress();
  log({ stage: 'batch_start', runId, attemptId, keywords: config.keywords.length, attemptRoot });

  let browser: Browser;
  try {
    browser = await (deps.launch ?? launchBrowser)();
  } catch (err) {
    log({ stage: 'browser_startup_failed', runId, attemptId, message: (err as Error).message });
    for (const q of manifest.queries) manifest = markSkipped(manifest, q.queryId, 'browser_startup_failed');
    manifest = finalizeManifest(manifest, isoWithOffset(now(), tz));
    await writeFinal();
    return { manifest, attemptRoot, manifestPath: store.absolutePath(`${attemptRel}/manifest.json`), exitCode: exitCodeFor(manifest) };
  }
  manifest = { ...manifest, metadata: { ...metadata, browserVersion: browser.version() } };

  const batchDeadlineAt = startedAtDate.getTime() + batchDeadlineMs(config);
  let breaker = false;
  try {
    for (const [inputIndex, keyword] of config.keywords.entries()) {
      const queryId = queryIdFor(inputIndex);
      if (deps.signal?.aborted) { manifest = markSkipped(manifest, queryId, 'cancelled'); await writeProgress(); continue; }
      if (breaker) { manifest = markSkipped(manifest, queryId, 'batch_blocked'); await writeProgress(); continue; }
      if (Date.now() > batchDeadlineAt) { manifest = markSkipped(manifest, queryId, 'batch_timeout'); await writeProgress(); continue; }

      manifest = markRunning(manifest, queryId);
      const keywordDeadline = Math.min(Date.now() + config.keywordTimeoutMs, batchDeadlineAt);
      const runnerDeps: QueryRunnerDeps = {
        browser, store, config, runId, attemptId, metadata: manifest.metadata, attemptRelativeDir: attemptRel, now, log,
        ...(deps.searchUrlFor ? { searchUrlFor: deps.searchUrlFor } : {}),
        ...(deps.openSearchImpl ? { openSearchImpl: deps.openSearchImpl } : {}),
      };
      let attemptNumber = 1;
      let allowTransientThrow = keywordDeadline - Date.now() > 15_000;
      for (;;) {
        try {
          const out = await runQueryAttempt(runnerDeps, { queryId, inputIndex, keyword, queryAttemptId: queryAttemptIdFor(attemptNumber), deadlineAt: keywordDeadline, allowTransientThrow });
          manifest = recordQueryAttempt(manifest, queryId, out.summary, out.artifacts);
          if (out.summary.status === 'blocked' && out.summary.stopReason === 'captcha') breaker = true;
          break;
        } catch (err) {
          if (err instanceof TransientBrowserError && attemptNumber === 1) {
            log({ stage: 'retry', queryId, message: err.message });
            attemptNumber = 2;
            allowTransientThrow = false;
            continue;
          }
          throw err;
        }
      }
      await writeProgress();
      const row = manifest.queries.find((q) => q.queryId === queryId);
      log({ stage: 'query_done', queryId, status: row?.status, stopReason: row?.stopReason });
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  manifest = finalizeManifest(manifest, isoWithOffset(now(), tz));
  await writeFinal();
  log({ stage: 'batch_done', runId, attemptId, status: manifest.status });
  return { manifest, attemptRoot, manifestPath: store.absolutePath(`${attemptRel}/manifest.json`), exitCode: exitCodeFor(manifest) };
}
