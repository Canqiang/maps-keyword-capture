import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { RankObservation } from '../src/domain/model.js';
import { MemoryTrackingRepository } from '../src/domain/repository.js';
import { parseStore, parseTrackingConfig, planScan, shardStores, withStores } from '../src/domain/tracking-config.js';
import { generateGrid } from '../src/grid/grid.js';
import { createHandler } from '../src/web/server.js';
import { createServer, type Server } from 'node:http';

const raw = JSON.parse(await readFile(new URL('../docs/tracking-config.example.json', import.meta.url), 'utf8'));
const keke = raw.stores[0];
const config = parseTrackingConfig({ ...raw, storeSource: { provider: 'mongo' }, stores: [] });

const obs = (keyword: string, organicRank: number | null, observedAt: string, extra: Partial<RankObservation> = {}): RankObservation => ({
  observationId: `web|keke-flushing|${keyword}|${extra.pointId ?? 'r0c0'}|${observedAt}`, surface: 'web', storeId: 'keke-flushing', placeId: keke.placeId,
  keyword, keywordKey: keyword.toLowerCase(), keywordTier: keyword === 'braised food' ? 'core' : 'longTail', pointId: 'r0c0',
  point: { ...keke.center, distanceKm: 0, ring: 'inner', zoom: 15 }, locationMode: 'map_view', observedAt, localDate: observedAt.slice(0, 10), scanId: 'run_1', queryId: 'q0001',
  rank: { status: organicRank === null ? 'not_found' : 'ranked', displayPosition: organicRank, organicRank, listingsObserved: 15, listingStatus: 'captured', stopReason: 'end_of_results' },
  topListings: [{ displayPosition: 1, organicRank: 1, resultType: 'organic', name: 'Crown One', placeId: null, rating: 4, reviewCount: 428, distanceText: null }],
  quality: { rankingReliable: true, sequenceVerified: true, classificationComplete: true, screenshotCoverageComplete: true, identityResolved: true, organicCoverage: 15, endOfResults: true, resultSurface: 'list', geographicRelevance: null, warnings: [] },
  evidence: { manifestKey: null, resultKey: null, screenshotKeys: ['tracking/web/2026-10-20/point/scan_x/keke-flushing/r0c0/001/shot.png'] }, source: { adapterVersion: 'v1', profileHash: 'profile-a' }, ingestedAt: observedAt, ...extra,
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
    expect(await repo.summaries()).toEqual([{ storeId: 'keke-flushing', surface: 'web', lastObservedAt: '2026-10-20T12:00:00Z', keywords: 2, ranked: 1, top3: 1, averageOrganicRank: 2, unavailable: 0 }]);
    expect((await repo.setActive('keke-flushing', false))!.active).toBe(false);
    expect(await repo.listStores()).toEqual([]);
    expect(await repo.listStores({ includeInactive: true })).toHaveLength(1);
  });
});

describe('tracking ui server', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>(resolve => { if (server) server.close(() => { server = undefined; resolve(); }); else resolve(); }));
  async function start(observations: RankObservation[] = [], evidence?: { get(key: string): Promise<Buffer> }) {
    const repo = new MemoryTrackingRepository(observations);
    await repo.saveStore(keke);
    const handler = createHandler({ config, repo, actor: 'seo', ...(evidence ? { evidence } : {}), now: () => new Date('2026-10-21T00:00:00Z') });
    let received = 0;
    server = createServer((request, response) => { received++; void handler(request, response); });
    // Bind the same address family used by the client. An unspecified-host
    // ephemeral listener can select a different local endpoint on macOS.
    server.listen(0, '127.0.0.1');
    await new Promise(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (path: string, init?: RequestInit) => {
      const before = received;
      const res = await fetch(base + path, { headers: { 'content-type': 'application/json' }, ...init });
      expect(received, `request must reach this test server: ${init?.method ?? 'GET'} ${path}`).toBe(before + 1);
      return { status: res.status, type: res.headers.get('content-type'), body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
    };
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
  it('rejects malformed URLs and cross-origin/non-JSON writes without stopping the server', async () => {
    const { call } = await start();
    expect((await call('/api/stores/%ZZ')).status).toBe(400);
    expect((await call('/api/stores/keke-flushing/active', { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: '{"active":false}' })).status).toBe(415);
    expect((await call('/api/stores/keke-flushing/active', { method: 'PUT', headers: { 'content-type': 'application/json', origin: 'https://other.example' }, body: '{"active":false}' })).status).toBe(403);
    expect((await call('/api/stores/keke-flushing/active', { method: 'PUT', body: 'null' })).status).toBe(400);
    expect((await call('/healthz')).status).toBe(200);
  });
  it('retains geographic expectations during an ordinary edit and rejects identity changes', async () => {
    const { repo, call } = await start();
    const expectedArea = { label: 'Flushing', ...keke.center, radiusKm: 8, source: 'merchant' };
    await repo.saveStore({ ...keke, expectedArea });
    const response = await call('/api/stores/keke-flushing', { method: 'PUT', body: JSON.stringify({ ...keke, name: 'Updated name' }) });
    expect(response.body.expectedArea).toEqual(expectedArea);
    expect((await call('/api/stores/keke-flushing', { method: 'PUT', body: JSON.stringify({ ...keke, placeId: 'ChIJdifferent' }) })).status).toBe(400);
    expect((await repo.getStore('keke-flushing'))!.placeId).toBe(keke.placeId);
  });
  it('saves monitored keywords and targets edited in the UI and logs who changed what', async () => {
    const { call } = await start();
    const points = [{ id: 'keke-center', label: '中心', ...keke.center, distanceKm: 0, direction: '中心', sourceReference: '门店设置' },
      { id: 'keke-3km', label: '3公里', latitude: keke.center.latitude, longitude: keke.center.longitude + 0.0355, distanceKm: 3, direction: '东 90°', sourceReference: '门店设置' }];
    const keywordTargets = [{ keyword: 'braised food', sourceSearchVolumeText: '880 次/月 New York City · Google Search', pointTargets: [{ pointId: 'keke-3km', pointLabel: '3公里', radiusKm: 3, targetRank: 5, targetText: 'Top 5' }] },
      { keyword: '卤味 near me', pointTargets: [] }];
    const saved = await call('/api/stores/keke-flushing', { method: 'PUT', body: JSON.stringify({ ...keke, fixedPoints: points, keywordTargets }) });
    expect(saved.status).toBe(200);
    expect(saved.body.keywordTargets[1]).toEqual({ keyword: '卤味 near me', sourceSearchVolumeText: '', sourceRoleAndConditions: '', pointTargets: [] });
    expect(saved.body.keywordTargets[0].pointTargets[0].targetRank).toBe(5);
    const bad = (targets: unknown) => call('/api/stores/keke-flushing', { method: 'PUT', body: JSON.stringify({ ...keke, fixedPoints: points, keywordTargets: targets }) });
    expect((await bad([{ keyword: 'x', pointTargets: [{ pointId: 'keke-9km', pointLabel: '9', radiusKm: 9, targetRank: 3, targetText: 'Top 3' }] }])).body.error).toMatch(/not a fixed point/);
    expect((await bad([{ keyword: 'Braised  Food' }, { keyword: 'braised food' }])).body.error).toMatch(/repeated/);
    expect((await bad([{ keyword: 'x', pointTargets: [{ pointId: 'keke-3km', pointLabel: '3', radiusKm: 3, targetRank: 21, targetText: 'Top 21' }] }])).status).toBe(400);
    expect((await bad([{ keyword: 'x', scanPoints: ['keke-9km'] }])).body.error).toMatch(/scan point keke-9km/);
    expect((await bad([{ keyword: 'x flushing', scanPoints: ['keke-center'], pointTargets: [{ pointId: 'keke-3km', pointLabel: '3公里', radiusKm: 3, targetRank: 3, targetText: 'Top 3' }] }])).body.error).toMatch(/not scanned/);
    const centerOnly = [...keywordTargets, { keyword: 'chinese food flushing', scanPoints: ['keke-center'] }];
    const plan = planScan(withStores(config, [parseStore({ ...keke, fixedPoints: points, keywordTargets: centerOnly })]), { surface: 'web', tier: 'point' });
    expect(plan.queries.map(q => q.keyword + '@' + q.point.id).sort()).toEqual(['braised food@keke-3km', 'braised food@keke-center', 'chinese food flushing@keke-center', '卤味 near me@keke-3km', '卤味 near me@keke-center']);
    const withBest = [{ keyword: 'braised food', bestVariant: true }, { keyword: 'chinese food flushing', scanPoints: ['keke-center'], bestVariant: true }];
    const bestPlan = planScan(withStores(config, [parseStore({ ...keke, fixedPoints: points, keywordTargets: withBest })]), { surface: 'web', tier: 'point' });
    expect(bestPlan.queries.map(q => q.keyword + '@' + q.point.id).sort()).toEqual(['best braised food@keke-3km', 'best braised food@keke-center', 'best chinese food flushing@keke-center', 'braised food@keke-3km', 'braised food@keke-center', 'chinese food flushing@keke-center']);
    expect((await bad([{ keyword: 'Best Chinese food', bestVariant: true }])).body.error).toMatch(/already starts with best/);
    expect((await bad([{ keyword: 'deli', bestVariant: true }, { keyword: 'best  deli' }])).body.error).toMatch(/already a monitored keyword/);
    await call('/api/stores/keke-flushing/active', { method: 'PUT', body: JSON.stringify({ active: false }) });
    const log = (await call('/api/stores/keke-flushing/changes')).body.changes;
    expect(log.map((c: { action: string }) => c.action)).toEqual(['pause', 'update', 'create']);
    expect(log[1]).toMatchObject({ by: 'seo', fields: ['fixedPoints', 'keywordTargets'], keywordsAdded: ['braised food', '卤味 near me'], keywordsRemoved: [] });
  });
  it('retains approved catalog metadata on ordinary edits and defaults history to the configured center', async () => {
    const point = { id: 'keke-center', label: '中心', ...keke.center, distanceKm: 0, direction: '中心', sourceReference: 'approved report' };
    const monitoringCatalog = { version: 'v1', source: { path: 'approved.html', sha256: 'a'.repeat(64), documentDate: '2026-10-16', sectionId: 'scope', sourceBaselineIsLive: false } };
    const keywordTargets = [{ keyword: 'braised food', sourceSearchVolumeText: '100', sourceRoleAndConditions: 'exact', pointTargets: [{ pointId: point.id, pointLabel: point.label, radiusKm: 0, targetRank: 3, targetText: 'Top3', historicalBaselineDisplay: 'NR20', historicalEvidenceRef: null, sourceCellText: 'NR20 → Top3' }] }];
    const fixed = obs('braised food', 3, '2026-10-20T12:00:00Z', { pointId: point.id });
    const { repo, call } = await start([fixed, obs('braised food', 1, '2026-10-19T12:00:00Z')]);
    await repo.saveStore({ ...keke, fixedPoints: [point], monitoringCatalog, keywordTargets });
    const edited = await call('/api/stores/keke-flushing', { method: 'PUT', body: JSON.stringify({ ...keke, name: 'Catalog store' }) });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ fixedPoints: [point], monitoringCatalog, keywordTargets });
    const current = await call('/api/stores/keke-flushing/timeline?surface=web');
    expect(current.body.pointId).toBe('keke-center');
    expect(current.body.items.map((o: RankObservation) => o.pointId)).toEqual(['keke-center']);
    expect((await call('/api/stores/keke-flushing/latest?surface=web')).body[0].pointId).toBe('keke-center');
    expect((await call('/api/stores/keke-flushing/timeline?surface=web&point=r0c0')).body.items).toHaveLength(1);
  });
  it('returns the requested surface in store summaries', async () => {
    const { call } = await start([obs('braised food', 8, '2026-10-20T12:00:00Z'), obs('braised food', 1, '2026-10-20T12:00:00Z', { surface: 'android' })]);
    expect((await call('/api/stores?surface=web')).body[0].summary).toMatchObject({ surface: 'web', top3: 0, averageOrganicRank: 8 });
    expect((await call('/api/stores?surface=android')).body[0].summary).toMatchObject({ surface: 'android', top3: 1, averageOrganicRank: 1 });
  });
  it('returns latest ranks, trend and a grid heat map with metrics', async () => {
    const grid = generateGrid({ center: keke.center, radiusKm: 5, size: 5 });
    const gridObs = grid.map((p, i) => obs('braised food', i % 3 === 0 ? null : (i % 7) + 1, '2026-10-18T06:00:00Z', { pointId: p.id, point: { ...p, zoom: 15 }, observationId: `g${i}` }));
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
  it('uses captured geometry and one grid run while excluding unreliable and mismatched observations', async () => {
    const spec = { center: keke.center, radiusKm: 1, size: 3 };
    const grid = generateGrid(spec);
    const make = (index: number, time: string, extra: Partial<RankObservation> = {}) => {
      const point = grid[index]!;
      return obs('braised food', 2, time, { gridSpec: spec, gridRunId: 'current-grid', pointId: point.id, point: { ...point, zoom: 15 }, ...extra });
    };
    const failed = make(2, '2026-10-20T12:00:00Z'); failed.rank.status = 'failed';
    const prefix = make(3, '2026-10-20T12:00:00Z'); prefix.rank = { ...prefix.rank, status: 'not_found_in_prefix', organicRank: null };
    const wrong = make(5, '2026-10-20T12:00:00Z'); wrong.point = { ...wrong.point, latitude: 0 };
    const oldRun = make(6, '2026-10-20T10:00:00Z', { gridRunId: 'old-grid' });
    const oldProfile = make(7, '2026-10-20T10:00:00Z', { source: { profileHash: 'old', adapterVersion: 'v1' } });
    const absent = make(1, '2026-10-20T12:00:00Z'); absent.rank = { ...absent.rank, status: 'not_found', organicRank: null };
    const { call } = await start([make(0, '2026-10-20T12:00:00Z'), absent, failed, prefix, wrong, oldRun, oldProfile, obs('braised food', 1, '2026-10-20T14:00:00Z')]);
    const heat = await call('/api/stores/keke-flushing/grid?surface=web&date=2026-10-20&keyword=braised%20food');
    expect(heat.status).toBe(200);
    expect(heat.body.gridSpec).toEqual(spec);
    expect(heat.body.geometrySource).toBe('captured');
    expect(heat.body.grid).toHaveLength(9);
    expect(heat.body.metrics).toMatchObject({ points: 2, found: 1, arp: 2, atrp: 11.5, solv: 0.5 });
    expect(heat.body.cells.filter((c: { observed: boolean }) => c.observed).map((c: { id: string }) => c.id)).toEqual([grid[0]!.id, grid[1]!.id]);
  });
  it('does not turn a point-only scan or changed legacy coordinates into grid coverage', async () => {
    const { repo, call } = await start([obs('braised food', 1, '2026-10-20T14:00:00Z')]);
    const endpoint = '/api/stores/keke-flushing/grid?surface=web&date=2026-10-20&keyword=braised%20food';
    expect((await call(endpoint)).body.metrics).toMatchObject({ points: 0, arp: null, atrp: null, solv: null });
    const oldPoint = generateGrid({ center: keke.center, radiusKm: 1, size: 5 })[0]!;
    repo.observations.splice(0, 1, obs('braised food', 1, '2026-10-20T14:00:00Z', { pointId: oldPoint.id, point: { ...oldPoint, zoom: 15 } }));
    expect((await call(endpoint)).body.metrics).toMatchObject({ points: 0, atrp: null, solv: null });
  });
  it('keeps valid cells in the newest grid run when its last result is missing, without falling back to older runs', async () => {
    const spec = { center: keke.center, radiusKm: 1, size: 3 };
    const grid = generateGrid(spec);
    const valid = obs('braised food', 2, '2026-10-20T10:00:00Z', { gridSpec: spec, gridRunId: 'grid-current', pointId: grid[0]!.id, point: { ...grid[0]!, zoom: 15 } });
    const failed = obs('braised food', null, '2026-10-20T11:00:00Z', { gridSpec: spec, gridRunId: 'grid-current', pointId: grid[1]!.id, point: { ...grid[1]!, zoom: null }, locationMode: 'query_only' });
    failed.rank.status = 'failed';
    const old = { ...valid, gridRunId: 'grid-old', pointId: grid[2]!.id, point: { ...grid[2]!, zoom: 15 }, observedAt: '2026-10-20T09:00:00Z' };
    const { repo, call } = await start([old, valid, failed]);
    const endpoint = '/api/stores/keke-flushing/grid?surface=web&date=2026-10-20&keyword=braised%20food';
    expect((await call(endpoint)).body.metrics.points).toBe(1);
    repo.observations.push({ ...failed, gridRunId: 'grid-latest-all-failed', observedAt: '2026-10-20T12:00:00Z' });
    expect((await call(endpoint)).body.metrics.points).toBe(0);
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
