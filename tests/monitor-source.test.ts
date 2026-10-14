import { describe, expect, it, vi } from 'vitest';
import { parseMonitorConfig } from '../src/monitor/config.js';
import { KeywordApiSource, parseKeywordResponse, selectKeywords, splitKeywords } from '../src/monitor/source.js';

export const store = { storeId: 'only-bear', merchantId: 'merchant-1', placeId: 'ChIJplace', name: 'Stored name' };
export const configInput = { schemaVersion: '1', sourceBaseUrl: 'http://operation-assistant-api.uat.svc.cluster.local:80', stores: [store], maxKeywordsPerStore: 40, batchSize: 20, sourceTimeoutMs: 15000, outputDirectory: '/tmp/monitor-test', capture: { maxResultsPerKeyword: 15, maxScrollsPerKeyword: 6, maxScreenshotsPerKeyword: 5, keywordTimeoutMs: 90000, locale: 'en-US', browserTimezoneId: 'America/New_York', filenameTimezone: 'Asia/Shanghai', viewport: { width: 1440, height: 1000 } } };
const kw = (keyword: string, priority = 'P1') => ({ keyword, priority, target_surface_types: [] });
const response = (keywords = [kw('chicken')]) => ({ place_id: store.placeId, local_keywords: [{ local_keyword_id: 'record-1', merchant_id: store.merchantId, place_id: store.placeId, keywords }] });

describe('monitor config', () => {
  const cohort = { id: 'cohort-v1', merchantId: store.merchantId, placeId: store.placeId, keywords: [{ keyword: '法拉盛 卤味', group: 'core' }] };
  it('accepts an explicit monitoring-only cohort with independently categorized brand queries', () => {
    expect(parseMonitorConfig({ ...configInput, monitoringKeywordSets: [cohort] }).monitoringKeywordSets).toEqual([cohort]);
  });
  it.each([
    [cohort, cohort],
    [{ ...cohort, keywords: [] }],
    [{ ...cohort, keywords: [{ keyword: ' ', group: 'core' }] }],
    [{ ...cohort, keywords: [{ keyword: 'same', group: 'core' }, { keyword: ' SAME ', group: 'brand' }] }],
    [{ ...cohort, keywords: [{ keyword: 'query', group: 'other' }] }],
    [{ ...cohort, keywords: Array.from({ length: 41 }, (_, i) => ({ keyword: `word ${i}`, group: 'core' })) }],
  ].map(monitoringKeywordSets => ({ monitoringKeywordSets })))('rejects ambiguous or invalid monitoring lists %#', ({ monitoringKeywordSets }) => {
    expect(() => parseMonitorConfig({ ...configInput, monitoringKeywordSets })).toThrow();
  });
  it('rejects a cap that would silently drop the last cohort queries, including brands', () => {
    expect(() => parseMonitorConfig({ ...configInput, maxKeywordsPerStore: 1, monitoringKeywordSets: [{ ...cohort, keywords: [...cohort.keywords, { keyword: 'brand', group: 'brand' }] }] })).toThrow();
  });
  it('accepts the exact registry/profile interface', () => expect(parseMonitorConfig(configInput).stores).toEqual([store]));
  it.each([{ extra: true }, { stores: [{ ...store, storeId: '../escape' }] }, { stores: [store, store] }, { batchSize: 21 }, { maxKeywordsPerStore: 41 }, { capture: { ...configInput.capture, mapView: {} } }, { capture: { ...configInput.capture, filenameTimezone: 'UTC' } }, { sourceBaseUrl: 'https://user:secret@example.com' }])('rejects unsafe or unknown configuration %j', (patch) => expect(() => parseMonitorConfig({ ...configInput, ...patch })).toThrow());
});
describe('keyword source and deterministic selection', () => {
  it('validates exact linkage and records unavailable timestamps without inventing a score', () => {
    const record = parseKeywordResponse(response(), store);
    expect(record.recordId).toBe('record-1');
    expect(record.updatedTime).toBeNull();
    expect(selectKeywords(record.keywords, 40).keywords).toEqual([{ keyword: 'chicken', priority: 'P1', sourceIndex: 0 }]);
  });
  it('uses priority then source order, exact-string deduplication, and keeps empty surface tags', () => {
    const rows = [kw('A', 'P2'), kw(' B ', 'P0'), kw('A', 'P0'), kw('C', 'P0'), kw('D', 'UNKNOWN')];
    const selected = selectKeywords(parseKeywordResponse(response(rows), store).keywords, 40);
    expect(selected.keywords.map(k => k.keyword)).toEqual([' B ', 'A', 'C', 'D']);
    expect(selected.duplicateCount).toBe(1);
    expect(selected.unknownPriorityCount).toBe(1);
  });
  it('caps at 40 and splits into <=20', () => {
    const selected = selectKeywords(parseKeywordResponse(response(Array.from({ length: 50 }, (_, i) => kw(`word ${i}`))), store).keywords, 40);
    expect(splitKeywords(selected.keywords, 20).map(b => b.length)).toEqual([20, 20]);
  });
  it('recognizes a valid empty keyword list', () => expect(parseKeywordResponse(response([]), store).keywords).toEqual([]));
  it.each([
    { ...response(), place_id: 'wrong' },
    { ...response(), local_keywords: [{ ...response().local_keywords[0], merchant_id: 'wrong' }] },
    { ...response(), local_keywords: [{ ...response().local_keywords[0], place_id: 'wrong' }] },
    { ...response(), local_keywords: [] },
    { ...response(), local_keywords: [...response().local_keywords, ...response().local_keywords] },
    response([kw(' ')]),
  ])('rejects missing, invalid, ambiguous or mismatched source records', raw => expect(() => parseKeywordResponse(raw, store)).toThrow());
  it('calls the GET service boundary with abort and never follows credential-bearing redirects', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(response())));
    const source = new KeywordApiSource({ baseUrl: configInput.sourceBaseUrl, timeoutMs: 50, fetch: fetcher as typeof fetch, token: 'secret' });
    await source.read(store);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${configInput.sourceBaseUrl}/seo/keyword/local/${store.placeId}`);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: 'Bearer secret' } });
  });
  it('times out a stalled request explicitly', async () => {
    const source = new KeywordApiSource({ baseUrl: configInput.sourceBaseUrl, timeoutMs: 10, fetch: (() => new Promise(() => {})) as typeof fetch });
    await expect(source.read(store)).rejects.toThrow('source_timeout');
  });
  it('keeps HTTP failure distinct from an empty list', async () => {
    const source = new KeywordApiSource({ baseUrl: configInput.sourceBaseUrl, timeoutMs: 100, fetch: (async () => new Response('secret', { status: 503 })) as typeof fetch });
    await expect(source.read(store)).rejects.toThrow('source_http_503');
  });
});

describe('per-store expected areas', () => {
  const expectedArea = { label: 'Mineola, NY', latitude: 40.75, longitude: -73.64, radiusKm: 10, source: 'Verified store registry' };
  it('retains a verified expected area on the enrolled store only', () => {
    const config = parseMonitorConfig({ ...configInput, stores: [{ ...store, expectedArea }] });
    expect(config.stores[0]?.expectedArea).toEqual(expectedArea);
    expect(config.capture).not.toHaveProperty('expectedArea');
  });
  it('rejects a shared expected area that would silently apply one city to every store', () => {
    expect(() => parseMonitorConfig({ ...configInput, capture: { ...configInput.capture, expectedArea } })).toThrow(/capture.expectedArea/);
  });
  it('rejects invalid per-store provenance or coordinates', () => {
    expect(() => parseMonitorConfig({ ...configInput, stores: [{ ...store, expectedArea: { ...expectedArea, source: ' ' } }] })).toThrow();
    expect(() => parseMonitorConfig({ ...configInput, stores: [{ ...store, expectedArea: { ...expectedArea, latitude: 91 } }] })).toThrow();
  });
});
