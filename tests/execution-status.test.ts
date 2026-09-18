import { describe, expect, it } from 'vitest';
import type { Artifact, BatchManifest, ManifestDeliveryReceipt, QueryAttemptSummary } from '../src/contracts.js';
import { createManifest, exitCodeFor, finalizeManifest, recordQueryAttempt } from '../src/runner/manifest.js';

function observedDetail(mode: 'local_only' | 'azure_blob' = 'local_only'): BatchManifest {
  let manifest = createManifest({ runId: 'run', attemptId: 'att', startedAt: 't0', persistenceMode: mode,
    metadata: { configHash: 'c', profileHash: 'p', adapterVersion: 'v2', sourceCommit: null, browserVersion: null, imageDigest: null, egressProfileId: null }, keywords: ['business name'] });
  const artifacts: Artifact[] = (['diagnostic', 'observations_jsonl', 'result_csv', 'result_json'] as const).map(kind => ({
    id: `qa01-${kind}`, filename: `${kind}.file`, kind, queryId: 'q0001', queryAttemptId: 'qa01', bytes: 10, sha256: 'hash',
    ...(mode === 'local_only' ? { storageStatus: 'local_only' as const, objectKey: null, verifiedAt: null, storageError: null }
      : { storageStatus: 'verified' as const, objectKey: kind, verifiedAt: 't1', storageError: null }),
  }));
  const attempt: QueryAttemptSummary = { queryAttemptId: 'qa01', startedAt: 't0', finishedAt: 't1', resultFile: 'result_json.file', artifactIds: artifacts.map(a => a.id), status: 'partial', stopReason: 'non_ranking_result', error: null };
  manifest = recordQueryAttempt(manifest, 'q0001', attempt, artifacts);
  return finalizeManifest(manifest, 't2');
}
const receipt: ManifestDeliveryReceipt = { runId: 'run', attemptId: 'att', filename: 'manifest.json', bytes: 10, sha256: 'hash', storageStatus: 'verified', objectKey: 'manifest.json', verifiedAt: 't2', storageError: null };

describe('execution status retains ranking completeness separately', () => {
  it('completes an observed non-ranking page without relabeling it as a ranked capture', () => {
    const manifest = observedDetail();
    expect(manifest.status).toBe('partial');
    expect(manifest.queries[0]).toMatchObject({ status: 'partial', stopReason: 'non_ranking_result' });
    expect(manifest).toHaveProperty('executionStatus', 'completed');
    expect(exitCodeFor(manifest)).toBe(0);
  });
  it('requires independent remote delivery before a complete observation can exit zero', () => {
    const manifest = observedDetail('azure_blob');
    expect(exitCodeFor(manifest, receipt)).toBe(0);
    expect(exitCodeFor(manifest, null)).toBe(1);
  });
  it.each(['diagnostic', 'result_json', 'result_csv', 'observations_jsonl'])('keeps non-ranking evidence incomplete when %s is missing', kind => {
    const manifest = observedDetail();
    manifest.artifacts = manifest.artifacts.filter(a => a.kind !== kind);
    const final = finalizeManifest(manifest, 't3');
    expect(final).toHaveProperty('executionStatus', 'incomplete');
    expect(exitCodeFor(final)).toBe(2);
  });
  it('does not reuse a diagnostic screenshot from another attempt', () => {
    const manifest = observedDetail();
    manifest.artifacts.find(a => a.kind === 'diagnostic')!.queryAttemptId = 'qa02';
    expect(exitCodeFor(finalizeManifest(manifest, 't3'))).toBe(2);
  });
  it.each(['classification_unknown', 'scroll_limit', 'unsupported_layout', 'timeout'])('keeps %s partial even when all evidence files exist', stopReason => {
    const manifest = observedDetail();
    Object.assign(manifest.queries[0]!, { stopReason });
    const final = finalizeManifest(manifest, 't3');
    expect(final).toHaveProperty('executionStatus', 'incomplete');
    expect(exitCodeFor(final)).toBe(2);
  });
  it('does not accept a non-ranking page with a recorded collection error', () => {
    const manifest = observedDetail();
    Object.assign(manifest.queries[0]!, { error: { code: 'diagnostic_failed', message: 'missing image' } });
    expect(exitCodeFor(finalizeManifest(manifest, 't3'))).toBe(2);
  });
});
