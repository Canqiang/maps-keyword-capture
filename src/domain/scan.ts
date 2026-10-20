import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseConfig } from '../config.js';
import type { BatchManifest, CaptureConfig, KeywordResult } from '../contracts.js';
import { newRunId } from '../ids.js';
import { dateFolder } from '../naming.js';
import { NamespacedBatchStore } from '../monitor/storage.js';
import { runBatch, type BatchDeps, type BatchOutput } from '../runner/batch-runner.js';
import type { ArtifactStore } from '../storage/types.js';
import { ingestWebBatch } from './ingest.js';
import { keywordKey, type RankObservation } from './model.js';
import type { ObservationStore } from './observation-store.js';
import { centerPoint, planScan, storeGridSpec, toWebBatches, type ScanTier, type TrackingConfig } from './tracking-config.js';
import { generateGrid, type GridPoint } from '../grid/grid.js';

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
}
export interface WebScanSummary {
  scanId: string; tier: ScanTier; prefix: string; startedAt: string; finishedAt: string;
  status: 'completed' | 'partial' | 'blocked' | 'failed' | 'cancelled';
  batches: { planned: number; run: number; blocked: number; failed: number };
  queries: { planned: number; observed: number; ranked: number; notFound: number; blocked: number; failed: number };
  /** notIngested counts batches whose observations could not be stored; their evidence is still in the artifact store. */
  observations: { inserted: number; updated: number; notIngested: number };
  exitCode: 0 | 1 | 2;
}

function pointsFor(config: TrackingConfig): Map<string, GridPoint> {
  const points = new Map<string, GridPoint>();
  for (const store of config.stores) {
    points.set('r0c0', centerPoint(store));
    for (const point of generateGrid(storeGridSpec(config, store))) points.set(point.id, point);
  }
  return points;
}
function keywordTiers(config: TrackingConfig): Map<string, 'core' | 'longTail'> {
  const tiers = new Map<string, 'core' | 'longTail'>();
  for (const store of config.stores) {
    for (const k of store.keywords.core) tiers.set(keywordKey(k), 'core');
    for (const k of store.keywords.longTail) tiers.set(keywordKey(k), 'longTail');
  }
  return tiers;
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
  const context = { timezone: deps.config.timezone, points: pointsFor(deps.config), keywordTiers: keywordTiers(deps.config), now };
  const summary: WebScanSummary = { scanId, tier: deps.tier, prefix, startedAt: started.toISOString(), finishedAt: started.toISOString(), status: 'completed',
    batches: { planned: batches.length, run: 0, blocked: 0, failed: 0 }, queries: { planned: plan.queries.length, observed: 0, ranked: 0, notFound: 0, blocked: 0, failed: 0 }, observations: { inserted: 0, updated: 0, notIngested: 0 }, exitCode: 0 };
  log({ stage: 'scan_start', scanId, tier: deps.tier, batches: batches.length, queries: plan.queries.length, prefix });
  const runner = deps.batchRunner ?? runBatch;
  for (const [index, batch] of batches.entries()) {
    if (deps.signal?.aborted) { summary.status = 'cancelled'; break; }
    // Storage paths allow only [A-Za-z0-9_/-]; encode the point's signs (r+2c-2 → rp2cm2). The observation keeps the real ID.
    const pointPath = batch.pointId.replaceAll('+', 'p').replaceAll('-', 'm');
    const scoped = new NamespacedBatchStore(deps.store, `${prefix}/${batch.storeId}/${pointPath}/${String(index + 1).padStart(3, '0')}`);
    const { config } = parseConfig({ schemaVersion: '1', ...deps.capture, keywords: batch.config.keywords, mapView: batch.config.mapView, ...(batch.config.expectedArea ? { expectedArea: batch.config.expectedArea } : {}), outputDirectory: scoped.rootDirectory });
    let out: BatchOutput;
    try {
      out = await runner({ config, store: scoped, log, ...(deps.launch ? { launch: deps.launch } : {}), ...(deps.signal ? { signal: deps.signal } : {}) });
    } catch (error) {
      summary.batches.failed++;
      log({ stage: 'batch_failed', scanId, storeId: batch.storeId, pointId: batch.pointId, error: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
      continue;
    }
    summary.batches.run++;
    const store = deps.config.stores.find(s => s.storeId === batch.storeId)!;
    const observations: RankObservation[] = ingestWebBatch({ manifest: out.manifest as BatchManifest, results: await readResults(out), store: { storeId: store.storeId, placeId: store.placeId }, pointId: batch.pointId, manifestKey: out.manifestReceipt?.objectKey ?? null }, context);
    let upsert: Awaited<ReturnType<ObservationStore['upsert']>> | null = null;
    for (let attempt = 1; attempt <= 2 && upsert === null; attempt++) {
      try { upsert = await deps.observations.upsert(observations); }
      catch (error) {
        log({ stage: 'ingest_retry', scanId, storeId: batch.storeId, pointId: batch.pointId, attempt, error: error instanceof Error ? error.message.replace(/mongodb(\+srv)?:\/\/[^\s]*/gu, 'mongodb://***').slice(0, 200) : 'unknown' });
        if (attempt === 1) await new Promise(resolve => setTimeout(resolve, deps.ingestRetryDelayMs ?? 15_000));
      }
    }
    if (upsert) { summary.observations.inserted += upsert.inserted; summary.observations.updated += upsert.updated; }
    else { summary.observations.notIngested++; log({ stage: 'ingest_failed', scanId, storeId: batch.storeId, pointId: batch.pointId, manifestKey: out.manifestReceipt?.objectKey ?? null }); }
    for (const o of observations) {
      summary.queries.observed++;
      if (o.rank.status === 'ranked') summary.queries.ranked++;
      else if (o.rank.status === 'not_found' || o.rank.status === 'not_found_in_prefix') summary.queries.notFound++;
      else if (o.rank.status === 'blocked') summary.queries.blocked++;
      else summary.queries.failed++;
    }
    log({ stage: 'batch_ingested', scanId, storeId: batch.storeId, pointId: batch.pointId, queries: observations.length, ranked: observations.filter(o => o.rank.status === 'ranked').length, manifestKey: out.manifestReceipt?.objectKey ?? null, batchExit: out.exitCode });
    // A CAPTCHA or consent page means the egress is being challenged; stop the scan rather than feed it.
    if (observations.some(o => o.rank.status === 'blocked')) { summary.batches.blocked++; summary.status = 'blocked'; break; }
  }
  if (summary.status === 'completed') {
    if (summary.batches.failed || summary.queries.failed || summary.observations.notIngested) summary.status = 'partial';
  }
  summary.exitCode = summary.status === 'completed' ? 0 : summary.status === 'partial' ? 2 : 1;
  summary.finishedAt = now().toISOString();
  try { await deps.store.persist(await deps.store.writeFile(`${prefix}/scan.json`, JSON.stringify(summary, null, 2))); }
  catch { log({ stage: 'scan_summary_not_persisted', scanId }); }
  log({ stage: 'scan_finished', ...summary });
  return summary;
}
