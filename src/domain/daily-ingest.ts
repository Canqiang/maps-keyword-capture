import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { ContainerClient } from '@azure/storage-blob';
import type { BatchManifest, KeywordResult } from '../contracts.js';
import { ingestWebBatch } from './ingest.js';
import type { RankObservation } from './model.js';
import type { ObservationStore } from './observation-store.js';
import { trackingIngestContext, type TrackingConfig } from './tracking-config.js';

/**
 * Daily-monitor ingestion: the UAT daily monitor (`maps-keyword-monitor-daily`) delivers one batch
 * per store and keyword slice under `<Beijing date>/<storeId>/<daily run>/batches/<batch>/<run>/<attempt>/`
 * in the evidence container, but writes no RankObservation. This module reads those manifests
 * back from the container, verifies each selected result against its artifact receipt, derives
 * the observations with the same ingestion as the scans (`r0c0`, query-only), and appends the
 * ones whose IDs are not stored yet. Existing rows, including the imported history, are never
 * replaced, so re-running a date is a no-op.
 */
export interface BlobSource { list(prefix: string): Promise<string[]>; get(key: string): Promise<Buffer> }
export interface DailyIngestOptions { dates: string[]; storeIds?: string[]; log?: (event: Record<string, unknown>) => void; now?: () => Date }
export interface DailyIngestSummary {
  dates: string[];
  manifests: { found: number; ingested: number; skippedUnknownStore: number; skippedIncompleteDelivery: number; skippedInvalid: number };
  queries: { total: number; withResult: number; withoutResult: number };
  observations: { prepared: number; inserted: number; existing: number };
  perDate: Record<string, { manifests: number; inserted: number; existing: number }>;
  errors: string[];
}

export const DAILY_MANIFEST_KEY = /^(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9_.\-]+)\/(run_[A-Za-z0-9_]+)\/batches\/([A-Za-z0-9_\-]+)\/(run_[A-Za-z0-9_]+)\/(att_[A-Za-z0-9]+)\/manifest\.json$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

export function azureBlobSource(container: ContainerClient): BlobSource {
  return {
    async list(prefix) {
      const keys: string[] = [];
      for await (const blob of container.listBlobsFlat({ prefix })) keys.push(blob.name);
      return keys;
    },
    async get(key) {
      const response = await container.getBlobClient(key).download();
      const chunks: Buffer[] = [];
      for await (const chunk of response.readableStreamBody ?? []) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as Uint8Array));
      return Buffer.concat(chunks);
    },
  };
}

/** Beijing-date folders of the daily monitor: today and the previous `days - 1` days. */
export function recentBeijingDates(now: Date, days = 2): string[] {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
  return Array.from({ length: days }, (_, i) => format.format(new Date(now.getTime() - i * 86_400_000))).reverse();
}
export function dateRange(from: string, to: string): string[] {
  if (!DATE.test(from) || !DATE.test(to) || from > to) throw new Error('--from/--to must be YYYY-MM-DD with from <= to');
  const dates: string[] = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86_400_000) dates.push(new Date(t).toISOString().slice(0, 10));
  if (dates.length > 62) throw new Error('at most 62 days per run');
  return dates;
}

async function verifiedResults(manifest: BatchManifest, prefix: string, source: BlobSource, log: DailyIngestOptions['log']): Promise<{ results: Map<string, KeywordResult>; incomplete: boolean; withResult: number; withoutResult: number }> {
  const results = new Map<string, KeywordResult>();
  let incomplete = false, withResult = 0, withoutResult = 0;
  for (const entry of manifest.queries) {
    if (!entry.resultFile) { withoutResult++; continue; }
    const artifact = manifest.artifacts.find(a => a.kind === 'result_json' && a.queryId === entry.queryId && a.queryAttemptId === entry.selectedQueryAttemptId
      && a.filename === basename(entry.resultFile!) && entry.artifactIds.includes(a.id));
    if (!artifact || artifact.storageStatus !== 'verified' || !artifact.objectKey || !artifact.objectKey.startsWith(prefix)) { incomplete = true; withoutResult++; continue; }
    let bytes: Buffer;
    try { bytes = await source.get(artifact.objectKey); }
    catch { log?.({ stage: 'daily_ingest_result_unavailable', key: artifact.objectKey }); incomplete = true; withoutResult++; continue; }
    if (bytes.length !== artifact.bytes || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) { log?.({ stage: 'daily_ingest_result_mismatch', key: artifact.objectKey }); incomplete = true; withoutResult++; continue; }
    try { results.set(entry.resultFile, JSON.parse(bytes.toString('utf8')) as KeywordResult); withResult++; }
    catch { incomplete = true; withoutResult++; }
  }
  return { results, incomplete, withResult, withoutResult };
}

export async function ingestDailyMonitor(config: TrackingConfig, source: BlobSource, store: ObservationStore, options: DailyIngestOptions): Promise<DailyIngestSummary> {
  const log = options.log ?? (() => undefined);
  const context = { ...trackingIngestContext(config), ...(options.now ? { now: options.now } : {}) };
  const summary: DailyIngestSummary = { dates: [...options.dates], manifests: { found: 0, ingested: 0, skippedUnknownStore: 0, skippedIncompleteDelivery: 0, skippedInvalid: 0 },
    queries: { total: 0, withResult: 0, withoutResult: 0 }, observations: { prepared: 0, inserted: 0, existing: 0 }, perDate: {}, errors: [] };
  for (const date of options.dates) {
    if (!DATE.test(date)) throw new Error(`invalid date folder ${date}`);
    const perDate = { manifests: 0, inserted: 0, existing: 0 };
    summary.perDate[date] = perDate;
    const keys = (await source.list(`${date}/`)).filter(key => DAILY_MANIFEST_KEY.test(key)).sort();
    for (const key of keys) {
      const [, , storeId] = DAILY_MANIFEST_KEY.exec(key)!;
      summary.manifests.found++; perDate.manifests++;
      if (options.storeIds && !options.storeIds.includes(storeId!)) continue;
      const trackingStore = config.stores.find(s => s.storeId === storeId);
      if (!trackingStore) { summary.manifests.skippedUnknownStore++; log({ stage: 'daily_ingest_unknown_store', key, storeId }); continue; }
      let manifest: BatchManifest;
      try {
        manifest = JSON.parse((await source.get(key)).toString('utf8')) as BatchManifest;
        if (!manifest || !Array.isArray(manifest.queries) || !Array.isArray(manifest.artifacts) || typeof manifest.runId !== 'string' || typeof manifest.attemptId !== 'string') throw new Error('shape');
      } catch { summary.manifests.skippedInvalid++; log({ stage: 'daily_ingest_invalid_manifest', key }); continue; }
      if (manifest.persistenceMode !== 'azure_blob') { summary.manifests.skippedInvalid++; log({ stage: 'daily_ingest_not_azure', key }); continue; }
      const prefix = key.slice(0, -'manifest.json'.length);
      const { results, incomplete, withResult, withoutResult } = await verifiedResults(manifest, prefix, source, log);
      summary.queries.total += manifest.queries.length; summary.queries.withResult += withResult; summary.queries.withoutResult += withoutResult;
      // A result that was never written (failed/blocked query) is a legitimate observation; a selected
      // result whose receipt is unverified or whose bytes differ is not, and the whole batch waits.
      if (incomplete) { summary.manifests.skippedIncompleteDelivery++; log({ stage: 'daily_ingest_incomplete_delivery', key }); continue; }
      const observations: RankObservation[] = ingestWebBatch({ manifest, results, store: { storeId: trackingStore.storeId, placeId: trackingStore.placeId }, pointId: 'r0c0', manifestKey: key }, context);
      summary.observations.prepared += observations.length;
      try {
        const result = await store.insertMissing(observations);
        summary.observations.inserted += result.inserted; summary.observations.existing += result.existing;
        perDate.inserted += result.inserted; perDate.existing += result.existing;
        summary.manifests.ingested++;
        log({ stage: 'daily_ingest_batch', key, storeId, queries: observations.length, ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message.replace(/mongodb(\+srv)?:\/\/[^\s]*/gu, 'mongodb://***').slice(0, 200) : 'unknown';
        summary.errors.push(`${key}: ${message}`); log({ stage: 'daily_ingest_store_failed', key, error: message });
      }
    }
  }
  log({ stage: 'daily_ingest_finished', ...summary });
  return summary;
}
