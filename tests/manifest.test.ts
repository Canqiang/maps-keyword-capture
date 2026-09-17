import { describe, expect, it } from 'vitest';
import type { Artifact, QueryAttemptSummary, RunMetadata } from '../src/contracts.js';
import { createManifest, exitCodeFor, finalizeManifest, markRunning, markSkipped, recordQueryAttempt, selectAttempt } from '../src/runner/manifest.js';

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
