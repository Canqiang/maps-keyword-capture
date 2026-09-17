import type { Artifact, BatchManifest, PersistenceStatus, QueryAttemptSummary, QueryManifestEntry, RunMetadata, SkipReason } from '../contracts.js';
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

export function recordQueryAttempt(m: BatchManifest, queryId: string, summary: QueryAttemptSummary, artifacts: Artifact[]): BatchManifest {
  const persistenceStatus: PersistenceStatus = m.persistenceMode === 'local_only' ? 'not_requested' : 'pending';
  const withArtifacts: BatchManifest = { ...m, artifacts: [...m.artifacts, ...artifacts] };
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
  return { ...m, finishedAt, status };
}

export function exitCodeFor(m: BatchManifest): 0 | 1 | 2 {
  if (m.status === 'completed') return 0;
  if (m.status === 'failed') return 1;
  return 2;
}
