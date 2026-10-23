import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { parseTrackingConfig, withStores, balancedShardStores } from '../src/domain/tracking-config.js';
import { resolveScanRound, roundConfigHash, parseRoundSnapshot, type RoundRepository, type RoundRecord, type RoundRequest } from '../src/domain/scan-round.js';
import { enterScanGate, type GateRepository, type Gate, type GateRound } from '../src/domain/scan-gate.js';

const base = parseTrackingConfig(JSON.parse(readFileSync(new URL('../docs/tracking-config.example.json', import.meta.url), 'utf8')));
const catalog = (a = 10) => withStores(base, [a, 9, 8].map((count, i) => ({ ...base.stores[0]!, storeId: ['a','b','c'][i]!, placeId: `ChIJ${i}`, keywordTargets: undefined,
  keywords: { core: Array.from({ length: count }, (_, k) => `keyword ${k}`), longTail: [] } })));
function rounds() {
  const records = new Map<string, RoundRecord>();
  const repo: RoundRepository = {
    async claim(record) { if (records.has(record._id)) return false; records.set(record._id, structuredClone(record)); return true; },
    async get(id) { return structuredClone(records.get(id) ?? null); },
    async publish(id, json, sha256) { Object.assign(records.get(id)!, { state: 'ready', json, sha256 }); },
    async fail(id) { records.get(id)!.state = 'failed'; },
  };
  return { repo, records };
}
const request = (roundId = 'job-1'): RoundRequest => ({ roundId, configHash: roundConfigHash(catalog()), surface: 'android', tier: 'point', shardCount: 2, strategy: 'balanced', storeId: null });
function gates() {
  const data = new Map<string, Gate>(), workers = new Set<string>(), rounds = new Map<string, GateRound>();
  const repo: GateRepository = {
    async claimRound(round) { if (rounds.has(round._id)) return false; rounds.set(round._id, structuredClone(round)); return true; },
    async readRound(id) { return structuredClone(rounds.get(id) ?? null); },
    async decideRound(id, state) { rounds.get(id)!.state = state; },
    async claimWorker(id, index) { const key = `${id}:${index}`; if (workers.has(key)) return false; workers.add(key); return true; },
    async read(group) { return structuredClone(data.get(group) ?? null); },
    async swap(previous, next) { if (data.get(next._id)?.revision !== previous?.revision) return false; data.set(next._id, structuredClone(next)); return true; },
  };
  return { repo, data };
}

describe('one immutable Mongo scan snapshot per Job', () => {
  it('loads once, keeps late workers on the same assignment, and refreshes the next round', async () => {
    const { repo } = rounds(); let current = catalog(); const load = vi.fn(async () => current);
    const first = await resolveScanRound(repo, request(), load);
    current = catalog(8);
    const second = await resolveScanRound(repo, request(), load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(second.snapshot.sha256).toBe(first.snapshot.sha256);
    const shards = [first, second].flatMap((value, i) => balancedShardStores(value.config, request(), i, 2).map(s => s.storeId));
    expect(shards.sort()).toEqual(['a', 'b', 'c']);
    const next = await resolveScanRound(repo, request('job-2'), load);
    expect(load).toHaveBeenCalledTimes(2); expect(next.config.stores[0]!.keywords.core).toHaveLength(8);
  });
  it('elects one initializer across simultaneous workers', async () => {
    const { repo } = rounds(); const load = vi.fn(async () => { await new Promise(r => setTimeout(r, 5)); return catalog(); });
    const result = await Promise.all([resolveScanRound(repo, request(), load, { pollMs: 1 }), resolveScanRound(repo, request(), load, { pollMs: 1 })]);
    expect(load).toHaveBeenCalledTimes(1); expect(result[0]!.snapshot.sha256).toBe(result[1]!.snapshot.sha256);
    expect(parseRoundSnapshot(JSON.parse(result[0]!.snapshot.bytes.toString())).assignments.flat().sort()).toEqual(['a', 'b', 'c']);
  });
  it('fails closed on changed shard settings, missing identity, corrupt bytes, or a stalled initializer', async () => {
    const { repo, records } = rounds(); await resolveScanRound(repo, request(), async () => catalog());
    await expect(resolveScanRound(repo, { ...request(), shardCount: 3 }, async () => catalog())).rejects.toThrow('mismatch');
    await expect(resolveScanRound(repo, { ...request(), roundId: '' }, async () => catalog())).rejects.toThrow('identity');
    records.get('job-1')!.json += ' ';
    await expect(resolveScanRound(repo, request(), async () => catalog())).rejects.toThrow('checksum');
    const other = request('stalled'); await repo.claim({ _id: 'stalled', request: other, state: 'initializing' });
    const load = vi.fn(async () => catalog());
    await expect(resolveScanRound(repo, other, load, { timeoutMs: 0 })).rejects.toThrow('timed out'); expect(load).not.toHaveBeenCalled();
  });
  it('records failed initialization instead of allowing the next worker to read a newer catalog', async () => {
    const { repo } = rounds(); await expect(resolveScanRound(repo, request(), async () => { throw new Error('source unavailable'); })).rejects.toThrow('source unavailable');
    const load = vi.fn(async () => catalog());
    await expect(resolveScanRound(repo, request(), load)).rejects.toThrow('initialization failed'); expect(load).not.toHaveBeenCalled();
  });
});

describe('shared scheduled/manual execution gate', () => {
  it('admits all shards of one round, rejects another round, and releases only after every shard exits', async () => {
    const { repo, data } = gates();
    const done0 = await enterScanGate(repo, 'target', 'scheduled', 2, 0);
    await expect(enterScanGate(repo, 'target', 'manual', 2, 0)).rejects.toThrow('another scheduled/manual');
    const done1 = await enterScanGate(repo, 'target', 'scheduled', 2, 1);
    await done0(); expect(data.get('target')!.active).toBe(true);
    await done1(); expect(data.get('target')!.active).toBe(false);
    await expect(enterScanGate(repo, 'target', 'manual', 2, 1)).rejects.toThrow('blocked this round');
    await enterScanGate(repo, 'target', 'next', 2, 0);
    await expect(enterScanGate(repo, 'target', 'scheduled', 2, 0)).rejects.toThrow('already admitted');
  });
  it('elects one winning round under concurrency and preserves a stalled owner', async () => {
    const { repo } = gates();
    const results = await Promise.allSettled([enterScanGate(repo, 'target', 'a', 1, 0), enterScanGate(repo, 'target', 'b', 1, 0)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await expect(enterScanGate(repo, 'target', 'later', 1, 0)).rejects.toThrow('another scheduled/manual');
  });
  it('releases concurrent finishing shards without losing an index', async () => {
    const { repo, data } = gates();
    const leave = await Promise.all([enterScanGate(repo, 'target', 'job', 2, 0), enterScanGate(repo, 'target', 'job', 2, 1)]);
    await Promise.all(leave.map(f => f()));
    expect(data.get('target')).toMatchObject({ active: false, finished: [0, 1] });
  });
});
