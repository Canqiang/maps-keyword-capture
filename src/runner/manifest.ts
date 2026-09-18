import type { Artifact, BatchManifest, ExecutionStatus, ManifestDeliveryReceipt, PersistenceStatus, QueryAttemptSummary, QueryManifestEntry, RunMetadata, SkipReason } from '../contracts.js';
import { queryIdFor } from '../ids.js';

export function createManifest(args: {
  runId: string; attemptId: string; startedAt: string; metadata: RunMetadata;
  persistenceMode: BatchManifest['persistenceMode']; keywords: string[];
}): BatchManifest {
  const initialPersistence = args.persistenceMode === 'local_only' ? 'not_requested' : 'pending';
  return {
    schemaVersion: '1',
    runId: args.runId,
    attemptId: args.attemptId,
    startedAt: args.startedAt,
    finishedAt: null,
    status: 'running',
    executionStatus: 'running',
    metadata: args.metadata,
    persistenceMode: args.persistenceMode,
    queries: args.keywords.map((keyword, inputIndex) => ({
      queryId: queryIdFor(inputIndex), inputIndex, keyword,
      status: 'pending', stopReason: null, selectedQueryAttemptId: null, attempts: [],
      resultFile: null, artifactIds: [], persistenceStatus: initialPersistence,
    })),
    artifacts: [],
  };
}

function updateRow(m: BatchManifest, queryId: string, fn: (row: QueryManifestEntry) => QueryManifestEntry): BatchManifest {
  const queries = m.queries.map((row) => (row.queryId === queryId ? fn(row) : row));
  return { ...m, queries };
}

export function markRunning(m: BatchManifest, queryId: string): BatchManifest {
  return updateRow(m, queryId, (row) => {
    if (row.status !== 'pending') return row;
    return { ...row, status: 'running' };
  });
}

export function selectAttempt(attempts: QueryAttemptSummary[]): QueryAttemptSummary {
  const first = attempts[0];
  if (!first) throw new Error('selectAttempt requires at least one attempt');
  return attempts.find((a) => a.status === 'captured')
    ?? attempts.find((a) => a.status === 'partial' || a.status === 'blocked')
    ?? first;
}

export function persistenceStatusFor(mode: BatchManifest['persistenceMode'], artifacts: Artifact[]): PersistenceStatus {
  if (mode === 'local_only') return 'not_requested';
  if (artifacts.some((a) => a.storageStatus === 'failed')) return 'failed';
  if (artifacts.length > 0 && artifacts.every((a) => a.storageStatus === 'verified')) return 'verified';
  return 'pending';
}

/** Artifacts that belong to the batch rather than a query, such as request.json. */
export function recordBatchArtifact(m: BatchManifest, artifact: Artifact): BatchManifest {
  return { ...m, artifacts: [...m.artifacts, artifact] };
}

export function recordQueryAttempt(m: BatchManifest, queryId: string, summary: QueryAttemptSummary, artifacts: Artifact[]): BatchManifest {
  const withArtifacts: BatchManifest = { ...m, artifacts: [...m.artifacts, ...artifacts] };
  const persistenceStatus = persistenceStatusFor(m.persistenceMode, withArtifacts.artifacts.filter((a) => a.queryId === queryId));
  return updateRow(withArtifacts, queryId, (row) => {
    const attempts: [QueryAttemptSummary, ...QueryAttemptSummary[]] = [...row.attempts, summary] as [QueryAttemptSummary, ...QueryAttemptSummary[]];
    const selected = selectAttempt(attempts);
    const identity = { queryId: row.queryId, inputIndex: row.inputIndex, keyword: row.keyword };
    const shared = {
      selectedQueryAttemptId: selected.queryAttemptId,
      attempts,
      resultFile: selected.resultFile,
      artifactIds: attempts.flatMap((a) => a.artifactIds),
      persistenceStatus,
    };
    switch (selected.status) {
      case 'captured': return { ...identity, ...shared, status: 'captured', stopReason: selected.stopReason, error: null };
      case 'partial': return { ...identity, ...shared, status: 'partial', stopReason: selected.stopReason, error: selected.error };
      case 'blocked': return { ...identity, ...shared, status: 'blocked', stopReason: selected.stopReason, error: selected.error };
      case 'failed': return { ...identity, ...shared, status: 'failed', stopReason: selected.stopReason, error: selected.error };
    }
  });
}

export function markSkipped(m: BatchManifest, queryId: string, reason: SkipReason): BatchManifest {
  return updateRow(m, queryId, (row) => ({
    queryId: row.queryId, inputIndex: row.inputIndex, keyword: row.keyword,
    status: 'skipped', stopReason: reason, selectedQueryAttemptId: null, attempts: [],
    resultFile: null, artifactIds: [], persistenceStatus: 'not_requested',
  }));
}

export function finalizeManifest(m: BatchManifest, finishedAt: string): BatchManifest {
  const statuses = m.queries.map((q) => q.status);
  const allCaptured = statuses.every((s) => s === 'captured');
  const anyEvidence = statuses.some((s) => s === 'captured' || s === 'partial' || s === 'blocked');
  const status: BatchManifest['status'] = allCaptured ? 'completed' : anyEvidence ? 'partial' : 'failed';
  const final = { ...m, finishedAt, status };
  return { ...final, executionStatus: executionStatusFor(final) };
}

/** A recognized details page is observed only when its selected attempt has full evidence. */
export function isCompleteNonRankingObservation(m: BatchManifest, q: QueryManifestEntry): boolean {
  if (q.status !== 'partial' || q.stopReason !== 'non_ranking_result' || q.error !== null) return false;
  const selected = q.attempts.find(a => a.queryAttemptId === q.selectedQueryAttemptId);
  if (!selected || selected.status !== 'partial' || selected.stopReason !== 'non_ranking_result' || selected.error !== null) return false;
  return (['diagnostic', 'result_json', 'result_csv', 'observations_jsonl'] as const).every(kind =>
    m.artifacts.some(a => a.kind === kind && a.queryId === q.queryId && a.queryAttemptId === q.selectedQueryAttemptId
      && selected.artifactIds.includes(a.id) && (kind !== 'diagnostic' || a.bytes > 0)
      && (a.storageStatus === 'local_only' || a.storageStatus === 'verified')));
}

/** Recompute from query evidence; do not trust a stale aggregate field to waive a partial. */
export function executionStatusFor(m: BatchManifest): ExecutionStatus {
  if (m.status === 'failed') return 'failed';
  if (m.status === 'running') return 'running';
  if (m.queries.length > 0 && m.queries.every(q => q.status === 'captured' || isCompleteNonRankingObservation(m, q))) return 'completed';
  return 'incomplete';
}

function remoteDeliveryFailed(m: BatchManifest, receipt: ManifestDeliveryReceipt | null): boolean {
  if (m.persistenceMode === 'local_only') return false;
  // Every row that ran must be delivered: failed, and also still pending (for example no artifacts recorded).
  if (m.queries.some((q) => q.status !== 'skipped' && q.persistenceStatus !== 'verified')) return true;
  if (m.artifacts.some((a) => a.queryId === null && a.storageStatus !== 'verified')) return true;
  return receipt === null || receipt.storageStatus !== 'verified';
}

export function exitCodeFor(m: BatchManifest, receipt: ManifestDeliveryReceipt | null = null): 0 | 1 | 2 {
  if (remoteDeliveryFailed(m, receipt)) return 1;
  if (executionStatusFor(m) === 'completed') return 0;
  if (m.status === 'failed') return 1;
  return 2;
}

export function deliveryStatus(m: BatchManifest, receipt: ManifestDeliveryReceipt | null): 'not_requested' | 'verified' | 'failed' {
  if (m.persistenceMode === 'local_only') return 'not_requested';
  return remoteDeliveryFailed(m, receipt) ? 'failed' : 'verified';
}
