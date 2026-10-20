import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { RankObservation } from '../src/domain/model.js';
import { MemoryTrackingRepository } from '../src/domain/repository.js';
import { parseTrackingConfig, shardStores, withStores } from '../src/domain/tracking-config.js';
import { generateGrid } from '../src/grid/grid.js';
import { startServer } from '../src/web/server.js';
import type { Server } from 'node:http';

const raw = JSON.parse(await readFile(new URL('../docs/tracking-config.example.json', import.meta.url), 'utf8'));
const keke = raw.stores[0];
const config = parseTrackingConfig({ ...raw, storeSource: { provider: 'mongo' }, stores: [] });

const obs = (keyword: string, organicRank: number | null, observedAt: string, extra: Partial<RankObservation> = {}): RankObservation => ({
  observationId: `web|keke-flushing|${keyword}|${extra.pointId ?? 'r0c0'}|${observedAt}`, surface: 'web', storeId: 'keke-flushing', placeId: keke.placeId,
  keyword, keywordKey: keyword.toLowerCase(), keywordTier: keyword === 'braised food' ? 'core' : 'longTail', pointId: 'r0c0',
  point: { latitude: 0, longitude: 0, distanceKm: 0, ring: 'inner' }, locationMode: 'map_view', observedAt, localDate: observedAt.slice(0, 10), scanId: 'run_1', queryId: 'q0001',
  rank: { status: organicRank === null ? 'not_found' : 'ranked', displayPosition: organicRank, organicRank, listingsObserved: 15, listingStatus: 'captured', stopReason: 'end_of_results' },
  topListings: [{ displayPosition: 1, organicRank: 1, resultType: 'organic', name: 'Crown One', placeId: null, rating: 4, reviewCount: 428, distanceText: null }],
  evidence: { manifestKey: null, resultKey: null, screenshotKeys: ['tracking/web/2026-10-20/point/scan_x/keke-flushing/r0c0/001/shot.png'] }, source: { adapterVersion: null, profileHash: null }, ingestedAt: observedAt, ...extra,
});

describe('store source and sharding', () => {
  it('accepts an empty inline store list only when stores come from the database', () => {
    expect(config.storeSource).toEqual({ provider: 'mongo', collection: 'stores' });
    expect(() => parseTrackingConfig({ ...raw, stores: [] })).toThrow(/nonempty/);
    expect(withStores(config, [keke]).stores).toHaveLength(1);
  });
  it('assigns every store to exactly one shard, stably', () => {
    const stores = Array.from({ length: 40 }, (_, i) => ({ ...parseTrackingConfig(raw).stores[0]!, storeId: `store-${i}`, placeId: `ChIJ${i}` }));
    const shards = [0, 1, 2].map(i => shardStores(stores, i, 3).map(s => s.storeId));
    expect(shards.flat().sort()).toEqual(stores.map(s => s.storeId).sort());
    expect(shards.every(s => s.length > 5)).toBe(true);
    expect(shardStores(stores, 1, 3).map(s => s.storeId)).toEqual(shards[1]);
    expect(() => shardStores(stores, 3, 3)).toThrow();
  });
});

describe('memory repository', () => {
  it('saves, validates, deactivates and summarizes stores', async () => {
    const repo = new MemoryTrackingRepository([obs('braised food', 4, '2026-10-20T10:00:00Z'), obs('braised food', 2, '2026-10-20T12:00:00Z'), obs('卤味', null, '2026-10-20T12:00:00Z')]);
    await repo.saveStore(keke, new Date('2026-10-20T00:00:00Z'));
    await expect(repo.saveStore({ ...keke, storeId: 'copy' })).rejects.toThrow(/placeId already tracked/);
    await expect(repo.saveStore({ ...keke, placeId: 'bad' })).rejects.toThrow(/invalid store/);
    const latest = await repo.latest('keke-flushing');
    expect(latest.map(l => [l.keyword, l.organicRank, l.previousOrganicRank])).toEqual([['braised food', 2, 4], ['卤味', null, null]]);
    expect(await repo.summaries()).toEqual([{ storeId: 'keke-flushing', lastObservedAt: '2026-10-20T12:00:00Z', keywords: 2, ranked: 1, top3: 1, averageOrganicRank: 2 }]);
    expect((await repo.setActive('keke-flushing', false))!.active).toBe(false);
    expect(await repo.listStores()).toEqual([]);
    expect(await repo.listStores({ includeInactive: true })).toHaveLength(1);
  });
});

describe('tracking ui server', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>(resolve => { if (server) server.close(() => resolve()); else resolve(); }));
  async function start(observations: RankObservation[] = [], evidence?: { get(key: string): Promise<Buffer> }) {
    const repo = new MemoryTrackingRepository(observations);
    await repo.saveStore(keke);
    server = startServer({ config, repo, ...(evidence ? { evidence } : {}), now: () => new Date('2026-10-21T00:00:00Z') }, 0);
    await new Promise(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (path: string, init?: RequestInit) => { const res = await fetch(base + path, init); return { status: res.status, type: res.headers.get('content-type'), body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() }; };
    return { repo, call };
  }
  it('serves the page, settings and the store list with summaries', async () => {
    const { call } = await start([obs('braised food', 2, '2026-10-20T12:00:00Z')]);
    const page = await call('/');
    expect(page.status).toBe(200);
    expect(page.body).toContain('Maps Rank Tracker');
    expect((await call('/api/settings')).body).toMatchObject({ timezone: 'America/New_York', storeSource: { provider: 'mongo' } });
    expect((await call('/api/settings')).body.stores).toBeUndefined();
    const list = await call('/api/stores');
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ storeId: 'keke-flushing', summary: { ranked: 1, top3: 1 } });
    expect((await call('/healthz')).body).toEqual({ ok: true });
  });
  it('creates, edits and pauses stores with validation', async () => {
    const { call } = await start();
    const created = await call('/api/stores', { method: 'POST', body: JSON.stringify({ ...keke, storeId: 'only-bear', name: 'Only Bear', placeId: 'ChIJbear' }) });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ storeId: 'only-bear', active: true });
    expect((await call('/api/stores', { method: 'POST', body: JSON.stringify({ ...keke, storeId: 'x', placeId: 'ChIJy', keywords: { core: [] } }) })).status).toBe(400);
    expect((await call('/api/stores', { method: 'POST', body: '{bad' })).status).toBe(400);
    const edited = await call('/api/stores/only-bear', { method: 'PUT', body: JSON.stringify({ ...keke, storeId: undefined, name: 'Only Bear Mineola', placeId: 'ChIJbear' }) });
    expect(edited.body).toMatchObject({ storeId: 'only-bear', name: 'Only Bear Mineola' });
    expect((await call('/api/stores/only-bear', { method: 'PUT', body: JSON.stringify({ ...keke, storeId: 'renamed', placeId: 'ChIJbear' }) })).status).toBe(400);
    expect((await call('/api/stores/only-bear/active', { method: 'PUT', body: JSON.stringify({ active: false }) })).body.active).toBe(false);
    expect((await call('/api/stores/missing')).status).toBe(404);
  });
  it('returns latest ranks, trend and a grid heat map with metrics', async () => {
    const grid = generateGrid({ center: keke.center, radiusKm: 5, size: 5 });
    const gridObs = grid.map((p, i) => obs('braised food', i % 3 === 0 ? null : (i % 7) + 1, '2026-10-18T06:00:00Z', { pointId: p.id, observationId: `g${i}` }));
    const { call } = await start([obs('braised food', 4, '2026-10-19T12:00:00Z'), obs('braised food', 2, '2026-10-20T12:00:00Z'), ...gridObs]);
    const latest = await call('/api/stores/keke-flushing/latest?surface=web');
    expect(latest.body[0]).toMatchObject({ keyword: 'braised food', organicRank: 2, previousOrganicRank: 4 });
    const trend = await call('/api/stores/keke-flushing/trend?surface=web&days=7&keyword=Braised%20Food');
    // The grid scan's centre point is the store point, so it joins the trend.
    expect(trend.body.map((p: { organicRank: number }) => p.organicRank)).toEqual([null, 4, 2]);
    const heat = await call('/api/stores/keke-flushing/grid?surface=web&date=2026-10-18&keyword=braised%20food');
    expect(heat.body.grid).toHaveLength(25);
    expect(heat.body.metrics.points).toBe(25);
    expect(heat.body.cells.filter((c: { observed: boolean }) => c.observed)).toHaveLength(25);
    expect(heat.body.heatMap).toHaveLength(5);
    expect((await call('/api/stores/keke-flushing/grid?keyword=x')).status).toBe(400);
    expect((await call('/api/stores/keke-flushing/trend?surface=ios&keyword=x')).status).toBe(400);
  });
  it('proxies only screenshot keys from the evidence container', async () => {
    const png = Buffer.from([137, 80, 78, 71]);
    const asked: string[] = [];
    const { call } = await start([], { get: async key => { asked.push(key); if (key.includes('missing')) throw new Error('404'); return png; } });
    const ok = await call('/api/evidence?key=' + encodeURIComponent('tracking/web/2026-10-20/point/scan_x/keke-flushing/r0c0/001/shot.png'));
    expect(ok.status).toBe(200);
    expect(ok.type).toBe('image/png');
    for (const key of ['../secret.png', 'tracking/../../x.png', 'claims/2026-10-20.json', 'tracking/web/x.json', '']) expect((await call('/api/evidence?key=' + encodeURIComponent(key))).status).toBe(400);
    expect((await call('/api/evidence?key=' + encodeURIComponent('tracking/web/missing.png'))).status).toBe(404);
    expect(asked).toEqual(['tracking/web/2026-10-20/point/scan_x/keke-flushing/r0c0/001/shot.png', 'tracking/web/missing.png']);
  });
});
