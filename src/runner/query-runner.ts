import type { Browser, BrowserContext, Page } from 'playwright';
import type {
  Artifact, CaptureConfig, CaptureError, CollectionOutcome, KeywordResult, Observation, QueryAttemptSummary, QueryQuality, RunMetadata, ScreenshotArtifact,
} from '../contracts.js';
import { classifyCard } from '../core/classify.js';
import { classifyFeedChildren, isCard } from '../core/feed-model.js';
import { deriveOutcome, type StopCause } from '../core/outcome.js';
import { assignRanks, toListing } from '../core/ranking.js';
import { applyRound, createReconcileState, type ReconcileState } from '../core/reconcile.js';
import type { ClassifiedCard, FeedSnapshot } from '../core/types.js';
import { resultToCsv } from '../export/csv.js';
import { observationIdFor } from '../ids.js';
import { isoWithOffset, queryAttemptRelativeDir, resultBaseName, screenshotFileName } from '../naming.js';
import { newSearchContext } from '../browser/launch.js';
import {
  buildSearchUrl, hasQuerySignal, nextScrollTop, openSearch, queryMatches, scrollFeedTo, waitForFeedChange,
} from '../browser/maps-adapter.js';
import { captureStableObservation } from '../browser/stability.js';
import type { ArtifactStore } from '../storage/types.js';

export const ARTIFACT_BUDGET_BYTES = 50 * 1024 * 1024;

export class TransientBrowserError extends Error {
  constructor(message: string, readonly cause?: unknown) { super(message); this.name = 'TransientBrowserError'; }
}

export interface QueryRunnerDeps {
  browser: Browser;
  store: ArtifactStore;
  config: CaptureConfig;
  runId: string;
  attemptId: string;
  metadata: RunMetadata;
  attemptRelativeDir: string;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
  searchUrlFor?: (keyword: string) => string;
  openSearchImpl?: typeof openSearch;
  /** Cancellation reaches the results loop, so an in-flight keyword stops at its verified prefix. */
  signal?: AbortSignal;
}

export interface QueryAttemptInput {
  queryId: string; inputIndex: number; keyword: string; queryAttemptId: string;
  deadlineAt: number; allowTransientThrow: boolean;
}

export interface QueryAttemptOutput {
  result: KeywordResult; summary: QueryAttemptSummary; artifacts: Artifact[]; resultFile: string;
}

type Warning = QueryQuality['warnings'][number];

function parseObservedMapView(url: string | null): KeywordResult['context']['observedMapView'] {
  if (!url) return null;
  const m = /@(-?\d+\.\d+),(-?\d+\.\d+)(?:,(\d+(?:\.\d+)?)z)?/.exec(url);
  if (!m) return null;
  return { latitude: Number(m[1]), longitude: Number(m[2]), zoom: m[3] ? Number(m[3]) : null };
}

function errorOf(err: unknown, code: string): CaptureError {
  return { code, message: err instanceof Error ? err.message : String(err) };
}

/** Coverage key for a card. classifyCard always assigns an occurrenceId; the contract allows null for raw cards. */
function occKey(card: { occurrenceId: string | null; feedChildIndex: number }): string {
  return card.occurrenceId ?? `feed-child:${card.feedChildIndex}`;
}

export async function runQueryAttempt(deps: QueryRunnerDeps, input: QueryAttemptInput): Promise<QueryAttemptOutput> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const { config, store } = deps;
  const startedAtDate = now();
  const startedMs = startedAtDate.getTime();
  const tz = config.filenameTimezone;
  const base = resultBaseName(startedAtDate, tz, input.keyword, input.queryId);
  const qdir = queryAttemptRelativeDir(input.queryId, input.queryAttemptId);
  const rel = (name: string) => `${deps.attemptRelativeDir}/${qdir}/${name}`;
  const limit = config.maxResultsPerKeyword;
  const remaining = () => input.deadlineAt - Date.now();
  const stage = (name: string, extra: Record<string, unknown> = {}) =>
    log({ stage: name, runId: deps.runId, attemptId: deps.attemptId, queryId: input.queryId, queryAttemptId: input.queryAttemptId, elapsedMs: Date.now() - startedMs, ...extra });

  const screenshots: ScreenshotArtifact[] = [];
  const observations: Observation[] = [];
  const artifacts: Artifact[] = [];
  const warnings: Warning[] = [];
  const coverage = new Map<string, string[]>();
  let bytesWritten = 0;
  let state: ReconcileState = createReconcileState();
  let stop: StopCause | null = null;
  let finalUrl: string | null = null;
  let observedQueryText: string | null = null;

  async function saveScreenshot(png: Buffer, kind: 'results' | 'diagnostic', observationId: string | null): Promise<ScreenshotArtifact> {
    const n = screenshots.filter((s) => s.kind === 'results').length + 1;
    const filename = kind === 'results' ? screenshotFileName(base, n) : `${base}__diag.png`;
    const written = await store.writeFile(rel(filename), png);
    bytesWritten += written.bytes;
    const storage = await store.persist(written);
    const shot: ScreenshotArtifact = {
      ...storage,
      id: kind === 'results' ? `${input.queryAttemptId}_shot${String(n).padStart(2, '0')}` : `${input.queryAttemptId}_diag`,
      filename, kind, bytes: written.bytes, sha256: written.sha256,
      queryId: input.queryId, queryAttemptId: input.queryAttemptId,
      capturedAt: isoWithOffset(now(), tz), width: config.viewport.width, height: config.viewport.height, observationId,
    };
    screenshots.push(shot);
    artifacts.push(shot);
    return shot;
  }

  let context: BrowserContext | null = null;
  try {
    // Inside the try: a browser crash here is a transient failure like any other, not an
    // exception that escapes before the attempt can record its own terminal result.
    context = await newSearchContext(deps.browser, config);
    const page: Page = await context.newPage();
    const url = deps.searchUrlFor?.(input.keyword) ?? buildSearchUrl(input.keyword, config.locale);
    const open = deps.openSearchImpl ?? openSearch;
    let opened: Awaited<ReturnType<typeof openSearch>>;
    try {
      opened = await open(page, url, Math.max(1000, Math.min(30_000, remaining())));
    } catch (err) {
      if (input.allowTransientThrow) throw new TransientBrowserError(`navigation failed for ${input.queryId}`, err);
      stop = { kind: 'failed', reason: 'error', error: errorOf(err, 'navigation_failed') };
      opened = { state: { kind: 'unknown', detail: 'navigation failed' }, finalUrl: page.url() };
    }
    finalUrl = opened.finalUrl;
    stage('navigate', { state: opened.state.kind, finalUrl });

    if (!stop) {
      switch (opened.state.kind) {
        case 'captcha': stop = { kind: 'blocked', reason: 'captcha', error: null }; break;
        case 'consent': stop = { kind: 'blocked', reason: 'consent_required', error: null }; break;
        case 'no_results': stop = { kind: 'complete', reason: 'end_of_results' }; break;
        case 'place_redirect':
          stop = { kind: 'incomplete', reason: 'unsupported_layout', error: null };
          warnings.push({ code: 'place_redirect', message: 'Google opened a place page instead of a results list', observationIds: [] });
          break;
        case 'unknown':
          stop = { kind: 'incomplete', reason: 'unsupported_layout', error: null };
          warnings.push({ code: 'unknown_page', message: opened.state.detail, observationIds: [] });
          break;
        case 'results': break;
      }
      if (stop) {
        const png = await page.screenshot({ type: 'png' }).catch(() => null);
        // A store failure here loses the diagnostic image, not the reason the page was blocked:
        // keep the stop cause and record the missing evidence as a warning.
        if (png) {
          try {
            await saveScreenshot(png, 'diagnostic', null);
          } catch (err) {
            warnings.push({ code: 'diagnostic_screenshot_failed', message: `diagnostic screenshot could not be saved: ${errorOf(err, 'diagnostic_screenshot_failed').message}`, observationIds: [] });
          }
        }
      }
    }

    let scrolls = 0;
    let stalls = 0;
    let waitedForCards = false;
    let waitedForQuery = false;
    while (!stop) {
      if (deps.signal?.aborted) { stop = { kind: 'incomplete', reason: 'cancelled', error: null }; break; }
      const obs = await captureStableObservation(page, { deadlineAt: input.deadlineAt });
      if (!obs) { stop = { kind: 'incomplete', reason: 'unsupported_layout', error: null }; warnings.push({ code: 'feed_vanished', message: 'results feed disappeared', observationIds: [] }); break; }
      if (!obs.accepted) {
        // A rejected observation is still evidence of what the page showed: keep its cards and the
        // reason it was refused, with no screenshot to point at.
        const rejectedId = observationIdFor(input.queryAttemptId, observations.length + 1);
        observations.push({
          observationId: rejectedId, runId: deps.runId, attemptId: deps.attemptId, queryId: input.queryId, queryAttemptId: input.queryAttemptId,
          observedAt: isoWithOffset(now(), tz), scrollOffset: obs.snapshot.scrollTop, paneBounds: obs.snapshot.paneBounds,
          preSignature: obs.preSignature, postSignature: obs.postSignature, accepted: false, rejectionReason: obs.rejectionReason,
          cards: obs.snapshot.children.filter(isCard).map((c) => classifyCard(c, obs.snapshot.paneBounds, rejectedId)),
          screenshotIds: [],
        });
        stop = { kind: 'incomplete', reason: obs.rejectionReason === 'timeout' ? 'timeout' : 'unstable_results', error: null };
        break;
      }
      const snapshot: FeedSnapshot = obs.snapshot;
      if (observations.length === 0) {
        observedQueryText = snapshot.observedQueryText;
        // The entry page renders the feed before it fills in the query field and the title. Give
        // that one bounded wait so an unrendered query is not recorded as a mismatch, and report a
        // spent budget as a timeout rather than blaming the query.
        if (!hasQuerySignal(snapshot)) {
          if (remaining() <= 0) { stop = { kind: 'incomplete', reason: 'timeout', error: null }; break; }
          if (!waitedForQuery) {
            waitedForQuery = true;
            await page.waitForTimeout(Math.max(0, Math.min(2000, remaining())));
            continue;
          }
        }
        stage('ready');
        if (!queryMatches(snapshot, input.keyword)) { stop = { kind: 'incomplete', reason: 'query_mismatch', error: null }; break; }
      }
      const layoutResult = classifyFeedChildren(snapshot.children);
      if (!layoutResult.ok) {
        if (layoutResult.reason === 'no_cards' && !waitedForCards) {
          waitedForCards = true;
          await waitForFeedChange(page, { childCount: snapshot.children.length, scrollHeight: snapshot.scrollHeight }, Math.max(0, Math.min(3000, remaining())));
          continue;
        }
        if (layoutResult.reason === 'no_cards' && snapshot.endOfList) { stop = { kind: 'complete', reason: 'end_of_results' }; break; }
        stop = { kind: 'incomplete', reason: 'unsupported_layout', error: null };
        warnings.push({ code: layoutResult.reason, message: layoutResult.detail, observationIds: [] });
        break;
      }
      const layout = layoutResult.layout;
      const observationId = observationIdFor(input.queryAttemptId, observations.length + 1);
      const cards: ClassifiedCard[] = layout.cards.map((c) => classifyCard(c, snapshot.paneBounds, observationId));
      const before = state.committed.length;
      state = applyRound(state, { observationId, layout, cards }, limit);

      const committedIds = new Set(state.committed.map((e) => e.card.occurrenceId));
      const visibleCommitted = cards.filter((c) => c.fullyVisible && committedIds.has(c.occurrenceId));
      const shouldSave = observations.length === 0 || visibleCommitted.some((c) => !coverage.has(occKey(c)));
      const resultsSaved = () => screenshots.filter((s) => s.kind === 'results').length;
      const screenshotIds: string[] = [];
      if (shouldSave && resultsSaved() < config.maxScreenshotsPerKeyword) {
        const shot = await saveScreenshot(obs.png, 'results', observationId);
        screenshotIds.push(shot.id);
        for (const c of visibleCommitted) coverage.set(occKey(c), [...(coverage.get(occKey(c)) ?? []), shot.id]);
      }
      observations.push({
        observationId, runId: deps.runId, attemptId: deps.attemptId, queryId: input.queryId, queryAttemptId: input.queryAttemptId,
        observedAt: isoWithOffset(now(), tz), scrollOffset: snapshot.scrollTop, paneBounds: snapshot.paneBounds,
        preSignature: obs.preSignature, postSignature: obs.postSignature, accepted: true, rejectionReason: null,
        cards, screenshotIds,
      });
      stage('round', { observationId, committed: state.committed.length, newlyCommitted: state.committed.length - before, saved: screenshotIds.length });

      if (state.failure) {
        stop = { kind: 'incomplete', reason: state.failure.reason, error: null };
        warnings.push({ code: state.failure.reason, message: state.failure.detail, observationIds: [observationId] });
        break;
      }
      const committedIndices = new Set(state.committed.map((e) => e.card.feedChildIndex));
      const completeReason: 'limit_reached' | 'end_of_results' | null =
        state.committed.length >= limit ? 'limit_reached'
          : snapshot.endOfList && layout.cards.every((c) => committedIndices.has(c.index)) ? 'end_of_results'
            : null;
      const allCovered = state.committed.every((e) => coverage.has(occKey(e.card)));
      if (completeReason) {
        if (allCovered || resultsSaved() >= config.maxScreenshotsPerKeyword) { stop = { kind: 'complete', reason: completeReason }; break; }
        if (scrolls >= config.maxScrollsPerKeyword) { stop = { kind: 'incomplete', reason: 'scroll_limit', error: null }; break; }
        // Otherwise keep scrolling so the remaining committed cards get screenshot coverage.
      }
      if (scrolls >= config.maxScrollsPerKeyword) { stop = { kind: 'incomplete', reason: 'scroll_limit', error: null }; break; }
      if (remaining() < 2000) { stop = { kind: 'incomplete', reason: 'timeout', error: null }; break; }
      if (bytesWritten > ARTIFACT_BUDGET_BYTES) { stop = { kind: 'incomplete', reason: 'artifact_limit', error: null }; break; }

      const target = nextScrollTop(snapshot, layout);
      if (target === null) { stop = { kind: 'incomplete', reason: 'unsupported_layout', error: null }; break; }
      const applied = await scrollFeedTo(page, target);
      scrolls += 1;
      stalls = applied <= snapshot.scrollTop ? stalls + 1 : 0;
      const change = await waitForFeedChange(page, { childCount: snapshot.children.length, scrollHeight: snapshot.scrollHeight }, Math.max(0, Math.min(3000, remaining())));
      if (change === 'unchanged' && stalls >= 3) { stop = { kind: 'incomplete', reason: 'load_stalled', error: null }; break; }
    }
  } catch (err) {
    if (err instanceof TransientBrowserError) throw err;
    if (input.allowTransientThrow && observations.length === 0 && /Target (page|context|browser) has been closed|crashed/i.test(String(err))) {
      throw new TransientBrowserError('browser context failed before any evidence', err);
    }
    stop = { kind: observations.length === 0 ? 'failed' : 'incomplete', reason: 'error', error: errorOf(err, 'unexpected_error') } as StopCause;
  } finally {
    await context?.close().catch(() => undefined);
  }

  const { ranked, classificationComplete } = assignRanks(state.committed);
  const screenshotCoverageComplete = ranked.every((r) => (coverage.get(occKey(r.committed.card)) ?? []).length > 0);
  const listings = ranked.map((r) => toListing(r, coverage.get(occKey(r.committed.card)) ?? []));
  const outcome = deriveOutcome({
    stop: stop ?? { kind: 'failed', reason: 'error', error: { code: 'no_stop', message: 'attempt ended without a stop cause' } },
    sequenceVerified: state.failure === null,
    classificationComplete, screenshotCoverageComplete, listingCount: listings.length,
  });
  stage('stop', { status: outcome.status, stopReason: outcome.stopReason, listings: listings.length });

  // Exports are guarded: a store failure downgrades the attempt to failed / export_failed and keeps
  // whatever artifacts were written, rather than throwing away a completed collection.
  let exportError: CaptureError | null = null;
  const observationArtifactIds: string[] = [];
  try {
    const obsWritten = await store.writeFile(rel('observations.jsonl'), observations.map((o) => JSON.stringify(o)).join('\n') + (observations.length ? '\n' : ''));
    const obsArtifact: Artifact = { ...(await store.persist(obsWritten)), id: `${input.queryAttemptId}_observations`, filename: 'observations.jsonl', kind: 'observations_jsonl', bytes: obsWritten.bytes, sha256: obsWritten.sha256, queryId: input.queryId, queryAttemptId: input.queryAttemptId };
    artifacts.push(obsArtifact);
    observationArtifactIds.push(obsArtifact.id);
  } catch (err) {
    exportError = errorOf(err, 'export_failed');
    warnings.push({ code: 'export_failed', message: `observations.jsonl could not be written: ${exportError.message}`, observationIds: [] });
  }

  const finishedAt = isoWithOffset(now(), tz);
  const body = {
    schemaVersion: '1' as const,
    runId: deps.runId, attemptId: deps.attemptId, queryId: input.queryId, queryAttemptId: input.queryAttemptId,
    keyword: input.keyword,
    startedAt: isoWithOffset(startedAtDate, tz), finishedAt,
    requestedLimit: limit, observedCount: listings.length, sequenceVerified: state.failure === null, finalUrl,
    metadata: deps.metadata,
    context: {
      locale: config.locale, browserTimezoneId: config.browserTimezoneId, viewport: config.viewport, deviceScaleFactor: 1,
      locationMode: 'query_only' as const, configuredMapView: null, observedMapView: parseObservedMapView(finalUrl),
      loggedIn: false as const, geolocationPermission: 'not_granted' as const, egressRegion: null, egressSource: null, observedLocationText: null, filters: [],
    },
    quality: { verifiedPrefixLength: state.committed.length, classificationComplete, screenshotCoverageComplete, warnings, observedQueryText, queryCorrectionText: null },
    listings, screenshots, observationArtifactIds,
  };

  const csvName = `${base}.csv`;
  try {
    const csvWritten = await store.writeFile(rel(csvName), resultToCsv({ ...outcome, ...body }));
    artifacts.push({ ...(await store.persist(csvWritten)), id: `${input.queryAttemptId}_result_csv`, filename: csvName, kind: 'result_csv', bytes: csvWritten.bytes, sha256: csvWritten.sha256, queryId: input.queryId, queryAttemptId: input.queryAttemptId });
  } catch (err) {
    const csvError = errorOf(err, 'export_failed');
    exportError = exportError ?? csvError;
    warnings.push({ code: 'export_failed', message: `${csvName} could not be written: ${csvError.message}`, observationIds: [] });
  }

  const finalOutcome: CollectionOutcome = exportError ? { status: 'failed', stopReason: 'error', error: exportError } : outcome;
  const result: KeywordResult = { ...finalOutcome, ...body };

  const jsonName = `${base}.json`;
  let jsonWritten;
  try {
    jsonWritten = await store.writeFile(rel(jsonName), JSON.stringify(result, null, 2));
  } catch (err) {
    // Without its result JSON the attempt has no terminal record to point a manifest row at; the
    // batch runner treats this as a storage failure for the whole batch.
    throw new Error(`result JSON could not be written for ${input.queryId}/${input.queryAttemptId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  artifacts.push({ ...(await store.persist(jsonWritten)), id: `${input.queryAttemptId}_result_json`, filename: jsonName, kind: 'result_json', bytes: jsonWritten.bytes, sha256: jsonWritten.sha256, queryId: input.queryId, queryAttemptId: input.queryAttemptId });
  stage('export', { artifacts: artifacts.length, exportError: exportError?.code ?? null });

  const resultFile = `${qdir}/${jsonName}`;
  const summary: QueryAttemptSummary = {
    ...finalOutcome,
    queryAttemptId: input.queryAttemptId, startedAt: result.startedAt, finishedAt, resultFile,
    artifactIds: artifacts.map((a) => a.id),
  };
  return { result, summary, artifacts, resultFile };
}
