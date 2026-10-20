import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ingestAndroidManifest, ingestWebBatch } from '../src/domain/ingest.js';
import { keywordKey, observationId } from '../src/domain/model.js';
import { MemoryObservationStore } from '../src/domain/observation-store.js';
import { parseTrackingConfig, planScan, toAndroidRuns, toWebBatches } from '../src/domain/tracking-config.js';
import { main } from '../src/domain/cli.js';
import { generateGrid } from '../src/grid/grid.js';
import type { BatchManifest, KeywordResult } from '../src/contracts.js';

const examplePath = new URL('../docs/tracking-config.example.json', import.meta.url);
const example = async () => parseTrackingConfig(JSON.parse(await readFile(examplePath, 'utf8')));

describe('tracking config and planner', () => {
  it('parses the example and applies defaults', async () => {
    const config = await example();
    expect(config.timezone).toBe('America/New_York');
    expect(config.defaults).toEqual({ grid: { radiusKm: 5, size: 5 }, zoom: 15 });
    expect(config.stores[0]).toMatchObject({ storeId: 'keke-flushing', active: true, aliases: ['可可小卤', 'KEKE BRAISED DELI'] });
    expect(config.database).toEqual({ provider: 'mongo', database: 'maps-rank-tracking', collection: 'observations' });
  });
  it.each([
    [{ stores: [] }],
    [{ surfaces: { web: { point: { everyHours: 0, keywords: 'all' }, grid: { enabled: false } }, android: { point: { everyHours: 2, keywords: 'core' }, grid: { enabled: false } } } }],
    [{ stores: [{ storeId: 'a', name: 'A', placeId: 'not-a-place', aliases: ['A'], center: { latitude: 0, longitude: 0 }, keywords: { core: ['x'] } }] }],
  ])('rejects invalid configuration %#', async patch => {
    const raw = JSON.parse(await readFile(examplePath, 'utf8'));
    expect(() => parseTrackingConfig({ ...raw, ...patch })).toThrow();
  });
  it('rejects duplicate stores and keywords repeated across tiers', async () => {
    const raw = JSON.parse(await readFile(examplePath, 'utf8'));
    expect(() => parseTrackingConfig({ ...raw, stores: [raw.stores[0], raw.stores[0]] })).toThrow(/duplicate/);
    expect(() => parseTrackingConfig({ ...raw, stores: [{ ...raw.stores[0], keywords: { core: ['braised food'], longTail: ['Braised Food'] } }] })).toThrow(/repeats/);
  });
  it('plans point scans at the store and grid scans over every grid point', async () => {
    const config = await example();
    const webPoint = planScan(config, { surface: 'web', tier: 'point' });
    expect(webPoint.queries).toHaveLength(6);
    expect(webPoint.queries.every(q => q.point.id === 'r0c0')).toBe(true);
    expect(webPoint.queries.map(q => q.keywordTier)).toEqual(['core', 'core', 'core', 'longTail', 'longTail', 'longTail']);
    const androidPoint = planScan(config, { surface: 'android', tier: 'point' });
    expect(androidPoint.queries).toHaveLength(3);
    const grid = planScan(config, { surface: 'web', tier: 'grid' });
    expect(grid.queries).toHaveLength(25 * 3);
    expect(new Set(grid.queries.map(q => q.point.id)).size).toBe(25);
    expect(grid.queries[0]).toMatchObject({ storeId: 'keke-flushing', placeId: 'ChIJRTD3Ws5hwokRES78IFU7zW0', zoom: 15, point: { id: 'r+2c-2', ring: 'outer' } });
    expect(planScan(config, { surface: 'web', tier: 'grid', storeIds: ['nobody'] }).queries).toEqual([]);
  });
  it('skips disabled grids and inactive stores', async () => {
    const raw = JSON.parse(await readFile(examplePath, 'utf8'));
    raw.surfaces.android.grid.enabled = false;
    raw.stores.push({ ...raw.stores[0], storeId: 'closed', placeId: 'ChIJclosed', active: false });
    const config = parseTrackingConfig(raw);
    expect(planScan(config, { surface: 'android', tier: 'grid' }).queries).toEqual([]);
    expect(planScan(config, { surface: 'web', tier: 'point' }).queries.every(q => q.storeId === 'keke-flushing')).toBe(true);
  });
  it('turns a plan into web batches per point and Android runs of at most 20 tasks', async () => {
    const config = await example();
    const batches = toWebBatches(planScan(config, { surface: 'web', tier: 'grid' }));
    expect(batches).toHaveLength(25);
    expect(batches[12]).toMatchObject({ storeId: 'keke-flushing', pointId: 'r0c0', config: { keywords: ['braised food', '卤味', 'chinese food flushing'], mapView: { latitude: 40.7658211, longitude: -73.8315243, zoom: 15 } } });
    expect(toWebBatches(planScan(config, { surface: 'web', tier: 'point' }), 4)).toHaveLength(2);
    const runs = toAndroidRuns(planScan(config, { surface: 'android', tier: 'grid' }), config);
    expect(runs.map(r => r.length)).toEqual([20, 20, 20, 15]);
    expect(runs[0]![0]).toMatchObject({ storeId: 'keke-flushing', storeName: 'Keke Food 可可小卤 — Flushing', aliases: ['可可小卤', 'KEKE BRAISED DELI'], location: { id: 'r+2c-2', accuracyMeters: 20 } });
  });
});

const listing = (displayPosition: number, organicRank: number | null, placeId: string | null, resultType: 'ad' | 'organic' = 'organic') => ({
  displayPosition, organicRank, resultType, adLabel: resultType === 'ad' ? 'Sponsored' : null, name: `Place ${displayPosition}`, mapsUrl: null, placeId, rating: 4.5, reviewCount: 10,
} as unknown as KeywordResult['listings'][number]);
const webResult = (keyword: string, listings: KeywordResult['listings'], mapView: { latitude: number; longitude: number; zoom: number } | null): KeywordResult => ({
  schemaVersion: '1', runId: 'run_1', attemptId: 'att_1', queryId: 'q0001', queryAttemptId: 'qa01', keyword, startedAt: '2026-10-20T16:00:27.898-04:00', finishedAt: '2026-10-20T16:01:00-04:00',
  requestedLimit: 15, observedCount: listings.length, sequenceVerified: true, finalUrl: null, status: 'captured', stopReason: 'end_of_results', error: null,
  metadata: { configHash: 'c', profileHash: 'p', adapterVersion: 'maps-feed-card/v6', sourceCommit: null, browserVersion: null, imageDigest: null, egressProfileId: null } as KeywordResult['metadata'],
  context: { locale: 'en-US', browserTimezoneId: 'America/New_York', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, locationMode: mapView ? 'map_view' : 'query_only', configuredMapView: mapView, observedMapView: null, loggedIn: false, geolocationPermission: 'not_granted', egressRegion: null, egressSource: null, observedLocationText: null, filters: [] },
  quality: {} as KeywordResult['quality'], listings, screenshots: [{ objectKey: '2026-10-20/x/shot1.png' }, { objectKey: null, relativePath: 'local/shot2.png' }] as unknown as KeywordResult['screenshots'], observationArtifactIds: [],
});
const webManifest = (queries: BatchManifest['queries']): BatchManifest => ({ schemaVersion: '1', runId: 'run_1', attemptId: 'att_1', startedAt: '2026-10-20T20:00:00Z', finishedAt: null, status: 'completed', metadata: { configHash: 'c', profileHash: 'p', adapterVersion: 'maps-feed-card/v6' } as BatchManifest['metadata'], persistenceMode: 'local_only', queries, artifacts: [] });

describe('ingestion', () => {
  const grid = generateGrid({ center: { latitude: 40.7658211, longitude: -73.8315243 }, radiusKm: 5, size: 5 });
  const context = { timezone: 'America/New_York', points: new Map(grid.map(p => [p.id, p])), keywordTiers: new Map([[keywordKey('Braised Food'), 'core' as const]]), now: () => new Date('2026-10-21T00:00:00Z') };
  it('derives a ranked web observation by place ID with a map-view point and evidence keys', () => {
    const result = webResult('braised food', [listing(1, null, 'ChIJad', 'ad'), listing(2, 1, 'ChIJother'), listing(3, 2, 'ChIJRTD3Ws5hwokRES78IFU7zW0')], { latitude: 40.7883, longitude: -73.8315, zoom: 15 });
    const manifest = webManifest([{ queryId: 'q0001', inputIndex: 0, keyword: 'braised food', status: 'captured', stopReason: 'end_of_results', error: null, selectedQueryAttemptId: 'qa01', attempts: [{} as never], resultFile: 'q0001.json', artifactIds: [], persistenceStatus: 'verified' }]);
    const [observation] = ingestWebBatch({ manifest, results: new Map([['q0001.json', result]]), store: { storeId: 'keke-flushing', placeId: 'ChIJRTD3Ws5hwokRES78IFU7zW0' }, pointId: 'r+1c0', manifestKey: 'm.json' }, context);
    expect(observation).toMatchObject({ surface: 'web', storeId: 'keke-flushing', keyword: 'braised food', keywordKey: 'braised food', keywordTier: 'core', pointId: 'r+1c0', locationMode: 'map_view',
      point: { latitude: 40.7883, longitude: -73.8315, distanceKm: 2.497, ring: 'middle' }, observedAt: '2026-10-20T20:00:27.898Z', localDate: '2026-10-20', scanId: 'run_1', queryId: 'q0001',
      rank: { status: 'ranked', displayPosition: 3, organicRank: 2, listingsObserved: 3, listingStatus: 'captured', stopReason: 'end_of_results' },
      evidence: { manifestKey: 'm.json', resultKey: 'q0001.json', screenshotKeys: ['2026-10-20/x/shot1.png', 'local/shot2.png'] }, source: { adapterVersion: 'maps-feed-card/v6', profileHash: 'p' }, ingestedAt: '2026-10-21T00:00:00.000Z' });
    expect(observation!.observationId).toBe('web|keke-flushing|braised food|r+1c0|2026-10-20T20:00:27.898Z');
    expect(observation!.topListings.map(l => [l.displayPosition, l.resultType, l.placeId])).toEqual([[1, 'ad', 'ChIJad'], [2, 'organic', 'ChIJother'], [3, 'organic', 'ChIJRTD3Ws5hwokRES78IFU7zW0']]);
  });
  it('classifies not found, partial, blocked and failed web queries and defaults to the store point', () => {
    const results = new Map([['a.json', webResult('卤味', [listing(1, 1, 'ChIJother')], null)], ['b.json', { ...webResult('x', [listing(1, 1, 'ChIJother')], null), status: 'partial' } as KeywordResult]]);
    const manifest = webManifest([
      { queryId: 'q0001', inputIndex: 0, keyword: '卤味', status: 'captured', stopReason: 'end_of_results', error: null, selectedQueryAttemptId: 'qa01', attempts: [{} as never], resultFile: 'a.json', artifactIds: [], persistenceStatus: 'verified' },
      { queryId: 'q0002', inputIndex: 1, keyword: 'x', status: 'partial', stopReason: 'scroll_limit', error: null, selectedQueryAttemptId: 'qa01', attempts: [{} as never], resultFile: 'b.json', artifactIds: [], persistenceStatus: 'verified' },
      { queryId: 'q0003', inputIndex: 2, keyword: 'y', status: 'blocked', stopReason: 'captcha', error: null, selectedQueryAttemptId: 'qa01', attempts: [{} as never], resultFile: 'c.json', artifactIds: [], persistenceStatus: 'verified' },
      { queryId: 'q0004', inputIndex: 3, keyword: 'z', status: 'skipped', stopReason: 'batch_blocked', selectedQueryAttemptId: null, attempts: [], resultFile: null, artifactIds: [], persistenceStatus: 'not_requested' },
    ] as BatchManifest['queries']);
    const observations = ingestWebBatch({ manifest, results, store: { storeId: 'keke-flushing', placeId: 'ChIJRTD3Ws5hwokRES78IFU7zW0' } }, context);
    expect(observations.map(o => [o.pointId, o.rank.status, o.locationMode])).toEqual([['r0c0', 'not_found', 'query_only'], ['r0c0', 'not_found_in_prefix', 'query_only'], ['r0c0', 'blocked', 'query_only'], ['r0c0', 'failed', 'query_only']]);
    expect(observations[0]!.point).toEqual({ latitude: 40.7658211, longitude: -73.8315243, distanceKm: 0, ring: 'inner' });
    expect(observations[3]!.observedAt).toBe('2026-10-20T20:00:00.000Z');
  });
  it('derives Android observations from a v4 manifest and skips stores without a place ID', () => {
    const manifest = { runId: 'run_20261020T074518Z_f92602', startedAt: '2026-10-20T07:45:18.950Z', adapterVersion: 'android-screen-ocr/v4', profileHash: 'ph', queries: [
      { queryId: 'q0001', storeId: 'keke-flushing', keyword: 'braised food', location: { id: 'r0c0', latitude: 40.7658211, longitude: -73.8315243 }, rankingStatus: 'ranked', organicRank: 2, displayPosition: 2, listingStatus: 'partial', evidenceStatus: 'needs_review', stopReason: 'scroll_budget',
        listings: [{ displayPosition: 1, organicRank: 1, resultType: 'organic' as const, name: 'Crown One', rating: 4, reviewCount: 428, distanceText: '0 mi' }, { displayPosition: 2, organicRank: 2, resultType: 'organic' as const, name: 'KEKE BRAISED DELI', rating: 4.6, reviewCount: 9, distanceText: null }],
        screens: [{ capturedAt: '2026-10-20T07:45:52.392Z', png: { objectKey: null, relativePath: 'android-maps/2026-10-20/run/q0001/01.png' } }], locationScreen: { capturedAt: '2026-10-20T07:45:41.389Z' } },
      { queryId: 'q0002', storeId: 'unknown-store', keyword: 'braised food', location: { id: 'r0c0', latitude: 0, longitude: 0 }, rankingStatus: 'not_found', organicRank: null, displayPosition: null, listingStatus: 'complete', evidenceStatus: 'captured', stopReason: 'list_end', listings: [], screens: [], locationScreen: null },
      { queryId: 'q0003', storeId: 'keke-flushing', keyword: '卤味', location: { id: 'r-1c0', latitude: 40.7433, longitude: -73.8315 }, rankingStatus: 'not_evaluated', organicRank: null, displayPosition: null, listingStatus: 'not_evaluated', evidenceStatus: 'failed', stopReason: 'query_timeout', listings: [], screens: [], locationScreen: { capturedAt: '2026-10-20T07:52:38.343Z' } },
    ] };
    const observations = ingestAndroidManifest({ manifest, placeIds: new Map([['keke-flushing', 'ChIJRTD3Ws5hwokRES78IFU7zW0']]), manifestKey: 'android/m.json' }, context);
    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({ surface: 'android', locationMode: 'device_gps', pointId: 'r0c0', point: { distanceKm: 0, ring: 'inner' }, observedAt: '2026-10-20T07:45:52.392Z', localDate: '2026-10-20', keywordTier: 'core',
      rank: { status: 'ranked', displayPosition: 2, organicRank: 2, listingsObserved: 2, listingStatus: 'partial', stopReason: 'scroll_budget' }, evidence: { manifestKey: 'android/m.json', resultKey: null, screenshotKeys: ['android-maps/2026-10-20/run/q0001/01.png'] }, source: { adapterVersion: 'android-screen-ocr/v4', profileHash: 'ph' } });
    expect(observations[0]!.topListings[1]).toEqual({ displayPosition: 2, organicRank: 2, resultType: 'organic', name: 'KEKE BRAISED DELI', placeId: null, rating: 4.6, reviewCount: 9, distanceText: null });
    expect(observations[1]).toMatchObject({ pointId: 'r-1c0', rank: { status: 'failed' }, point: { distanceKm: 2.497, ring: 'middle' }, observedAt: '2026-10-20T07:52:38.343Z', keywordTier: null });
  });
  it('upserts idempotently in the memory store', async () => {
    const store = new MemoryObservationStore();
    const manifest = { runId: 'r', startedAt: '2026-10-20T07:45:18.950Z', queries: [{ queryId: 'q0001', storeId: 's', keyword: 'k', location: { id: 'r0c0', latitude: 1, longitude: 2 }, rankingStatus: 'ranked', organicRank: 1, displayPosition: 1, listingStatus: 'complete', evidenceStatus: 'captured', stopReason: 'list_end', listings: [], screens: [], locationScreen: null }] };
    const observations = ingestAndroidManifest({ manifest, placeIds: new Map([['s', 'ChIJs']]) }, { timezone: 'UTC' });
    expect(await store.upsert(observations)).toEqual({ inserted: 1, updated: 0 });
    expect(await store.upsert(observations)).toEqual({ inserted: 0, updated: 1 });
    expect(store.documents.size).toBe(1);
    expect(observationId(observations[0]!)).toBe('android|s|k|r0c0|2026-10-20T07:45:18.950Z');
  });
});

describe('tracking cli', () => {
  it('prints plans in the requested format and fails cleanly on bad input', async () => {
    const logs: string[] = [];
    const original = console.log; console.log = (line: string) => { logs.push(line); };
    try {
      expect(await main(['plan', '--config', new URL(examplePath).pathname, '--surface', 'web', '--tier', 'grid', '--format', 'web-batches'])).toBe(0);
      const output = JSON.parse(logs[0]!);
      expect(output.count).toBe(75);
      expect(output['web-batches']).toHaveLength(25);
      expect(await main(['plan', '--config', new URL(examplePath).pathname, '--surface', 'ios', '--tier', 'grid'])).toBe(64);
      expect(await main(['ingest', '--config', new URL(examplePath).pathname, '--surface', 'android', '--manifest', '/nonexistent.json'])).toBe(64);
    } finally { console.log = original; }
  });
});
