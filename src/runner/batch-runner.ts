import type { Browser } from 'playwright';
import type { Artifact, BatchManifest, CaptureConfig, ManifestDeliveryReceipt, RunMetadata, SkipReason } from '../contracts.js';
import { launchBrowser } from '../browser/launch.js';
import { hashJson, newAttemptId, newRunId, queryAttemptIdFor, queryIdFor } from '../ids.js';
import { attemptRelativeDir, isoWithOffset } from '../naming.js';
import { LocalArtifactStore } from '../storage/local.js';
import type { ArtifactStore } from '../storage/types.js';
import { createManifest, exitCodeFor, finalizeManifest, markRunning, markSkipped, recordBatchArtifact, recordQueryAttempt } from './manifest.js';
import { runQueryAttempt, TransientBrowserError, type QueryRunnerDeps } from './query-runner.js';

export const ADAPTER_VERSION = 'maps-feed-card/v4';
/** A layout the adapter cannot read on this many keywords in a row is treated as global (design §9). */
export const UNSUPPORTED_LAYOUT_STREAK = 3;
/** A hung browser close must not keep the final manifest from being published. */
export const BROWSER_CLOSE_TIMEOUT_MS = 10_000;

export interface BatchDeps {
  config: CaptureConfig;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
  launch?: () => Promise<Browser>;
  searchUrlFor?: (keyword: string) => string;
  openSearchImpl?: QueryRunnerDeps['openSearchImpl'];
  signal?: AbortSignal;
  /** Consecutive unsupported layouts from the preceding daily batch. Defaults to zero. */
  initialUnsupportedLayoutStreak?: number;
  /** Where artifacts are written and delivered. Defaults to local disk under config.outputDirectory. */
  store?: ArtifactStore;
}

export interface BatchOutput {
  manifest: BatchManifest;
  attemptRoot: string;
  manifestPath: string;
  /** Delivery receipt for manifest.json in remote mode; null in local mode or if it could not be written. */
  manifestReceipt: ManifestDeliveryReceipt | null;
  exitCode: 0 | 1 | 2;
}

/** A terminal manifest was published before an operational exception escaped the batch. */
export class BatchExecutionError extends Error {
  constructor(cause: unknown, readonly output: BatchOutput) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'BatchExecutionError';
  }
}

export function batchDeadlineMs(config: CaptureConfig): number {
  const n = config.keywords.length;
  return (60 + n * (config.keywordTimeoutMs / 1000 + 30) + 60) * 1000;
}

export async function closeWithin(browser: Pick<Browser, 'close'>, timeoutMs: number): Promise<'closed' | 'timed_out'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timed_out'>((resolve) => { timer = setTimeout(() => resolve('timed_out'), timeoutMs); });
  try {
    return await Promise.race([browser.close().then(() => 'closed' as const, () => 'closed' as const), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runBatch(deps: BatchDeps): Promise<BatchOutput> {
  const { config } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const startedAtDate = now();
  const runId = newRunId(startedAtDate);
  const attemptId = newAttemptId();
  const tz = config.filenameTimezone;
  const store = deps.store ?? new LocalArtifactStore(config.outputDirectory);
  const attemptRel = attemptRelativeDir(startedAtDate, tz, runId, attemptId);
  const attemptRoot = store.absolutePath(attemptRel);
  const manifestPath = store.absolutePath(`${attemptRel}/manifest.json`);
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
  let manifest = createManifest({ runId, attemptId, startedAt, metadata, persistenceMode: store.mode, keywords: config.keywords });

  // request.json is also the storage preflight: nothing is launched if it cannot be delivered.
  const requestWritten = await store.writeFile(`${attemptRel}/request.json`, JSON.stringify({ runId, attemptId, startedAt, config }, null, 2));
  const requestState = await store.persist(requestWritten);
  const requestArtifact: Artifact = {
    ...requestState, id: 'request_json', filename: 'request.json', kind: 'request_json',
    bytes: requestWritten.bytes, sha256: requestWritten.sha256, queryId: null, queryAttemptId: null,
  };
  manifest = recordBatchArtifact(manifest, requestArtifact);

  let progressWarned = false;
  const writeProgress = async () => {
    const written = await store.writeFile(`${attemptRel}/manifest.progress.json`, JSON.stringify(manifest, null, 2));
    const state = await store.persist(written, { mutable: true });
    if (state.storageStatus === 'failed' && !progressWarned) {
      progressWarned = true;
      log({ stage: 'progress_persist_failed', runId, attemptId, code: state.storageError.code, message: state.storageError.message });
    }
  };

  const finish = async (): Promise<BatchOutput> => {
    manifest = finalizeManifest(manifest, isoWithOffset(now(), tz));
    let receipt: ManifestDeliveryReceipt | null = null;
    try {
      const written = await store.writeFile(`${attemptRel}/manifest.json`, JSON.stringify(manifest, null, 2));
      if (store.mode !== 'local_only') {
        // The terminal record always gets one bounded attempt, even after the store has fast-failed.
        const state = await store.persist(written, { alwaysAttempt: true });
        receipt = { ...state, runId, attemptId, filename: 'manifest.json', bytes: written.bytes, sha256: written.sha256 };
        log({ stage: 'manifest_published', runId, attemptId, storageStatus: receipt.storageStatus, objectKey: receipt.objectKey, bytes: receipt.bytes, sha256: receipt.sha256 });
      }
    } catch (err) {
      log({ stage: 'manifest_write_failed', runId, attemptId, message: err instanceof Error ? err.message : String(err) });
    }
    log({ stage: 'batch_done', runId, attemptId, status: manifest.status });
    return { manifest, attemptRoot, manifestPath, manifestReceipt: receipt, exitCode: exitCodeFor(manifest, receipt) };
  };

  await writeProgress();
  log({ stage: 'batch_start', runId, attemptId, keywords: config.keywords.length, attemptRoot, storage: store.mode });

  if (requestState.storageStatus === 'failed') {
    log({ stage: 'storage_unavailable', runId, attemptId, code: requestState.storageError.code, message: requestState.storageError.message });
    for (const q of manifest.queries) manifest = markSkipped(manifest, q.queryId, 'storage_unavailable');
    return finish();
  }

  let browser: Browser;
  try {
    browser = await (deps.launch ?? launchBrowser)();
  } catch (err) {
    log({ stage: 'browser_startup_failed', runId, attemptId, message: (err as Error).message });
    for (const q of manifest.queries) manifest = markSkipped(manifest, q.queryId, 'browser_startup_failed');
    return finish();
  }
  manifest = { ...manifest, metadata: { ...metadata, browserVersion: browser.version() } };

  const batchDeadlineAt = startedAtDate.getTime() + batchDeadlineMs(config);
  const skipRemaining = (reason: SkipReason) => {
    for (const q of manifest.queries) {
      if (q.status === 'pending' || q.status === 'running') manifest = markSkipped(manifest, q.queryId, reason);
    }
  };
  let breaker = false;
  let batchStop: SkipReason | null = null;
  let unsupportedStreak = deps.initialUnsupportedLayoutStreak ?? 0;
  let output: BatchOutput | undefined;
  let failure: { cause: unknown } | undefined;
  try {
    for (const [inputIndex, keyword] of config.keywords.entries()) {
      const queryId = queryIdFor(inputIndex);
      if (batchStop === 'storage_unavailable') { skipRemaining(batchStop); break; }
      // Any other stop skips every remaining row at once, with a single checkpoint.
      const stopReason: SkipReason | null = batchStop
        ?? (deps.signal?.aborted ? 'cancelled' : breaker ? 'batch_blocked' : Date.now() > batchDeadlineAt ? 'batch_timeout' : null);
      if (stopReason) { skipRemaining(stopReason); await writeProgress(); break; }

      manifest = markRunning(manifest, queryId);
      const keywordDeadline = Math.min(Date.now() + config.keywordTimeoutMs, batchDeadlineAt);
      const runnerDeps: QueryRunnerDeps = {
        browser, store, config, runId, attemptId, metadata: manifest.metadata, attemptRelativeDir: attemptRel, now, log,
        ...(deps.searchUrlFor ? { searchUrlFor: deps.searchUrlFor } : {}),
        ...(deps.openSearchImpl ? { openSearchImpl: deps.openSearchImpl } : {}),
        ...(deps.signal ? { signal: deps.signal } : {}),
      };
      let attemptNumber = 1;
      let allowTransientThrow = keywordDeadline - Date.now() > 15_000;
      try {
        for (;;) {
          try {
            const out = await runQueryAttempt(runnerDeps, { queryId, inputIndex, keyword, queryAttemptId: queryAttemptIdFor(attemptNumber), deadlineAt: keywordDeadline, allowTransientThrow });
            manifest = recordQueryAttempt(manifest, queryId, out.summary, out.artifacts);
            // Any blocked outcome, CAPTCHA or an unresolved consent wall, means the session cannot
            // collect; do not push the rest of the batch through it.
            if (out.summary.status === 'blocked') breaker = true;
            unsupportedStreak = out.summary.stopReason === 'unsupported_layout' ? unsupportedStreak + 1 : 0;
            if (unsupportedStreak >= UNSUPPORTED_LAYOUT_STREAK && !batchStop) {
              batchStop = 'unsupported_layout';
              log({ stage: 'layout_breaker', runId, attemptId, queryId, streak: unsupportedStreak });
            }
            if (store.mode !== 'local_only' && out.artifacts.length > 0 && !out.artifacts.some((a) => a.storageStatus === 'verified')) {
              batchStop = 'storage_unavailable';
              log({ stage: 'storage_unavailable', runId, attemptId, queryId });
            }
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
        log({ stage: 'query_done', queryId, status: row?.status, stopReason: row?.stopReason, persistence: row?.persistenceStatus });
      } catch (err) {
        // runQueryAttempt records its own terminal result for everything it can observe, so an
        // exception here means the browser or the store is gone. Keep the row terminal either way.
        const message = err instanceof Error ? err.message : String(err);
        log({ stage: 'query_error', runId, attemptId, queryId, message });
        const browserGone = /Target (page|context|browser) has been closed|browser has been closed|has been closed|crashed|disconnected/i.test(message);
        const reason: SkipReason = browserGone ? 'browser_startup_failed' : 'storage_unavailable';
        const row = manifest.queries.find((q) => q.queryId === queryId);
        if (row && (row.status === 'pending' || row.status === 'running')) manifest = markSkipped(manifest, queryId, reason);
        await writeProgress().catch(() => undefined);
        if (browserGone) { batchStop = reason; continue; }
        skipRemaining(reason);
        throw err;
      }
    }
  } catch (cause) {
    failure = { cause };
  } finally {
    if (await closeWithin(browser, BROWSER_CLOSE_TIMEOUT_MS) === 'timed_out') log({ stage: 'browser_close_timeout', runId, attemptId });
    output = await finish();
  }
  if (!output) throw new Error('batch finished without publishing a manifest');
  if (failure) throw new BatchExecutionError(failure.cause, output);
  return output;
}
