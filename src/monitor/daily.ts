import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExecutionStatus, GeographicRelevance, KeywordResult, ManifestDeliveryReceipt, StorageState } from '../contracts.js';
import { assessGeographicRelevance } from '../core/geography.js';
import { hashJson, newRunId } from '../ids.js';
import { dateFolder } from '../naming.js';
import { BatchExecutionError, UNSUPPORTED_LAYOUT_STREAK, runBatch, type BatchDeps, type BatchOutput } from '../runner/batch-runner.js';
import { deliveryStatus, executionStatusFor, isCompleteNonRankingObservation } from '../runner/manifest.js';
import type { ArtifactStore } from '../storage/types.js';
import { validateRunKey, type EnrolledStore, type MonitorConfig } from './config.js';
import { summarizeOwnStore, type OwnStoreSummary } from './identity.js';
import { SELECTION_POLICY, selectKeywords, splitKeywords, type KeywordSource } from './source.js';
import { batchIdFor, NamespacedBatchStore, type AtomicClaim, type ClaimResult } from './storage.js';

export const DAILY_DEADLINE_MS = 14 * 60 * 60 * 1000;
export const SHUTDOWN_GRACE_MS = 300_000;
export type DailyStopReason = 'batch_blocked' | 'storage_unavailable' | 'cancelled' | 'daily_timeout' | 'unsupported_layout' | 'browser_startup_failed' | 'batch_timeout' | 'operational_failure';
export type DailyReceipt = StorageState & { relativePath: string; bytes: number; sha256: string };
interface DailyBatch {
  executionStatus?: ExecutionStatus;
  batchId: string; keywords: string[]; prefix: string; status: 'pending' | 'completed' | 'partial' | 'failed' | 'skipped'; stopReason: DailyStopReason | null;
  runId: string | null; attemptId: string | null; manifestReceipt: ManifestDeliveryReceipt | null;
  counts: Record<string, number>; ownStore: { queryId: string; keyword: string; summary: OwnStoreSummary; geographicRelevance: GeographicRelevance }[];
}
interface DailyStore extends EnrolledStore {
  executionStatus?: ExecutionStatus;
  status: 'pending' | 'selected' | 'source_failed' | 'empty' | 'completed' | 'partial' | 'failed' | 'skipped';
  sourceError: string | null; stopReason: DailyStopReason | null; selectionHash: string | null; snapshotReceipt: DailyReceipt | null; selectedCount: number; batches: DailyBatch[];
}
export interface DailyManifest {
  /** Separate from the existing ranked-coverage status; optional on historical records. */
  executionStatus?: ExecutionStatus;
  schemaVersion: '1'; dailyRunId: string; runKey: string; date: string; startedAt: string; finishedAt: string | null; configHash: string;
  status: 'running' | 'completed' | 'partial' | 'failed'; deliveryMode: ArtifactStore['mode']; stopReason: DailyStopReason | null;
  stores: DailyStore[]; counts: { stores: number; batches: number; selected: number; captured: number; partial: number; blocked: number; failed: number; skipped: number; sourceFailed: number; empty: number; nonRanking?: number };
}
export interface DailyOutput { status: DailyManifest['status'] | 'duplicate_skipped'; manifest: DailyManifest | null; manifestPath: string | null; manifestReceipt: DailyReceipt | null; claim: ClaimResult | null; exitCode: 0 | 1 | 2 }
export interface DailyDeps {
  config: MonitorConfig; source: KeywordSource; store: ArtifactStore; claim: AtomicClaim;
  batchRunner?: (deps: BatchDeps) => Promise<BatchOutput>; runKey?: string; now?: () => Date; signal?: AbortSignal;
  log?: (event: Record<string, unknown>) => void;
}
function count(manifest: DailyManifest) {
  const c = { stores: manifest.stores.length, batches: 0, selected: 0, captured: 0, partial: 0, blocked: 0, failed: 0, skipped: 0, sourceFailed: 0, empty: 0, nonRanking: 0 };
  for (const store of manifest.stores) {
    c.selected += store.selectedCount; c.batches += store.batches.length;
    if (store.status === 'source_failed') c.sourceFailed++;
    if (store.status === 'empty') c.empty++;
    for (const batch of store.batches) for (const key of ['captured', 'partial', 'blocked', 'failed', 'skipped', 'nonRanking'] as const) c[key] += batch.counts[key] ?? 0;
  }
  manifest.counts = c;
}
function breakerFor(out: BatchOutput): DailyStopReason | null {
  if (deliveryStatus(out.manifest, out.manifestReceipt) === 'failed') return 'storage_unavailable';
  const rows = out.manifest.queries;
  if (rows.some(q => q.stopReason === 'storage_unavailable')) return 'storage_unavailable';
  if (rows.some(q => q.status === 'blocked' || q.stopReason === 'batch_blocked')) return 'batch_blocked';
  for (const reason of ['cancelled', 'browser_startup_failed', 'batch_timeout'] as const) if (rows.some(q => q.stopReason === reason)) return reason;
  if (rows.some(q => q.status === 'skipped' && q.stopReason === 'unsupported_layout')) return 'unsupported_layout';
  return null;
}
function sourceError(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  return /^(source_[a-z_]+|source_http_\d{3}|cancelled)$/.test(message) ? message : 'source_request_failed';
}
async function ownSummaries(out: BatchOutput, store: EnrolledStore): Promise<DailyBatch['ownStore']> {
  const summaries: DailyBatch['ownStore'] = [];
  for (const query of out.manifest.queries) {
    if (query.status === 'skipped' || query.status === 'pending' || query.status === 'running') continue;
    let summary = summarizeOwnStore(store.placeId, []);
    let geographicRelevance = assessGeographicRelevance(store.expectedArea, [], 'observed_listings');
    if (query.resultFile && !query.resultFile.startsWith('/') && !query.resultFile.split('/').includes('..')) {
      try {
        const result = JSON.parse(await readFile(join(out.attemptRoot, query.resultFile), 'utf8')) as KeywordResult;
        if (Array.isArray(result.listings)) summary = summarizeOwnStore(store.placeId, result.listings);
        geographicRelevance = result.quality?.geographicRelevance ?? geographicRelevance;
      } catch { /* A raw result without readable canonical identity never gets a name-based match. */ }
    }
    summaries.push({ queryId: query.queryId, keyword: query.keyword, summary, geographicRelevance });
  }
  return summaries;
}

export async function runDailyMonitor(deps: DailyDeps): Promise<DailyOutput> {
  const now = deps.now ?? (() => new Date());
  const started = now();
  const date = dateFolder(started, 'Asia/Shanghai');
  const runKey = validateRunKey(deps.runKey ?? date);
  const dailyRunId = newRunId(started);
  const dailyPrefix = `${date}/daily/${dailyRunId}`;
  const log = deps.log ?? (() => undefined);
  const manifest: DailyManifest = { schemaVersion: '1', dailyRunId, runKey, date, startedAt: started.toISOString(), finishedAt: null, configHash: hashJson(deps.config), status: 'running', executionStatus: 'running', deliveryMode: deps.store.mode, stopReason: null, stores: deps.config.stores.map(s => ({ ...s, status: 'pending', sourceError: null, stopReason: null, selectionHash: null, snapshotReceipt: null, selectedCount: 0, batches: [] })), counts: { stores: 0, batches: 0, selected: 0, captured: 0, partial: 0, blocked: 0, failed: 0, skipped: 0, sourceFailed: 0, empty: 0 } };
  let claim: ClaimResult;
  try { claim = await deps.claim({ schemaVersion: '1', dailyRunId, runKey, date, startedAt: manifest.startedAt, configHash: manifest.configHash }); }
  catch { log({ stage: 'daily_claim_failed', runKey }); return { status: 'failed', manifest: null, manifestPath: null, manifestReceipt: null, claim: null, exitCode: 1 }; }
  if (claim.status === 'exists') return { status: 'duplicate_skipped', manifest: null, manifestPath: null, manifestReceipt: null, claim, exitCode: 0 };

  const controller = new AbortController();
  let deadlineExpired = false;
  const onAbort = () => controller.abort();
  if (deps.signal?.aborted) controller.abort(); else deps.signal?.addEventListener('abort', onAbort, { once: true });
  const deadline = setTimeout(() => { deadlineExpired = true; controller.abort(); }, DAILY_DEADLINE_MS);
  deadline.unref();
  let stop: DailyStopReason | null = null;
  let operationalFailure = false;
  let checkpoint = 0;
  let unsupportedStreak = 0;
  const checkStop = () => stop ?? (deadlineExpired || now().getTime() - started.getTime() >= DAILY_DEADLINE_MS ? 'daily_timeout' : controller.signal.aborted ? 'cancelled' : null);
  const isDelivered = (receipt: DailyReceipt) => deps.store.mode === 'local_only' ? receipt.storageStatus === 'local_only' : receipt.storageStatus === 'verified';
  const persistJson = async (path: string, value: unknown, terminal = false): Promise<DailyReceipt> => {
    const written = await deps.store.writeFile(path, JSON.stringify(value, null, 2));
    return { ...await deps.store.persist(written, terminal ? { alwaysAttempt: true } : {}), ...written };
  };
  const saveCheckpoint = async () => {
    count(manifest);
    const receipt = await persistJson(`${dailyPrefix}/checkpoints/${String(++checkpoint).padStart(4, '0')}.json`, manifest);
    if (!isDelivered(receipt)) throw new Error('storage_unavailable');
    return receipt;
  };
  const failStorage = () => { operationalFailure = true; stop = 'storage_unavailable'; };
  let finalReceipt: DailyReceipt | null = null;
  const manifestPath = deps.store.absolutePath(`${dailyPrefix}/manifest.json`);
  try {
    await saveCheckpoint();
    // Snapshot every enrolled store before opening the first browser. A source error is a store row,
    // not an empty successful selection. After global failure the remaining rows stay explicit skips.
    for (const row of manifest.stores) {
      stop = checkStop();
      if (stop) { row.status = 'skipped'; row.stopReason = stop; continue; }
      let record;
      try { record = await deps.source.read(row, controller.signal); }
      catch (err) {
        stop = checkStop();
        row.status = stop ? 'skipped' : 'source_failed'; row.stopReason = stop; row.sourceError = sourceError(err);
        log({ stage: 'source_failed', storeId: row.storeId, code: row.sourceError }); continue;
      }
      const selection = selectKeywords(record.keywords, deps.config.maxKeywordsPerStore);
      row.selectedCount = selection.keywords.length;
      row.selectionHash = hashJson({ sourceResponseHash: record.sourceResponseHash, policy: SELECTION_POLICY, keywords: selection.keywords });
      const prefix = `${date}/${row.storeId}/${dailyRunId}`;
      row.batches = splitKeywords(selection.keywords, deps.config.batchSize).map((batch, index) => {
        const keywords = batch.map(k => k.keyword); const batchId = batchIdFor(index, keywords);
        return { batchId, keywords, prefix: `${prefix}/batches/${batchId}`, status: 'pending', stopReason: null, runId: null, attemptId: null, manifestReceipt: null, counts: {}, ownStore: [] };
      });
      row.snapshotReceipt = await persistJson(`${prefix}/keyword-selection.json`, { schemaVersion: '1', dailyRunId, runKey, date, store: { storeId: row.storeId, merchantId: row.merchantId, placeId: row.placeId, name: row.name, expectedArea: row.expectedArea ?? null }, source: record, selectionPolicy: SELECTION_POLICY, ...selection, selectionHash: row.selectionHash });
      if (!isDelivered(row.snapshotReceipt)) { row.status = 'failed'; failStorage(); }
      else row.status = selection.keywords.length ? 'selected' : 'empty';
      log({ stage: 'source_selected', storeId: row.storeId, selected: row.selectedCount, available: selection.availableCount, snapshotStatus: row.snapshotReceipt.storageStatus });
    }
    for (const row of manifest.stores) {
      if (row.status !== 'selected') continue;
      for (const batch of row.batches) {
        stop = checkStop();
        if (stop) break;
        try {
          const scoped = new NamespacedBatchStore(deps.store, batch.prefix);
          let out: BatchOutput;
          let executionFailed = false;
          try {
            out = await (deps.batchRunner ?? runBatch)({ config: { ...deps.config.capture, ...(row.expectedArea ? { expectedArea: row.expectedArea } : {}), schemaVersion: '1', keywords: batch.keywords, outputDirectory: scoped.rootDirectory }, store: scoped, signal: controller.signal, initialUnsupportedLayoutStreak: unsupportedStreak, log });
          } catch (error) {
            if (error instanceof BatchExecutionError) {
              out = error.output;
              executionFailed = true;
              operationalFailure = true;
            } else {
              // No terminal batch output is available. Account for every dispatched input without
              // pretending we know which query ran, or calling an unknown exception a storage outage.
              batch.status = 'failed'; batch.counts.failed = batch.keywords.length;
              const code = (error as NodeJS.ErrnoException | null)?.code;
              stop = code && ['ENOSPC', 'EIO', 'EACCES', 'EROFS'].includes(code) ? 'storage_unavailable' : 'operational_failure';
              batch.stopReason = stop; operationalFailure = true;
              await saveCheckpoint();
              continue;
            }
          }
          batch.status = out.manifest.status === 'running' ? 'failed' : out.manifest.status;
          batch.executionStatus = executionFailed ? 'failed' : executionStatusFor(out.manifest);
          batch.runId = out.manifest.runId; batch.attemptId = out.manifest.attemptId; batch.manifestReceipt = out.manifestReceipt;
          for (const query of out.manifest.queries) batch.counts[query.status] = (batch.counts[query.status] ?? 0) + 1;
          batch.counts.nonRanking = out.manifest.queries.filter(q => isCompleteNonRankingObservation(out.manifest, q)).length;
          batch.ownStore = await ownSummaries(out, row);
          for (const query of out.manifest.queries) {
            if (query.status === 'skipped') continue;
            unsupportedStreak = query.stopReason === 'unsupported_layout' ? unsupportedStreak + 1 : 0;
            if (unsupportedStreak >= UNSUPPORTED_LAYOUT_STREAK) stop = 'unsupported_layout';
          }
          stop = breakerFor(out) ?? stop ?? (executionFailed ? 'operational_failure' : checkStop()); batch.stopReason = stop;
          if (stop === 'storage_unavailable' || stop === 'browser_startup_failed' || out.exitCode === 1) operationalFailure = true;
          if (out.exitCode === 1 && !stop) stop = 'operational_failure';
          manifest.stopReason = stop;
          await saveCheckpoint();
          // The batch's entire evidence (including unsuccessful attempts) and its reference in the
          // daily checkpoint must be verified before staging is discarded.
          if (!executionFailed && out.exitCode !== 1 && deps.store.mode === 'azure_blob' && out.manifestReceipt?.storageStatus === 'verified' && out.manifest.artifacts.every(a => a.storageStatus === 'verified') && deliveryStatus(out.manifest, out.manifestReceipt) === 'verified') {
            await rm(deps.store.absolutePath(batch.prefix), { recursive: true, force: true });
          }
        } catch { batch.status = 'failed'; failStorage(); batch.stopReason = stop; }
      }
    }
  } catch { failStorage(); }
  finally {
    clearTimeout(deadline); deps.signal?.removeEventListener('abort', onAbort);
    stop = checkStop(); manifest.stopReason = stop;
    for (const row of manifest.stores) {
      for (const batch of row.batches) if (batch.status === 'pending') { batch.status = 'skipped'; batch.stopReason = stop; batch.counts.skipped = batch.keywords.length; }
      if (row.status === 'pending') { row.status = 'skipped'; row.stopReason = stop; }
      if (row.status === 'selected') {
        row.status = row.batches.every(b => b.status === 'completed') ? 'completed' : row.batches.every(b => b.status === 'skipped') ? 'skipped' : row.batches.some(b => b.status === 'failed') ? 'failed' : 'partial';
        row.stopReason = row.status === 'completed' ? null : stop;
      }
    }
    count(manifest); manifest.finishedAt = now().toISOString();
    manifest.status = operationalFailure ? 'failed' : manifest.stores.every(s => s.status === 'completed') ? 'completed' : 'partial';
    for (const row of manifest.stores) {
      row.executionStatus = row.status === 'failed' ? 'failed'
        : row.batches.length > 0 && row.batches.every(b => b.executionStatus === 'completed') ? 'completed' : 'incomplete';
    }
    manifest.executionStatus = operationalFailure ? 'failed'
      : !stop && manifest.counts.selected > 0 && manifest.stores.every(s => s.executionStatus === 'completed') ? 'completed' : 'incomplete';
    try { finalReceipt = await persistJson(`${dailyPrefix}/manifest.json`, manifest, true); }
    catch { operationalFailure = true; }
  }
  const finalDelivered = finalReceipt !== null && isDelivered(finalReceipt);
  const exitCode = operationalFailure || !finalDelivered ? 1 : manifest.executionStatus === 'completed' && deps.store.mode === 'azure_blob' ? 0 : 2;
  log({ stage: 'daily_done', dailyRunId, status: manifest.status, executionStatus: manifest.executionStatus, counts: manifest.counts, delivery: finalReceipt?.storageStatus ?? 'failed', exitCode });
  return { status: exitCode === 1 ? 'failed' : manifest.status, manifest, manifestPath, manifestReceipt: finalReceipt, claim, exitCode };
}
