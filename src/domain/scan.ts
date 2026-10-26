import { parseRoundSnapshot, roundConfigHash } from './scan-round.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseConfig } from '../config.js';
import type { BatchManifest, CaptureConfig, KeywordResult, StorageState } from '../contracts.js';
import { hashJson, newRunId, sha256Hex } from '../ids.js';
import { dateFolder } from '../naming.js';
import { NamespacedBatchStore } from '../monitor/storage.js';
import { deliveryStatus, executionStatusFor, isCompleteNonRankingObservation } from '../runner/manifest.js';
import { runBatch, type BatchDeps, type BatchOutput } from '../runner/batch-runner.js';
import type { ArtifactStore, WrittenFile } from '../storage/types.js';
import { parseTargetCatalog } from './target-catalog.js';
import { ingestWebBatch } from './ingest.js';
import { organicRankForMetrics, type RankObservation } from './model.js';
import type { ObservationStore } from './observation-store.js';
import { planScan, trackingIngestContext, toWebBatches, type ScanTier, type TrackingConfig } from './tracking-config.js';

/**
 * One web scan: plan from the tracking config, run each batch with the desktop collector
 * (one map view per batch), then ingest the batch into the observation store. Evidence lands
 * under `tracking/web/<local date>/<tier>/<scanId>/<storeId>/<pointId>/<n>/` in the artifact store.
 */
export interface WebScanDeps {
  config: TrackingConfig;
  tier: ScanTier;
  store: ArtifactStore;
  observations: ObservationStore;
  /** Collector settings shared by every batch; keywords, mapView and expectedArea come from the plan. */
  capture?: Partial<Omit<CaptureConfig, 'schemaVersion' | 'keywords' | 'mapView' | 'expectedArea' | 'outputDirectory'>>;
  storeIds?: string[];
  batchRunner?: (deps: BatchDeps) => Promise<BatchOutput>;
  launch?: BatchDeps['launch'];
  log?: (event: Record<string, unknown>) => void;
  signal?: AbortSignal;
  now?: () => Date;
  /** Pause before the single retry of a failed upsert. */
  ingestRetryDelayMs?: number;
  /** Exact pinned catalog bytes loaded once by the CLI, before shard assignment. */
  catalogSnapshot?: FrozenCatalog;
}
export interface RoundExecution { surface: 'web' | 'android'; tier: ScanTier; shardIndex: number; shardCount: number; storeId: string | null }
export interface FrozenCatalog { version: string; sha256: string; bytes: Buffer; execution?: RoundExecution }
export type ScanCatalogReceipt = WrittenFile & StorageState & { version: string; storeIds: string[]; execution?: RoundExecution };

/** Publish the exact approved catalog before any browser/device operation. */
export async function persistScanCatalog(snapshot: FrozenCatalog, config: TrackingConfig, store: ArtifactStore, prefix: string, actual?: { surface: 'web' | 'android'; tier: ScanTier; storeIds?: string[] }): Promise<ScanCatalogReceipt> {
  if (sha256Hex(snapshot.bytes) !== snapshot.sha256) throw new Error('frozen catalog bytes changed');
  const raw = JSON.parse(snapshot.bytes.toString('utf8')) as { schemaVersion?: string };
  const round = raw.schemaVersion === 'tracking-scan-round/v1' ? parseRoundSnapshot(raw) : null;
  const catalog = round ? { version: round.version, stores: round.config.stores } : parseTargetCatalog(raw);
  if (round) {
    const execution = snapshot.execution;
    if (!execution || !actual || execution.surface !== actual.surface || execution.tier !== actual.tier ||
        execution.surface !== round.request.surface || execution.tier !== round.request.tier || execution.shardCount !== round.request.shardCount ||
        execution.storeId !== round.request.storeId || JSON.stringify(actual.storeIds ?? []) !== JSON.stringify(execution.storeId ? [execution.storeId] : []) ||
        !Number.isInteger(execution.shardIndex) || execution.shardIndex < 0 || execution.shardIndex >= execution.shardCount ||
        roundConfigHash(config) !== round.request.configHash ||
        JSON.stringify(config.stores.map(s => s.storeId)) !== JSON.stringify(round.assignments[execution.shardIndex])) {
      throw new Error('execution does not match frozen round configuration or shard assignment');
    }
  }
  if (catalog.version !== snapshot.version || config.stores.some(selected => {
    const expected = catalog.stores.find(candidate => candidate.storeId === selected.storeId);
    return !expected || hashJson(expected) !== hashJson(selected);
  })) throw new Error('executing stores do not match the frozen catalog');
  const written = await store.writeFile(`${prefix}/catalog.json`, snapshot.bytes);
  if (written.bytes !== snapshot.bytes.length || written.sha256 !== snapshot.sha256) throw new Error('catalog write receipt mismatch');
  const receipt = await store.persist(written);
  if (store.mode === 'azure_blob' ? receipt.storageStatus !== 'verified' || !receipt.objectKey || !receipt.verifiedAt || receipt.storageError !== null : receipt.storageStatus !== 'local_only') throw new Error('catalog delivery unverified');
  return { ...written, ...receipt, version: snapshot.version, storeIds: config.stores.map(s => s.storeId), ...(snapshot.execution ? { execution: snapshot.execution } : {}) };
}
export interface WebScanSummary {
  scanId: string; tier: ScanTier; prefix: string; startedAt: string; finishedAt: string;
  status: 'completed' | 'partial' | 'blocked' | 'failed' | 'cancelled';
  batches: { planned: number; run: number; blocked: number; failed: number; partial: number; deliveryFailed: number };
  queries: { planned: number; dispatched: number; observed: number; ranked: number; notFound: number; blocked: number; failed: number; captured: number; nonRanking: number; partial: number; skipped: number; unresolved: number };
  /** Receipt for the immutable scan summary, returned/logged separately from that file. */
  summaryReceipt: StorageState | null;
  /** notIngested counts batches held back by unverified delivery or a failed database upsert. */
  observations: { inserted: number; updated: number; notIngested: number };
  exitCode: 0 | 1 | 2;
  catalogSnapshot?: ScanCatalogReceipt;
}

async function readResults(out: BatchOutput): Promise<Map<string, KeywordResult>> {
  const results = new Map<string, KeywordResult>();
  for (const entry of out.manifest.queries) {
    if (!entry.resultFile) continue;
    try { results.set(entry.resultFile, JSON.parse(await readFile(join(out.attemptRoot, entry.resultFile), 'utf8')) as KeywordResult); }
    catch { /* A missing result file leaves the query as failed in the observation. */ }
  }
  return results;
}

export async function runWebScan(deps: WebScanDeps): Promise<WebScanSummary> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const started = now();
  const scanId = newRunId(started).replace(/^run_/u, 'scan_');
  const prefix = `tracking/web/${dateFolder(started, deps.config.timezone)}/${deps.tier}/${scanId}`;
  const plan = planScan(deps.config, { surface: 'web', tier: deps.tier, ...(deps.storeIds ? { storeIds: deps.storeIds } : {}) });
  const batches = toWebBatches(plan);
  const context = { ...trackingIngestContext(deps.config, { includeGridSpec: deps.tier === 'grid', includeTargetSnapshot: deps.tier === 'point' }), ...(deps.tier === 'grid' ? { gridRunId: scanId } : {}), now };
  const summary: WebScanSummary = { scanId, tier: deps.tier, prefix, startedAt: started.toISOString(), finishedAt: started.toISOString(), status: 'completed',
    batches: { planned: batches.length, run: 0, blocked: 0, failed: 0, partial: 0, deliveryFailed: 0 }, queries: { planned: plan.queries.length, dispatched: 0, observed: 0, ranked: 0, notFound: 0, blocked: 0, failed: 0, captured: 0, nonRanking: 0, partial: 0, skipped: 0, unresolved: 0 }, summaryReceipt: null, observations: { inserted: 0, updated: 0, notIngested: 0 }, exitCode: 0 };
  log({ stage: 'scan_start', scanId, tier: deps.tier, batches: batches.length, queries: plan.queries.length, prefix });
  if (deps.catalogSnapshot) {
    try { summary.catalogSnapshot = await persistScanCatalog(deps.catalogSnapshot, deps.config, deps.store, prefix, { surface: 'web', tier: deps.tier, ...(deps.storeIds ? { storeIds: deps.storeIds } : {}) }); }
    catch { summary.status = 'failed'; log({ stage: 'scan_catalog_failed', scanId }); }
  }
  const runner = deps.batchRunner ?? runBatch;
  for (const [index, batch] of batches.entries()) {
    if (summary.status === 'failed') break;
    if (deps.signal?.aborted) { summary.status = 'cancelled'; break; }
    // Storage paths allow only [A-Za-z0-9_/-]; encode the point's signs (r+2c-2 → rp2cm2). The observation keeps the real ID.
    const pointPath = batch.pointId.replaceAll('+', 'p').replaceAll('-', 'm');
    const scoped = new NamespacedBatchStore(deps.store, `${prefix}/${batch.storeId}/${pointPath}/${String(index + 1).padStart(3, '0')}`);
    const { config } = parseConfig({ schemaVersion: '1', ...deps.capture,
      ...(deps.config.surfaces.web.mapSearchMode ? { mapSearchMode: deps.config.surfaces.web.mapSearchMode } : {}),
      keywords: batch.config.keywords, mapView: batch.config.mapView, ...(batch.config.expectedArea ? { expectedArea: batch.config.expectedArea } : {}), outputDirectory: scoped.rootDirectory });
    summary.queries.dispatched += batch.config.keywords.length;
    let out: BatchOutput;
    try {
      out = await runner({ config, store: scoped, log, ...(deps.launch ? { launch: deps.launch } : {}), ...(deps.signal ? { signal: deps.signal } : {}) });
    } catch (error) {
      summary.batches.failed++;
      summary.queries.failed += batch.config.keywords.length;
      log({ stage: 'batch_failed', scanId, storeId: batch.storeId, pointId: batch.pointId, error: error instanceof Error ? error.message.replace(/mongodb(\+srv)?:\/\/[^\s]*/gu, 'mongodb://***').slice(0, 200) : 'unknown' });
      continue;
    }
    summary.batches.run++;
    const deliveryFailed = deliveryStatus(out.manifest, out.manifestReceipt) === 'failed';
    if (out.exitCode === 1 || executionStatusFor(out.manifest) === 'failed') summary.batches.failed++;
    else if (out.exitCode === 2 || executionStatusFor(out.manifest) !== 'completed') summary.batches.partial++;
    if (deliveryFailed) summary.batches.deliveryFailed++;
    const store = deps.config.stores.find(s => s.storeId === batch.storeId)!;
    const observations: RankObservation[] = ingestWebBatch({ manifest: out.manifest as BatchManifest, results: await readResults(out), attemptRoot: out.attemptRoot, store: { storeId: store.storeId, placeId: store.placeId }, pointId: batch.pointId, manifestKey: out.manifestReceipt?.objectKey ?? null }, context);
    let upsert: Awaited<ReturnType<ObservationStore['upsert']>> | null = null;
    for (let attempt = 1; !deliveryFailed && attempt <= 2 && upsert === null; attempt++) {
      try { upsert = await deps.observations.upsert(observations); }
      catch (error) {
        log({ stage: 'ingest_retry', scanId, storeId: batch.storeId, pointId: batch.pointId, attempt, error: error instanceof Error ? error.message.replace(/mongodb(\+srv)?:\/\/[^\s]*/gu, 'mongodb://***').slice(0, 200) : 'unknown' });
        if (attempt === 1) await new Promise(resolve => setTimeout(resolve, deps.ingestRetryDelayMs ?? 15_000));
      }
    }
    if (upsert) { summary.observations.inserted += upsert.inserted; summary.observations.updated += upsert.updated; }
    else { summary.observations.notIngested++; log({ stage: 'ingest_failed', scanId, storeId: batch.storeId, pointId: batch.pointId, manifestKey: out.manifestReceipt?.objectKey ?? null }); }
    for (const [index, o] of observations.entries()) {
      const entry = out.manifest.queries[index]!;
      summary.queries.observed++;
      if (entry.status === 'captured') summary.queries.captured++;
      else if (isCompleteNonRankingObservation(out.manifest, entry)) summary.queries.nonRanking++;
      else if (entry.status === 'partial') summary.queries.partial++;
      else if (entry.status === 'skipped') summary.queries.skipped++;
      const metric = organicRankForMetrics(o);
      if (typeof metric === 'number') summary.queries.ranked++;
      else if (metric === null) summary.queries.notFound++;
      else if (o.rank.status === 'blocked') summary.queries.blocked++;
      else if (o.rank.status === 'failed' && entry.status !== 'skipped') summary.queries.failed++;
      else if (!isCompleteNonRankingObservation(out.manifest, entry) && entry.status !== 'skipped') summary.queries.unresolved++;
    }
    log({ stage: upsert ? 'batch_ingested' : 'batch_not_ingested', scanId, storeId: batch.storeId, pointId: batch.pointId, queries: observations.length, ranked: observations.filter(o => o.rank.status === 'ranked').length, manifestKey: out.manifestReceipt?.objectKey ?? null, batchExit: out.exitCode, ...(summary.catalogSnapshot ? { catalogSha256: summary.catalogSnapshot.sha256 } : {}) });
    if (deliveryFailed) { summary.status = 'failed'; break; }
    // A CAPTCHA or consent page means the egress is being challenged; stop the scan rather than feed it.
    if (observations.some(o => o.rank.status === 'blocked')) { summary.batches.blocked++; summary.status = 'blocked'; break; }
  }
  summary.queries.skipped += summary.queries.planned - summary.queries.dispatched;
  if (summary.status === 'completed') {
    if (summary.batches.failed || summary.batches.partial || summary.queries.failed || summary.observations.notIngested) summary.status = 'partial';
  }
  summary.exitCode = summary.status === 'completed' ? 0 : summary.status === 'partial' ? 2 : 1;
  summary.finishedAt = now().toISOString();
  try {
    summary.summaryReceipt = await deps.store.persist(await deps.store.writeFile(`${prefix}/scan.json`, JSON.stringify(summary, null, 2)));
    const delivered = deps.store.mode === 'azure_blob' ? summary.summaryReceipt.storageStatus === 'verified' : summary.summaryReceipt.storageStatus === 'local_only';
    if (!delivered) throw new Error('scan summary delivery unverified');
  } catch {
    summary.status = 'failed'; summary.exitCode = 1;
    log({ stage: 'scan_summary_not_persisted', scanId });
    // Retain the failure locally; do not claim the remote immutable summary was replaced.
    try { await deps.store.writeFile(`${prefix}/scan.json`, JSON.stringify(summary, null, 2)); } catch { /* surfaced in terminal summary */ }
  }
  log({ stage: 'scan_finished', ...summary });
  return summary;
}
