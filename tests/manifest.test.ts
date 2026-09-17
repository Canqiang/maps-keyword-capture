import { describe, expect, it } from 'vitest';
import type { Artifact, ManifestDeliveryReceipt, QueryAttemptSummary, RunMetadata, StorageState } from '../src/contracts.js';
import { createManifest, deliveryStatus, exitCodeFor, finalizeManifest, markRunning, markSkipped, persistenceStatusFor, recordBatchArtifact, recordQueryAttempt, selectAttempt } from '../src/runner/manifest.js';

const metadata: RunMetadata = { configHash: 'c', profileHash: 'p', adapterVersion: 'v1', sourceCommit: null, browserVersion: null, imageDigest: null, egressProfileId: null };
function summary(id: string, status: QueryAttemptSummary['status'], stopReason: QueryAttemptSummary['stopReason']): QueryAttemptSummary {
  const error = status === 'failed' ? { code: 'x', message: 'x' } : null;
  return { queryAttemptId: id, startedAt: 't0', finishedAt: 't1', resultFile: `q0001/${id}/r.json`, artifactIds: [`${id}-a`], status, stopReason, error } as QueryAttemptSummary;
}
function artifact(id: string): Artifact {
  return { id, filename: 'f', kind: 'result_json', bytes: 1, sha256: 'h', queryId: 'q0001', queryAttemptId: 'qa01', storageStatus: 'local_only', objectKey: null, verifiedAt: null, storageError: null };
}
const base = () => createManifest({ runId: 'run_1', attemptId: 'att_1', startedAt: 't0', metadata, persistenceMode: 'local_only', keywords: ['a', 'b', 'a'] });

describe('manifest', () => {
  it('creates pending rows for every input row including duplicates', () => {
    const m = base();
    expect(m.status).toBe('running');
    expect(m.queries.map((q) => [q.queryId, q.inputIndex, q.keyword, q.status])).toEqual([['q0001', 0, 'a', 'pending'], ['q0002', 1, 'b', 'pending'], ['q0003', 2, 'a', 'pending']]);
    expect(m.queries[0]).toMatchObject({ persistenceStatus: 'not_requested', selectedQueryAttemptId: null, attempts: [] });
  });

  it('records attempts, selects by policy, and lists artifacts', () => {
    let m = markRunning(base(), 'q0001');
    expect(m.queries[0]!.status).toBe('running');
    m = recordQueryAttempt(m, 'q0001', summary('qa01', 'failed', 'error'), [artifact('qa01-a')]);
    expect(m.queries[0]).toMatchObject({ status: 'failed', selectedQueryAttemptId: 'qa01', resultFile: 'q0001/qa01/r.json', persistenceStatus: 'not_requested' });
    m = recordQueryAttempt(m, 'q0001', summary('qa02', 'captured', 'limit_reached'), [artifact('qa02-a')]);
    expect(m.queries[0]).toMatchObject({ status: 'captured', stopReason: 'limit_reached', selectedQueryAttemptId: 'qa02', artifactIds: ['qa01-a', 'qa02-a'] });
    expect(m.artifacts.map((a) => a.id)).toEqual(['qa01-a', 'qa02-a']);
  });

  it('selects the earliest captured, then earliest with evidence, then earliest failed', () => {
    expect(selectAttempt([summary('qa01', 'partial', 'timeout'), summary('qa02', 'captured', 'limit_reached')]).queryAttemptId).toBe('qa02');
    expect(selectAttempt([summary('qa01', 'failed', 'error'), summary('qa02', 'blocked', 'captcha')]).queryAttemptId).toBe('qa02');
    expect(selectAttempt([summary('qa01', 'failed', 'error'), summary('qa02', 'failed', 'timeout')]).queryAttemptId).toBe('qa01');
  });

  it('marks skipped rows with a reason and no result', () => {
    const m = markSkipped(base(), 'q0002', 'batch_blocked');
    expect(m.queries[1]).toMatchObject({ status: 'skipped', stopReason: 'batch_blocked', selectedQueryAttemptId: null, resultFile: null, attempts: [], artifactIds: [], persistenceStatus: 'not_requested' });
  });

  it('finalizes status and exit code', () => {
    let m = base();
    for (const q of ['q0001', 'q0002', 'q0003']) m = recordQueryAttempt(m, q, summary('qa01', 'captured', 'limit_reached'), []);
    const done = finalizeManifest(m, 't9');
    expect(done).toMatchObject({ status: 'completed', finishedAt: 't9' });
    expect(exitCodeFor(done)).toBe(0);

    let p = recordQueryAttempt(base(), 'q0001', summary('qa01', 'captured', 'limit_reached'), []);
    p = markSkipped(p, 'q0002', 'batch_blocked');
    p = markSkipped(p, 'q0003', 'batch_blocked');
    expect(finalizeManifest(p, 't9').status).toBe('partial');
    expect(exitCodeFor(finalizeManifest(p, 't9'))).toBe(2);

    let f = base();
    for (const q of ['q0001', 'q0002', 'q0003']) f = recordQueryAttempt(f, q, summary('qa01', 'failed', 'error'), []);
    expect(finalizeManifest(f, 't9').status).toBe('failed');
    expect(exitCodeFor(finalizeManifest(f, 't9'))).toBe(1);
  });
});

function stateFor(status: 'verified' | 'failed' | 'uploaded'): StorageState {
  if (status === 'verified') return { storageStatus: 'verified', objectKey: 'k', verifiedAt: '2026-09-17T00:00:00.000Z', storageError: null };
  if (status === 'uploaded') return { storageStatus: 'uploaded', objectKey: 'k', verifiedAt: null, storageError: null };
  return { storageStatus: 'failed', objectKey: 'k', verifiedAt: null, storageError: { code: 'upload_failed', message: 'x' } };
}
function remoteArtifact(id: string, status: 'verified' | 'failed' | 'uploaded', queryId: string | null = 'q0001'): Artifact {
  return { ...stateFor(status), id, filename: `${id}.json`, kind: queryId ? 'result_json' : 'request_json', bytes: 1, sha256: 'h', queryId, queryAttemptId: queryId ? 'qa01' : null };
}
function receipt(status: 'verified' | 'failed'): ManifestDeliveryReceipt {
  return { ...stateFor(status), runId: 'run_1', attemptId: 'att_1', filename: 'manifest.json', bytes: 10, sha256: 'm' };
}
const remoteBase = () => createManifest({ runId: 'run_1', attemptId: 'att_1', startedAt: 't0', metadata, persistenceMode: 'azure_blob', keywords: ['a', 'b'] });
function captured(id: string, queryId: string): QueryAttemptSummary {
  return { queryAttemptId: id, startedAt: 't0', finishedAt: 't1', resultFile: `${queryId}/${id}/r.json`, artifactIds: [`${queryId}-${id}`], status: 'captured', stopReason: 'limit_reached', error: null };
}

describe('remote persistence bookkeeping', () => {
  it('derives persistence status from artifacts', () => {
    expect(persistenceStatusFor('local_only', [remoteArtifact('a', 'failed')])).toBe('not_requested');
    expect(persistenceStatusFor('azure_blob', [])).toBe('pending');
    expect(persistenceStatusFor('azure_blob', [remoteArtifact('a', 'verified'), remoteArtifact('b', 'uploaded')])).toBe('pending');
    expect(persistenceStatusFor('azure_blob', [remoteArtifact('a', 'verified'), remoteArtifact('b', 'verified')])).toBe('verified');
    expect(persistenceStatusFor('azure_blob', [remoteArtifact('a', 'verified'), remoteArtifact('b', 'failed')])).toBe('failed');
  });

  it('starts remote rows pending and sets each row from its own artifacts across attempts', () => {
    let m = remoteBase();
    expect(m.queries.map((q) => q.persistenceStatus)).toEqual(['pending', 'pending']);
    m = recordQueryAttempt(m, 'q0001', captured('qa01', 'q0001'), [remoteArtifact('a1', 'verified'), remoteArtifact('a2', 'verified')]);
    m = recordQueryAttempt(m, 'q0002', captured('qa01', 'q0002'), [remoteArtifact('b1', 'verified', 'q0002')]);
    expect(m.queries.map((q) => q.persistenceStatus)).toEqual(['verified', 'verified']);
    m = recordQueryAttempt(m, 'q0001', captured('qa02', 'q0001'), [remoteArtifact('a3', 'failed')]);
    expect(m.queries.map((q) => q.persistenceStatus)).toEqual(['failed', 'verified']);
  });

  it('treats a non-skipped row whose delivery is still pending as a delivery failure', () => {
    let m = recordBatchArtifact(remoteBase(), remoteArtifact('request_json', 'verified', null));
    m = recordQueryAttempt(m, 'q0001', captured('qa01', 'q0001'), [remoteArtifact('a1', 'verified')]);
    m = recordQueryAttempt(m, 'q0002', captured('qa01', 'q0002'), []);
    const done = finalizeManifest(m, 't9');
    expect(done.status).toBe('completed');
    expect(done.queries.map((q) => q.persistenceStatus)).toEqual(['verified', 'pending']);
    expect(exitCodeFor(done, receipt('verified'))).toBe(1);
    expect(deliveryStatus(done, receipt('verified'))).toBe('failed');
  });

  it('records batch-level artifacts without changing rows', () => {
    const m = recordBatchArtifact(remoteBase(), remoteArtifact('request_json', 'verified', null));
    expect(m.artifacts.map((a) => [a.id, a.queryId])).toEqual([['request_json', null]]);
    expect(m.queries.map((q) => q.persistenceStatus)).toEqual(['pending', 'pending']);
  });

  it('requires verified rows, batch artifacts, and a verified receipt for a clean remote exit', () => {
    const complete = () => {
      let m = recordBatchArtifact(remoteBase(), remoteArtifact('request_json', 'verified', null));
      m = recordQueryAttempt(m, 'q0001', captured('qa01', 'q0001'), [remoteArtifact('a1', 'verified')]);
      m = recordQueryAttempt(m, 'q0002', captured('qa01', 'q0002'), [remoteArtifact('b1', 'verified', 'q0002')]);
      return finalizeManifest(m, 't9');
    };
    expect(exitCodeFor(complete(), receipt('verified'))).toBe(0);
    expect(deliveryStatus(complete(), receipt('verified'))).toBe('verified');
    expect(exitCodeFor(complete(), null)).toBe(1);
    expect(exitCodeFor(complete())).toBe(1);
    expect(exitCodeFor(complete(), receipt('failed'))).toBe(1);
    expect(deliveryStatus(complete(), receipt('failed'))).toBe('failed');

    let rowFailed = recordQueryAttempt(complete(), 'q0002', captured('qa02', 'q0002'), [remoteArtifact('b2', 'failed', 'q0002')]);
    rowFailed = finalizeManifest(rowFailed, 't9');
    expect(exitCodeFor(rowFailed, receipt('verified'))).toBe(1);

    const requestFailed = finalizeManifest(recordQueryAttempt(recordQueryAttempt(recordBatchArtifact(remoteBase(), remoteArtifact('request_json', 'failed', null)), 'q0001', captured('qa01', 'q0001'), [remoteArtifact('a1', 'verified')]), 'q0002', captured('qa01', 'q0002'), [remoteArtifact('b1', 'verified', 'q0002')]), 't9');
    expect(exitCodeFor(requestFailed, receipt('verified'))).toBe(1);

    const local = finalizeManifest(recordQueryAttempt(recordQueryAttempt(base(), 'q0001', summary('qa01', 'captured', 'limit_reached'), []), 'q0002', summary('qa01', 'captured', 'limit_reached'), []), 't9');
    const localAll = recordQueryAttempt(local, 'q0003', summary('qa01', 'captured', 'limit_reached'), []);
    expect(exitCodeFor(finalizeManifest(localAll, 't9'), null)).toBe(0);
    expect(deliveryStatus(finalizeManifest(localAll, 't9'), null)).toBe('not_requested');
  });
});
