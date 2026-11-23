import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryTrackingRepository, type StoreSummary } from '../src/domain/repository.js';
import { parseTrackingConfig } from '../src/domain/tracking-config.js';
import { createHandler } from '../src/web/server.js';

const raw = JSON.parse(await readFile(new URL('../docs/tracking-config.example.json', import.meta.url), 'utf8'));
const config = parseTrackingConfig(raw);
const store = raw.stores[0];
const summary = (observedAt: string): StoreSummary => ({
  storeId: store.storeId, surface: 'web', lastObservedAt: observedAt,
  keywords: 1, ranked: 1, top3: 1, averageOrganicRank: 2, unavailable: 0,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

let server: Server;
afterEach(async () => { if (server) await new Promise<void>(done => server.close(() => done())); });

async function setup() {
  const repo = new MemoryTrackingRepository();
  await repo.saveStore(store);
  let clock = Date.parse('2026-11-23T06:00:00Z');
  const targets = vi.fn(async () => []);
  const getSummaries = vi.spyOn(repo, 'summaries');
  const scans = { targets, jobs: async () => [], trigger: async () => { throw new Error('unexpected collection'); } };
  server = createServer(createHandler({ config, repo, scans, now: () => new Date(clock) }));
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { repo, getSummaries, targets, advance: (ms: number) => { clock += ms; },
    request: (path: string, init?: RequestInit) => fetch(base + path, init) };
}

describe('homepage rank summary sharing', () => {
  it('coalesces simultaneous store-list and health requests and keeps Web and Android separate', async () => {
    const { getSummaries, targets, request, advance } = await setup();
    const reading = deferred<void>(), pending = deferred<StoreSummary[]>();
    getSummaries.mockImplementationOnce(() => { reading.resolve(); return pending.promise; });
    const stores = request('/api/stores');
    await reading.promise;
    const healthStarted = deferred<void>();
    targets.mockImplementationOnce(async () => { healthStarted.resolve(); return []; });
    const health = request('/api/scans/health');
    await healthStarted.promise;
    const stamp = '2026-11-23T05:00:00Z';
    pending.resolve([summary(stamp)]);
    expect((await (await stores).json())[0].summary.lastObservedAt).toBe(stamp);
    expect(await (await health).json()).toMatchObject({ latestObservationAt: stamp, stale: false });
    await request('/api/stores?surface=web');
    expect(getSummaries).toHaveBeenCalledTimes(1);
    await request('/api/stores?surface=android');
    expect(getSummaries.mock.calls).toEqual([[{ surface: 'web' }], [{ surface: 'android' }]]);
    advance(5001);
    await request('/api/scans/health');
    expect(getSummaries.mock.calls.at(-1)).toEqual([{ surface: 'web' }]);
    expect(getSummaries).toHaveBeenCalledTimes(3);
  });

  it('serves the combined repository read to both endpoints and invalidates it on store mutations', async () => {
    const { repo, getSummaries, request } = await setup();
    const storeRow = await repo.getStore(store.storeId);
    const latest = await repo.rosterLatest(store.storeId, 'web');
    const stamp = '2026-11-23T05:00:00Z';
    const rows = [{ ...storeRow!, summary: summary(stamp), rosterLatest: latest }];
    const combined = vi.fn(async () => rows);
    Object.assign(repo, { portfolio: combined });
    const roster = vi.spyOn(repo, 'rosterLatest');
    expect((await (await request('/api/scans/health')).json()).latestObservationAt).toBe(stamp);
    expect(await (await request('/api/stores')).json()).toEqual(rows);
    expect(combined).toHaveBeenCalledTimes(1);
    expect(getSummaries).not.toHaveBeenCalled();
    expect(roster).not.toHaveBeenCalled();

    const headers = { 'content-type': 'application/json' };
    expect((await request('/api/stores', { method: 'POST', headers, body: JSON.stringify({ ...store, storeId: 'new-store', placeId: 'ChIJnew' }) })).status).toBe(201);
    await request('/api/stores');
    expect(combined).toHaveBeenCalledTimes(2);
    expect((await request(`/api/stores/${store.storeId}/active`, { method: 'PUT', headers, body: JSON.stringify({ active: false }) })).status).toBe(200);
    await request('/api/scans/health');
    expect(combined).toHaveBeenCalledTimes(3);
  });

  it('retries the summary immediately after a database failure', async () => {
    const { getSummaries, request } = await setup();
    getSummaries.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await request('/api/scans/health')).status).toBe(500);
    expect((await request('/api/stores')).status).toBe(200);
    await request('/api/scans/health');
    expect(getSummaries).toHaveBeenCalledTimes(2);
  });

  it('refreshes after a store change even if the old read finishes later', async () => {
    const { getSummaries, request } = await setup();
    const reading = deferred<void>(), pending = deferred<StoreSummary[]>();
    getSummaries.mockImplementationOnce(() => { reading.resolve(); return pending.promise; });
    const first = request('/api/scans/health');
    await reading.promise;
    expect((await request(`/api/stores/${store.storeId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(store) })).status).toBe(200);
    const newer = '2026-11-23T05:30:00Z';
    const secondStarted = deferred<void>();
    getSummaries.mockImplementationOnce(async () => { secondStarted.resolve(); return [summary(newer)]; });
    // An invalidation must detach the old pending request before the next reader arrives.
    const second = request('/api/stores');
    await secondStarted.promise;
    pending.resolve([summary('2026-11-23T04:00:00Z')]);
    expect((await first).status).toBe(200);
    expect((await (await second).json())[0].summary.lastObservedAt).toBe(newer);
    expect((await (await request('/api/scans/health')).json()).latestObservationAt).toBe(newer);
    expect(getSummaries).toHaveBeenCalledTimes(2);
  });
});
