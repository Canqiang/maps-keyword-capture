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
  type Element = { innerHTML: string; textContent: string; value: string; onclick?: () => Promise<void>; onsubmit?: (e: {preventDefault(): void}) => void; className: string; querySelectorAll(): never[] };
  const elements = new Map<string, Element>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', value: '', className: '', querySelectorAll: () => [] });
    return elements.get(id)!;
  };
  const context = createContext({
    document: { getElementById: element, querySelectorAll: () => [] },
    location: { hash: '#new' }, window: { addEventListener: () => {} }, URLSearchParams, Date, AbortController,
    history: { replaceState: () => {} }, setTimeout: () => 0,
    fetch: async (url: string, options?: RequestInit) => ({ ok: true, json: async () => fetcher(url, options) }),
  });
  const script = UI_HTML.match(/<script>([\s\S]*)<\/script>/)![1]!;
  runInContext(script.replace(/;route\(\);\s*$/, ';'), context);
  runInContext('settings = { defaults: { grid: { radiusKm: 5, size: 5 } }, timezone: "UTC" }; controller = new AbortController();', context);
  return { context, element, run: (source: string) => runInContext(source, context) };
}
const uiHistory = (id: string, date: string, rank: number | null, eligible = true) => ({
  observationId: id, observedAt: date + 'T12:00:00Z', localDate: date, keyword: 'braised food', keywordKey: 'braised food',
  eligible, metricOrganicRank: rank, cohortKey: 'same', rank: { status: eligible ? 'ranked' : 'failed', organicRank: rank },
  point: { latitude: 40, longitude: -73 }, pointId: 'r0c0', surface: 'web', locationMode: 'map_view', source: {}, evidence: { screenshotKeys: [] }, topListings: [],
});
describe('shipped UI behavior', () => {
  it('preserves expectedArea when editing ordinary fields through the reviewed save flow', async () => {
    let submitted: Record<string, unknown> | undefined;
    const source = { ...store, expectedArea: { label: 'Flushing', ...store.center, radiusKm: 8, source: 'merchant' } };
    const ui = uiContext(async (_url, options) => { if (options?.method) { submitted = JSON.parse(options.body as string); return submitted; } return source; });
    await ui.run('settingsView({id:"keke",surface:"web",view:"settings"}, revision)');
    for (const [id, value] of Object.entries({ storeId: store.storeId, name: 'New display name', placeId: store.placeId, lat: String(store.center.latitude), lng: String(store.center.longitude), core: 'braised food', aliases: 'Keke', active: 'true' })) ui.element(id).value = value;
    ui.element('store-form').onsubmit!({ preventDefault() {} });
    expect(submitted).toBeUndefined();
    await ui.element('confirm-save').onclick!();
    expect(submitted?.expectedArea).toEqual(source.expectedArea);
  });
  it('renders unavailable latest daily trend observations as gaps, never rank 21', () => {
    const ui = uiContext(async () => []);
    ui.context.points = [uiHistory('a','2026-10-18',2),uiHistory('b','2026-10-19',null,false),uiHistory('c','2026-10-20',3)];
    ui.run('drawTrend({r:{id:"keke",surface:"web",point:"r0c0",keyword:"braised food",from:"2026-10-18",to:"2026-10-20"}}, points)');
    const html = ui.element('trend').innerHTML;
    expect(html.match(/<circle/g)).toHaveLength(2);
    expect(html).toContain('采集失败');
    expect(html).not.toContain('排名 21');
    expect(html.match(/<path class="chart-line"/g)).toHaveLength(2);
    expect(html).not.toMatch(/<path class="chart-line" d="[^"]*L/);
  });
  it('orders the keyword overview by report volume and shows each fixed point with its target', () => {
    const ui = uiContext(async () => []);
    const at = (id: string, keyword: string, iso: string, rank: number | null, extra: Record<string, unknown> = {}) => ({ ...uiHistory(id, iso.slice(0,10), rank), observedAt: iso, keyword, keywordKey: keyword, ...extra });
    ui.context.c = {
      r: { id:'keke', surface:'web', point:'keke-center', keyword:'', from:'2026-10-20', to:'2026-10-21', historical:false, mode:'' },
      store: { storeId:'keke', center:{latitude:40,longitude:-73}, keywords:{core:[],longTail:['daily word']}, fixedPoints:[{id:'keke-center',label:'中心',latitude:40,longitude:-73,distanceKm:0},{id:'keke-3km',label:'3公里',latitude:40.01,longitude:-73,distanceKm:3}],
        monitoringCatalog:{source:{documentDate:'2026-10-16'}},
        keywordTargets:[{keyword:'small',sourceSearchVolumeText:'90 次/月 Mineola · Google Search',pointTargets:[{pointId:'keke-center',targetRank:3}]},{keyword:'big',sourceSearchVolumeText:'1,500,000 次/月 Mineola · Google Search',pointTargets:[{pointId:'keke-center',targetRank:3},{pointId:'keke-3km',targetRank:10}]},{keyword:'odd',sourceSearchVolumeText:'未返回数值 Mineola · Google Search',pointTargets:[]}] },
      cols: [{id:'keke-center',label:'中心',distanceKm:0,latitude:40,longitude:-73},{id:'keke-3km',label:'3公里',distanceKm:3,latitude:40.01,longitude:-73}],
      domains: new Map([['keke-center',[Date.parse('2026-10-20T00:00:00Z'),Date.parse('2026-10-22T00:00:00Z')]],['keke-3km',[Date.parse('2026-10-20T00:00:00Z'),Date.parse('2026-10-22T00:00:00Z')]]]),
    };
    ui.context.byPoint = new Map([['keke-center',[at('b1','big','2026-10-20T10:00:00Z',6),at('b2','big','2026-10-21T10:00:00Z',2)]],['keke-3km',[at('b3','big','2026-10-21T11:00:00Z',null,{eligible:false,rank:{status:'not_found',organicRank:null}})]]]);
    ui.run('c.words=overviewRoster(c.store,byPoint,c.r);');
    const html: string = ui.run('overviewTable(c)');
    const order = [...html.matchAll(/data-keyword="([^"]+)"/g)].map(m => m[1]);
    expect(order).toEqual(['big','small','odd','daily word']);
    expect(html).toContain('1,500,000');
    expect(html).toContain('报告无数值');
    expect(html).toContain('<small class="block">Mineola</small>');
    expect(html).toMatch(/class="ov-cell hit"><div class="ov-top"><a class="ov-rank green"[^>]*>2<\/a><span class="ov-delta up"[^>]*>↑4/);
    expect(html).toContain('>未见*<');
    expect(html).toContain('目标 Top 10 · 1 次');
    expect(html).not.toContain('ov-detail');
    ui.run('c.r.keyword="big";');
    const open: string = ui.run('overviewTable(c)');
    expect(open.match(/class="ov-detail"/g)).toHaveLength(1);
    expect(open).toContain('&quot;compact&quot;:true');
  });
  it('keeps a newer exact evidence selection when an older detail resolves last', async () => {
    let resolveOld!: (value: unknown) => void;
    const oldData = uiHistory('old','2026-10-19',2), newData = { ...uiHistory('new','2026-10-20',3), keyword:'new selected keyword' };
    const ui = uiContext(async url => {
      if(url.includes('/points?')) return {points:[]};
      if(url.includes('/observations/old?')) return new Promise(resolve => { resolveOld = resolve; });
      if(url.includes('/observations/new?')) return newData;
      if(url.includes('/timeline?')) return {items:[newData],complete:true};
      return store;
    });
    const old = ui.run('evidenceView({id:"keke",surface:"web",point:"r0c0",view:"evidence",observation:"old",from:"2026-10-18",to:"2026-10-20"},revision)');
    for(let i=0;i<20&&!resolveOld;i++) await Promise.resolve();
    expect(resolveOld).toBeTypeOf('function');
    ui.run('revision++;');
    await ui.run('evidenceView({id:"keke",surface:"web",point:"r0c0",view:"evidence",observation:"new",from:"2026-10-18",to:"2026-10-20"},revision)');
    resolveOld(oldData); await old;
    expect(ui.element('app').innerHTML).toContain('new selected keyword');
    expect(ui.element('app').innerHTML).not.toContain('2026/10/19');
  });
  it('does not let an old route replace the current page', async () => {
    let resolveOld!: (value: unknown) => void;
    const ui = uiContext(async url => url.startsWith('/api/stores?') ? new Promise(resolve => { resolveOld = resolve; }) : {});
    ui.run('location.hash="#portfolio"'); const old = ui.run('route()');
    ui.run('location.hash="#new"'); await ui.run('route()');
    resolveOld([]); await old;
    expect(ui.element('app').innerHTML).toContain('新增门店');
  });
  it('keeps withdrawn-keyword history enabled through evidence, return, date, point and surface routes', () => {
    const ui=uiContext(async()=>[]);
    ui.context.selected={id:'keke',view:'store',surface:'web',point:'r0c0',keyword:'withdrawn keyword',historical:true,from:'2026-10-01',to:'2026-10-20'};
    const evidence=ui.run('href("evidence",selected.id,params(selected,{observation:"exact-past-id"}))');
    expect(evidence).toContain('historical=1');
    ui.context.evidenceHash=evidence;
    ui.run('location.hash=evidenceHash; evidenceRoute=parseRoute();');
    const back=ui.run('href("store",evidenceRoute.id,params(evidenceRoute))');
    expect(back).toContain('historical=1'); expect(back).toContain('keyword=withdrawn+keyword');
    for(const update of [{from:'2026-09-20'},{point:'r1c1'},{surface:'android',point:''}]) {
      ui.context.update=update;
      expect(ui.run('href(selected.view,selected.id,params(selected,update))')).toContain('historical=1');
    }
    expect(ui.run('href(selected.view,selected.id,params(selected,{historical:""}))')).not.toContain('historical=');
  });
  it('keeps an explicitly selected uncollected point empty instead of substituting another point', async () => {
    const points = [{pointId:'r0c0',point:{latitude:40,longitude:-73},observedTo:'2026-10-20T12:00:00Z'}];
    const ui=uiContext(async url=>url.includes('/points?')?{points}:store);
    ui.context.selected={id:'keke',surface:'web',point:'r2c2',pointExplicit:true,from:'2026-10-18',to:'2026-10-20'};
    await ui.run('loadStore(selected,revision)');
    expect(ui.run('selected.point')).toBe('r2c2');
    ui.context.inventory=points;
    expect(ui.run('pointSelect(inventory,selected.point)')).toContain('r2c2 · 尚无记录');
    ui.context.implicit={id:'keke',surface:'android',point:'r0c0',pointExplicit:false,from:'2026-10-18',to:'2026-10-20'};
    const other=uiContext(async url=>url.includes('/points?')?{points:[{...points[0],pointId:'pilot'}]}:store);
    other.context.selected=ui.context.implicit;
    await other.run('loadStore(selected,revision)');
    expect(other.run('selected.point')).toBe('pilot');
  });
  it('renders missing grid metric denominators as unavailable while retaining run identity', async () => {
    const ui = uiContext(async url => {
      if(url.includes('/points?')) return {points:[]};
      if(url.includes('/grid-runs?')) return {runs:[{gridRunId:'failed-run',observedTo:'2026-10-20T12:00:00Z',attemptedPoints:1}]};
      if(url.includes('/grid?')) return {grid:[],cells:[],gridRunId:'failed-run',qualifiedPoints:0,plannedPoints:9,attemptedPoints:1,metrics:{points:0,found:0,arp:null,atrp:null,solv:null}};
      return store;
    });
    await ui.run('gridView({id:"keke",surface:"web",point:"r0c0",view:"grid",keyword:"food",date:"2026-10-20",from:"2026-10-18",to:"2026-10-20"},revision)');
    const html=ui.element('app').innerHTML;
    expect(html).toContain('failed-run'); expect(html).toContain('暂无合格点');
    expect(html).not.toContain('>null<'); expect(html).not.toContain('>0%<');
  });
});
