import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryTrackingRepository } from '../src/domain/repository.js';
import type { RankObservation } from '../src/domain/model.js';
import { parseTrackingConfig } from '../src/domain/tracking-config.js';
import { generateGrid } from '../src/grid/grid.js';
import { startServer } from '../src/web/server.js';

vi.mock('../src/web/ui.js', () => ({ UI_HTML: '<!doctype html><title>test UI</title>' }));

const raw = JSON.parse(await readFile(new URL('../docs/tracking-config.example.json', import.meta.url), 'utf8'));
const store = { ...raw.stores[0], keywords: { core: ['braised food', 'not found', 'legacy', 'new word'], longTail: [] } };
const config = parseTrackingConfig({ ...raw, storeSource: { provider: 'mongo' }, stores: [] });
const make = (id: string, time = '2026-10-20T12:00:00Z', extra: Partial<RankObservation> = {}): RankObservation => ({
  observationId: id, surface: 'web', storeId: store.storeId, placeId: store.placeId,
  keyword: 'braised food', keywordKey: 'braised food', keywordTier: 'core', pointId: 'r0c0',
  point: { ...store.center, zoom: 15, distanceKm: 0, ring: 'inner' }, locationMode: 'map_view',
  observedAt: time, localDate: time.slice(0, 10), scanId: 'scan', queryId: id,
  rank: { status: 'ranked', displayPosition: 3, organicRank: 2, listingsObserved: 15, listingStatus: 'captured', stopReason: 'end_of_results' },
  quality: { rankingReliable: true, sequenceVerified: true, classificationComplete: true, screenshotCoverageComplete: true, identityResolved: true, organicCoverage: 15, endOfResults: true, resultSurface: 'list', geographicRelevance: null, warnings: [] },
  topListings: [], evidence: { manifestKey: 'tracking/web/manifest.json', resultKey: 'tracking/web/query.json', screenshotKeys: [`tracking/web/${id.replace(/[^\w-]/g, '_')}.png`] },
  source: { adapterVersion: 'v1', profileHash: 'profile' }, ingestedAt: time, ...extra,
});

describe('historical evidence API', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>(resolve => { if (server) server.close(() => resolve()); else resolve(); }));
  async function start(rows: RankObservation[] = [], readOnly = false) {
    const repo = new MemoryTrackingRepository(rows);
    await repo.saveStore(store);
    server = startServer({ config, repo, readOnly, previewInfo: { kind: 'test snapshot' }, now: () => new Date('2026-10-21T02:00:00Z') }, 0);
    await new Promise(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (path: string, init?: RequestInit) => { const response = await fetch(base + path, { headers: { 'content-type': 'application/json' }, ...init }); return { status: response.status, body: await response.json() }; };
    return { repo, call };
  }
  const path = `/api/stores/${store.storeId}`;
  const timeline = `${path}/timeline?surface=web&from=2026-10-01&to=2026-10-20`;

  it('paginates equal timestamps without omitting failures, legacy evidence or cohort transitions', async () => {
    const failed = make('a'); failed.rank.status = 'failed';
    const legacy = make('b', undefined, { point: { latitude: null, longitude: null, distanceKm: null, ring: null }, locationMode: 'query_only' }); delete legacy.quality;
    const changed = make('c', undefined, { source: { adapterVersion: 'v2', profileHash: 'new-profile' } });
    const { call } = await start([changed, legacy, failed, make('foreign', undefined, { placeId: 'ChIJother' })]);
    const first = await call(timeline + '&limit=2');
    expect(first.status).toBe(200);
    expect(first.body.items.map((row: RankObservation) => row.observationId)).toEqual(['a', 'b']);
    expect(first.body).toMatchObject({ complete: false, timezone: config.timezone });
    expect(first.body.items[0]).toMatchObject({ eligible: false, metricOrganicRank: null, rank: { status: 'failed' } });
    expect(first.body.items[1]).toMatchObject({ eligible: false, cohortKey: null });
    const second = await call(timeline + '&limit=2&cursor=' + encodeURIComponent(first.body.nextCursor));
    expect(second.body.items.map((row: RankObservation) => row.observationId)).toEqual(['c']);
    expect(second.body).toMatchObject({ complete: true, nextCursor: null });
    expect((await call(timeline.replace('surface=web', 'surface=android') + '&cursor=' + first.body.nextCursor)).status).toBe(400);
  });
  it('sends lean timeline rows while the evidence endpoint keeps the full record', async () => {
    const row = make('lean');
    row.topListings = [{ displayPosition: 1, organicRank: 1, resultType: 'organic', name: 'Crown One', placeId: null, rating: 4, reviewCount: 428, distanceText: null }];
    const { call } = await start([row]);
    const item = (await call(timeline)).body.items[0];
    expect(item).toMatchObject({ observationId: 'lean', eligible: true, evidence: { manifestKey: 'tracking/web/manifest.json' }, quality: { rankingReliable: true }, rank: { status: 'ranked', organicRank: 2 } });
    expect(item.topListings).toBeUndefined();
    expect(item.evidence.screenshotKeys).toBeUndefined();
    expect(item.quality.warnings).toBeUndefined();
    expect(item.source).toEqual({ adapterVersion: 'v1', profileHash: 'profile' });
    expect(item.ingestedAt).toBeUndefined();
    const full = (await call(`${path}/observations/lean?surface=web`)).body;
    expect(full.topListings).toHaveLength(1);
    expect(full.evidence.screenshotKeys).toEqual(['tracking/web/lean.png']);
    expect(full.ingestedAt).toBe('2026-10-20T12:00:00Z');
  });
  it('requires an explicit surface and a real bounded date range', async () => {
    const { call } = await start();
    for (const suffix of ['/timeline', '/points', '/observations/id', '/grid-runs?keyword=x&date=2026-10-20']) expect((await call(path + suffix)).status).toBe(400);
    for (const query of ['from=2026-02-30&to=2026-03-01', 'from=2026-01-01&to=2026-10-20', 'from=2026-10-21&to=2026-10-20', 'limit=2001', 'cursor=not-a-valid-cursor']) expect((await call(`${path}/timeline?surface=web&${query}`)).status).toBe(400);
    const defaults = await call(`${path}/timeline?surface=web`);
    expect(defaults.body).toMatchObject({ from: '2026-10-07', to: '2026-10-20' });
  });
  it('opens the exact owned observation, preserves every screenshot and excludes unrecognized fields', async () => {
    const id = 'v2|web|keke|scan%2Fone|attempt|q|qa';
    const row = make(id); row.evidence.screenshotKeys = Array.from({ length: 12 }, (_, i) => `tracking/web/${i}.png`);
    const { call } = await start([Object.assign(row, { credentials: 'must not leak' }), make('alien', undefined, { placeId: 'ChIJother' })]);
    const result = await call(`${path}/observations/${encodeURIComponent(id)}?surface=web`);
    expect(result.status).toBe(200); expect(result.body.observationId).toBe(id);
    expect(result.body.evidence.screenshotKeys).toHaveLength(12); expect(result.body.credentials).toBeUndefined();
    expect((await call(`${path}/observations/alien?surface=web`)).status).toBe(404);
    expect((await call(`${path}/observations/${encodeURIComponent(id)}?surface=android`)).status).toBe(404);
  });
  it('partitions the current keyword roster without dropping legacy or adding removed keywords', async () => {
    const absent = make('absent', undefined, { keyword: 'not found', keywordKey: 'not found' }); absent.rank = { ...absent.rank, status: 'not_found', organicRank: null };
    const legacy = make('legacy', undefined, { keyword: 'legacy', keywordKey: 'legacy', point: { latitude: null, longitude: null, distanceKm: null, ring: null } }); delete legacy.quality;
    const { call } = await start([make('ranked'), absent, legacy, make('removed', '2026-10-20T18:00:00Z', { keyword: 'removed', keywordKey: 'removed' })]);
    expect((await call('/api/stores?surface=web')).body[0].rosterLatest).toMatchObject({ configured: 4, withRecord: 3, qualifiedRanked: 1, top3: 1, qualifiedAbsent: 1, unavailable: 1, noRecord: 1, historicalOnly: 1, oldestObservedAt: '2026-10-20T12:00:00Z', newestObservedAt: '2026-10-20T12:00:00Z' });
  });
  it('discovers surrounding points with observed geometry and unavailable latest GPS', async () => {
    const point = { latitude: 40, longitude: -73, distanceKm: 1, ring: 'inner' as const };
    const { call } = await start([make('old', '2026-10-19T12:00:00Z', { pointId: 'north', point }), make('new', undefined, { pointId: 'north', point: { ...point, latitude: null, longitude: null }, locationMode: 'query_only' })]);
    const response = await call(path + '/points?surface=web');
    expect(response.body.points).toHaveLength(1);
    expect(response.body.points[0]).toMatchObject({ pointId: 'north', coordinateStatus: 'unavailable', coordinateVariants: 2, observations: 2, latestObservationId: 'new', observedFrom: '2026-10-19T12:00:00Z' });
    expect((await call(timeline + '&point=north')).body.items).toHaveLength(2);
  });
  it('selects exact grid runs and preserves failed attempts as clickable unavailable cells', async () => {
    const spec = { center: store.center, radiusKm: 1, size: 3 }; const grid = generateGrid(spec);
    const old = make('old', '2026-10-20T09:00:00Z', { pointId: grid[0]!.id, point: { ...grid[0]!, zoom: 15 }, gridSpec: spec, gridRunId: 'old-run' });
    const failed = make('failed', '2026-10-20T10:00:00Z', { pointId: grid[1]!.id, point: { ...grid[1]!, zoom: null }, locationMode: 'query_only', gridSpec: spec, gridRunId: 'new-run' }); failed.rank.status = 'failed';
    const { call } = await start([old, failed]);
    const query = '?surface=web&keyword=braised%20food&date=2026-10-20';
    const runs = await call(path + '/grid-runs' + query); expect(runs.body.runs.map((r: { gridRunId: string }) => r.gridRunId)).toEqual(['new-run', 'old-run']);
    const latest = await call(path + '/grid' + query);
    expect(latest.body).toMatchObject({ gridRunId: 'new-run', plannedPoints: 9, attemptedPoints: 1, qualifiedPoints: 0 });
    expect(latest.body.cells.find((c: { id: string }) => c.id === grid[1]!.id)).toMatchObject({ attempted: true, eligible: false, observationId: 'failed', status: 'failed' });
    expect((await call(path + '/grid' + query + '&gridRunId=old-run')).body).toMatchObject({ gridRunId: 'old-run', qualifiedPoints: 1 });
    expect((await call(path + '/grid' + query + '&gridRunId=other-run')).status).toBe(404);
  });
  it('omits local paths, traversal and signed URLs from evidence references', async () => {
    const row = make('paths');
    row.evidence = { manifestKey: '/Users/private/manifest.json', resultKey: 'https://account.blob.core.windows.net/x?sig=secret', screenshotKeys: ['/tmp/private.png', 'tracking/web/%2e%2e/private.png', 'tracking/web/valid.png?sig=secret', 'tracking/web/valid.png'] };
    const { call } = await start([row]);
    const result = await call(`${path}/observations/paths?surface=web`);
    expect(result.body.evidence).toEqual({ manifestKey: null, resultKey: null, screenshotKeys: ['tracking/web/valid.png'] });
    expect(JSON.stringify(result.body)).not.toMatch(/\/Users\/|secret|\/tmp\//);
  });
  it('enforces read-only mode on every mutation while leaving reads available', async () => {
    const { call, repo } = await start([], true);
    expect((await call('/api/settings')).body).toMatchObject({ readOnly: true, previewInfo: { kind: 'test snapshot' } });
    for (const [endpoint, method] of [['/api/stores', 'POST'], [path, 'PUT'], [path + '/active', 'PUT']]) expect((await call(endpoint!, { method, body: JSON.stringify({ active: false }) })).status).toBe(403);
    expect((await repo.getStore(store.storeId))!.active).toBe(true);
  });
});

describe('historical repository read contracts', () => {
  it('retains unknown-center archive stores without pretending they can plan a location scan', async () => {
    const repo = new MemoryTrackingRepository([make('legacy')]);
    repo.stores.set(store.storeId, { ...store, active: true, center: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z' });
    expect((await repo.listStores())[0]!.center).toBeNull();
    expect(await repo.latest(store.storeId)).toEqual([]);
    expect((await repo.timeline(store.storeId, { surface: 'web', pointId: 'r0c0', from: '2026-10-20', to: '2026-10-20', limit: 2000 })).items[0]!.observationId).toBe('legacy');
    await expect(repo.saveStore(store)).rejects.toThrow(/reviewed migration/);
  });
});
