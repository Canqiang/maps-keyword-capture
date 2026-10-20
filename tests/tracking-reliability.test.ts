import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import { MemoryTrackingRepository, MongoTrackingRepository } from '../src/domain/repository.js';
import type { RankObservation } from '../src/domain/model.js';
import { createHandler } from '../src/web/server.js';
import { UI_HTML } from '../src/web/ui.js';
import { parseTrackingConfig } from '../src/domain/tracking-config.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const raw = JSON.parse(await readFile(new URL('../docs/tracking-config.example.json', import.meta.url), 'utf8'));
const store = raw.stores[0];
const config = parseTrackingConfig(raw);
const quality = { rankingReliable: true, sequenceVerified: true, classificationComplete: true, screenshotCoverageComplete: true, identityResolved: true, organicCoverage: 20, endOfResults: true, resultSurface: 'list', geographicRelevance: null, warnings: [] };
const observation = (rank: number | null, time: string, extra: Partial<RankObservation> = {}): RankObservation => ({
  observationId: time, surface: 'web', storeId: store.storeId, placeId: store.placeId,
  keyword: 'braised food', keywordKey: 'braised food', keywordTier: 'core', pointId: 'r0c0',
  point: { ...store.center, distanceKm: 0, ring: 'inner', zoom: 15 }, locationMode: 'map_view',
  observedAt: time, localDate: time.slice(0, 10), scanId: time, queryId: 'q1',
  rank: { status: rank === null ? 'not_found' : 'ranked', organicRank: rank, displayPosition: rank, listingsObserved: 20, listingStatus: 'captured', stopReason: 'end_of_results' },
  quality, topListings: [], evidence: { manifestKey: null, resultKey: null, screenshotKeys: [] },
  source: { adapterVersion: 'v1', profileHash: 'profile-a' }, ingestedAt: time, ...extra,
} as RankObservation);

describe('tracking history boundaries', () => {
  it('separates channels in summaries and excludes failed numeric ranks', async () => {
    const failed = observation(1, '2026-10-20T11:00:00Z', { keyword: 'failed', keywordKey: 'failed' });
    failed.rank.status = 'failed';
    const repo = new MemoryTrackingRepository([observation(8, '2026-10-20T10:00:00Z'), observation(1, '2026-10-20T10:00:00Z', { surface: 'android', locationMode: 'device_gps' }), failed]);
    await repo.saveStore(store);
    expect(await repo.summaries({ surface: 'web' })).toMatchObject([{ surface: 'web', ranked: 1, top3: 0, averageOrganicRank: 8 }]);
    expect(await repo.summaries({ surface: 'android' })).toMatchObject([{ surface: 'android', ranked: 1, top3: 1, averageOrganicRank: 1 }]);
  });
  it('requires a new store ID for a place identity or center change', async () => {
    const repo = new MemoryTrackingRepository();
    await repo.saveStore(store);
    await expect(repo.saveStore({ ...store, placeId: 'ChIJanother' })).rejects.toThrow(/identity|new store/i);
    await expect(repo.saveStore({ ...store, center: { ...store.center, latitude: 41 } })).rejects.toThrow(/identity|new store/i);
    await expect(repo.saveStore({ ...store, name: 'Renamed merchant' })).resolves.toMatchObject({ name: 'Renamed merchant' });
  });
  it('does not compare a current observation with another profile or place', async () => {
    const repo = new MemoryTrackingRepository([
      observation(1, '2026-10-20T09:00:00Z', { source: { adapterVersion: 'v1', profileHash: 'old-profile' } }),
      observation(4, '2026-10-20T10:00:00Z'),
      observation(2, '2026-10-20T11:00:00Z', { placeId: 'ChIJother' }),
    ]);
    await repo.saveStore(store);
    expect(await repo.latest(store.storeId)).toMatchObject([{ organicRank: 4, previousOrganicRank: null }]);
    expect(await repo.trend(store.storeId, 'braised food', { surface: 'web', since: '2026-10-01' })).toMatchObject([{ organicRank: 4 }]);
  });
  it('returns the newest 2000 observations in chronological order', async () => {
    const rows = Array.from({ length: 2003 }, (_, i) => observation(4, new Date(Date.UTC(2026, 9, 20, 0, 0, i)).toISOString()));
    const repo = new MemoryTrackingRepository(rows);
    await repo.saveStore(store);
    const trend = await repo.trend(store.storeId, 'braised food', { surface: 'web', since: '2026-10-01' });
    expect(trend).toHaveLength(2000);
    expect(trend[0]!.observedAt).toBe('2026-10-20T00:00:03.000Z');
    expect(trend.at(-1)!.observedAt).toBe('2026-10-20T00:33:22.000Z');
  });
  it('retains missing-result gaps between comparable observations without admitting older profiles', async () => {
    const missing = observation(null, '2026-10-20T11:00:00Z', { locationMode: 'query_only', point: { ...store.center, distanceKm: 0, ring: 'inner', zoom: null } });
    missing.rank.status = 'failed';
    const repo = new MemoryTrackingRepository([
      observation(1, '2026-10-20T08:00:00Z'),
      observation(1, '2026-10-20T09:00:00Z', { source: { adapterVersion: 'v1', profileHash: 'different-profile' } }),
      observation(2, '2026-10-20T10:00:00Z'), missing, observation(3, '2026-10-20T12:00:00Z'),
    ]);
    await repo.saveStore(store);
    const trend = await repo.trend(store.storeId, 'braised food', { surface: 'web', since: '2026-10-01' });
    expect(trend.map(row => [row.status, row.organicRank, row.eligible])).toEqual([['ranked', 2, true], ['failed', null, false], ['ranked', 3, true]]);
    repo.observations.push({ ...missing, observedAt: '2026-10-20T13:00:00Z' });
    expect((await repo.trend(store.storeId, 'braised food', { surface: 'web', since: '2026-10-01' })).at(-1)).toMatchObject({ status: 'failed', eligible: false });
    repo.observations.push({ ...missing, observedAt: '2026-10-20T14:00:00Z', source: { adapterVersion: 'v1', profileHash: 'new-profile' } });
    expect(await repo.trend(store.storeId, 'braised food', { surface: 'web', since: '2026-10-01' })).toMatchObject([{ observedAt: '2026-10-20T14:00:00Z', status: 'failed', eligible: false }]);
  });
  it.each(['connect', 'indexes'])('closes the Mongo client after a failed %s stage', async stage => {
    let closed = 0;
    const client = {
      connect: async () => { if (stage === 'connect') throw new Error('connect failed'); },
      db: () => ({ collection: () => ({ createIndexes: async () => { throw new Error('index failed'); } }) }),
      close: async () => { closed++; },
    } as unknown as MongoClient;
    const repo = new MongoTrackingRepository({ uri: 'mongodb://unused', database: 'test', createClient: () => client });
    await expect(repo.listStores()).rejects.toThrow();
    await repo.close();
    expect(closed).toBe(1);
  });
  it('retains missing metadata failures in bounded Mongo trends and returns chronological points', async () => {
    const newest = observation(4, '2026-10-20T12:00:00Z');
    const missing = observation(null, '2026-10-20T11:00:00Z', { locationMode: 'query_only', point: { ...store.center, distanceKm: 0, ring: 'inner', zoom: null } });
    missing.rank.status = 'failed';
    const rows = [newest, missing, observation(3, '2026-10-20T10:00:00Z')];
    let query: Record<string, unknown> = {}, options: Record<string, unknown> = {};
    const client = {
      connect: async () => {},
      db: () => ({ collection: (name: string) => name === 'stores' ? {
        createIndexes: async () => {}, findOne: async () => ({ ...store, _id: store.storeId }),
      } : {
        findOne: async () => newest,
        find: (filter: Record<string, unknown>, opts: Record<string, unknown>) => {
          query = filter; options = opts;
          return { toArray: async () => rows.filter(row => !filter.locationMode || row.locationMode === filter.locationMode) };
        },
      } }),
      close: async () => {},
    } as unknown as MongoClient;
    const repo = new MongoTrackingRepository({ uri: 'mongodb://unused', database: 'test', createClient: () => client });
    const trend = await repo.trend(store.storeId, 'braised food', { surface: 'web', since: '2026-10-01' });
    expect(query).toMatchObject({ placeId: store.placeId, observedAt: { $gte: '2026-10-01' } });
    expect(options).toMatchObject({ sort: { observedAt: -1 }, limit: 2000 });
    expect(trend.map(row => [row.organicRank, row.eligible])).toEqual([[3, true], [null, false], [4, true]]);
    await repo.close();
  });
});

describe('HTTP malformed requests', () => {
  it('returns a controlled 400 for malformed path escaping', async () => {
    const handler = createHandler({ config, repo: new MemoryTrackingRepository() });
    let status = 0, body = '';
    const response = { writeHead: (code: number) => { status = code; }, end: (value: string) => { body = value; } } as unknown as ServerResponse;
    await expect(handler({ method: 'GET', url: '/api/stores/%ZZ' } as IncomingMessage, response)).resolves.toBeUndefined();
    expect(status).toBe(400);
    expect(JSON.parse(body).error).toMatch(/URL|path/i);
  });
});

/** Runs the shipped inline script; only the browser DOM/fetch boundary is simulated. */
function uiContext(fetcher: (url: string, options?: RequestInit) => Promise<unknown>) {
  const elements = new Map<string, { innerHTML: string; textContent: string; value: string; onclick?: () => Promise<void>; className: string }>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', value: '', className: '' });
    return elements.get(id)!;
  };
  const context = createContext({
    document: { getElementById: element, querySelectorAll: () => [] },
    location: { hash: '#/new' }, window: { addEventListener: () => {} }, URLSearchParams, Date,
    setTimeout: () => 0,
    fetch: async (url: string, options?: RequestInit) => ({ ok: true, json: async () => fetcher(url, options) }),
  });
  const script = UI_HTML.match(/<script>([\s\S]*)<\/script>/)![1]!;
  runInContext(script.replace(/\nroute\(\);\s*$/, '\n'), context);
  runInContext('settings = { defaults: { grid: { radiusKm: 5, size: 5 } }, timezone: "UTC" };', context);
  return { context, element, run: (source: string) => runInContext(source, context) };
}

describe('shipped UI behavior', () => {
  it('preserves expectedArea when editing ordinary fields', async () => {
    let submitted: Record<string, unknown> | undefined;
    const ui = uiContext(async (_url, options) => { submitted = JSON.parse(options!.body as string); return submitted; });
    const source = { ...store, expectedArea: { label: 'Flushing', ...store.center, radiusKm: 8, source: 'merchant' } };
    ui.context.storeFixture = source;
    ui.run('storeForm(storeFixture)');
    for (const [id, value] of Object.entries({ storeId: store.storeId, name: 'New display name', placeId: store.placeId, lat: String(store.center.latitude), lng: String(store.center.longitude), core: 'braised food', aliases: 'Keke' })) ui.element(id).value = value;
    await ui.element('save').onclick!();
    expect(submitted?.expectedArea).toEqual(source.expectedArea);
  });
  it('renders unavailable trend observations as gaps, never rank 21', async () => {
    const points = [
      { observedAt: '2026-10-20T10:00:00Z', organicRank: 2, status: 'ranked' },
      { observedAt: '2026-10-20T11:00:00Z', organicRank: null, status: 'failed' },
      { observedAt: '2026-10-20T12:00:00Z', organicRank: 3, status: 'ranked' },
    ];
    const ui = uiContext(async () => points);
    await ui.run('trendPanel("keke", {keyword:"braised food"}, "web")');
    const html = ui.element('detail').innerHTML;
    expect(html.match(/<circle/g)).toHaveLength(2);
    expect(html).not.toContain('未上榜');
    expect(html.match(/<path[^>]+d="([^"]*)"/)?.[1]?.match(/M/g)).toHaveLength(2);
  });
  it('keeps a newer detail request when an older request resolves last', async () => {
    let resolveOld!: (value: unknown) => void;
    const ui = uiContext(async url => url.includes('old') ? new Promise(resolve => { resolveOld = resolve; }) : []);
    const old = ui.run('trendPanel("keke", {keyword:"old"}, "web")');
    await ui.run('trendPanel("keke", {keyword:"new"}, "web")');
    resolveOld([]);
    await old;
    expect(ui.element('detail').innerHTML).toContain('new');
    expect(ui.element('detail').innerHTML).not.toContain('old');
  });
  it('does not let an old route replace the current page', async () => {
    let resolveOld!: (value: unknown) => void;
    const ui = uiContext(async url => url.startsWith('/api/stores?') ? new Promise(resolve => { resolveOld = resolve; }) : {});
    ui.run('location.hash="#/"');
    const old = ui.run('route()');
    ui.run('location.hash="#/new"');
    await ui.run('route()');
    resolveOld([]);
    await old;
    expect(ui.element('app').innerHTML).toContain('新增门店');
  });
  it('renders missing grid metric denominators as unavailable', async () => {
    const ui = uiContext(async () => ({ grid: [], cells: [], metrics: { points: 0, found: 0, arp: null, atrp: null, solv: null, rings: { inner: { arp: null }, middle: { arp: null }, outer: { arp: null } } } }));
    await ui.run('gridPanel("keke", {keyword:"food"}, "web", "2026-10-20")');
    expect(ui.element('detail').innerHTML).not.toContain('>null<');
    expect(ui.element('detail').innerHTML).not.toContain('>0%<');
  });
});
