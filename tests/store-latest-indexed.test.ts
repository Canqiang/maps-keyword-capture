import { describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import { MemoryTrackingRepository, MongoTrackingRepository, type StoredStore } from '../src/domain/repository.js';
import type { RankObservation } from '../src/domain/model.js';

const center = { latitude: 40.75, longitude: -73.83 };
const store = {
  storeId: 'keke', placeId: 'keke-place', name: 'KEKE', active: true, center,
  keywords: { core: ['word', 'only missing'], longTail: [] },
  fixedPoints: [{ ...center, id: 'center', distanceKm: 0 }],
  keywordTargets: [{ keyword: 'word' }, { keyword: 'only missing' }],
  createdAt: '', updatedAt: '',
} as StoredStore;
const day = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString();
function observed(id: string, rank: number, date: number, overrides: Partial<RankObservation> = {}): RankObservation {
  return {
    observationId: id, observedAt: day(date), storeId: store.storeId, placeId: store.placeId,
    surface: 'web', pointId: 'center', point: { ...center, distanceKm: 0, ring: null, zoom: 15 },
    keyword: 'word', keywordKey: 'word', keywordTier: 'core', locationMode: 'map_view',
    rank: { status: 'ranked', displayPosition: rank, organicRank: rank, listingsObserved: 15,
      listingStatus: 'captured', stopReason: 'limit_reached' },
    quality: { rankingReliable: true, sequenceVerified: true, classificationComplete: true,
      screenshotCoverageComplete: true, identityResolved: true, organicCoverage: 15, endOfResults: false,
      resultSurface: 'list', geographicRelevance: null, warnings: [] },
    topListings: [], evidence: { resultKey: 'json', manifestKey: 'manifest', screenshotKeys: [id + '.png'] },
    source: { adapterVersion: 'v6', profileHash: 'profile' }, localDate: day(date).slice(0, 10),
    queryId: 'q', scanId: 'scan', ingestedAt: day(date), ...overrides,
  };
}

type Filter = Record<string, string | { $gte: number; $lte: number }>;
type FindOptions = { sort: Record<string, number>; projection: Record<string, number>; limit: number };
function repositories(s: StoredStore, rows: RankObservation[]) {
  const finds: { filter: Filter; options: FindOptions }[] = [];
  const discoveries: Filter[] = [];
  const matches = (row: RankObservation, filter: Filter) => Object.entries(filter).every(([path, wanted]) => {
    const val = path.split('.').reduce((obj, part) => obj?.[part], row as any);
    return typeof wanted === 'object'
      ? typeof val === 'number' && val >= wanted.$gte && val <= wanted.$lte
      : val === wanted;
  });
  const observations = {
    createIndexes: async () => {},
    distinct: async (key: 'keywordKey', filter: Filter) => {
      discoveries.push(filter);
      return [...new Set(rows.filter(row => matches(row, filter)).map(row => row[key]))];
    },
    find: (filter: Filter, options: FindOptions) => {
      finds.push({ filter, options });
      const key = Object.keys(options.sort)[0] as 'observedAt' | 'observationId';
      const docs = rows.filter(row => matches(row, filter))
        .sort((a, b) => a[key] === b[key] ? 0 : a[key] > b[key] ? -1 : 1).slice(0, options.limit);
      const included = Object.keys(options.projection).filter(k => options.projection[k] === 1);
      return { toArray: async () => included.length
        ? docs.map(row => Object.fromEntries(included.map(k => [k, row[k as keyof RankObservation]])))
        : docs };
    },
  };
  const stores = { createIndexes: async () => {}, findOne: async () => ({ ...s, _id: s.storeId }),
    find: () => ({ toArray: async () => [{ ...s, _id: s.storeId }] }) };
  const client = { connect: async () => {}, db: () => ({ collection: (name: string) =>
    name === 'observations' ? observations : stores }) } as unknown as MongoClient;
  const mongo = new MongoTrackingRepository({ uri: 'mongodb://unused', database: 'test', createClient: () => client });
  const memory = new MemoryTrackingRepository(rows);
  memory.stores.set(s.storeId, s);
  return { mongo, memory, finds, discoveries };
}

describe('index-bounded latest observation lookups', () => {
  it('matches historical and current rankings, including timestamp tie at the second rank boundary', async () => {
    const rows = [observed('top', 3, 15), observed('a', 9, 14), observed('b', 5, 14), observed('z', 1, 14),
      observed('old-key', 2, 2, { keyword: 'removed', keywordKey: 'removed' }),
      observed('other-store', 12, 20, { storeId: 'other' }), observed('other-place', 12, 20, { placeId: 'other' }),
      observed('other-point', 12, 20, { pointId: 'east' }), observed('other-coordinate', 12, 20, {
        point: { ...center, latitude: 41, distanceKm: 0, ring: null } }), observed('android', 8, 21, { surface: 'android' })];
    const { mongo, memory, finds, discoveries } = repositories(store, rows);
    expect(await mongo.latest(store.storeId)).toEqual(await memory.latest(store.storeId));
    expect(await mongo.latest(store.storeId, { surface: 'web' })).toContainEqual(expect.objectContaining({
      keyword: 'word', organicRank: 3, previousOrganicRank: 1, screenshotKeys: ['top.png'],
    }));
    expect(discoveries).toContainEqual({ storeId: 'keke', pointId: 'center', surface: 'web' });
    expect(finds.every(read => read.options.limit <= 3)).toBe(true);
    expect(finds.some(read => read.filter.observedAt === day(14) && read.options.sort.observationId === -1)).toBe(true);
  });

  it('computes fixed-point roster and summary from one read of each observed keyword, preserving unavailable and historical counts', async () => {
    const rows = [observed('a', 7, 10), observed('z', 2, 10), observed('y', 5, 10),
      observed('unqualified', 1, 12, { keyword: 'only missing', keywordKey: 'only missing', quality: undefined }),
      observed('retired', 3, 20, { keywordKey: 'retired', keyword: 'retired' })];
    const { mongo, memory, discoveries, finds } = repositories(store, rows);
    const [row] = await mongo.portfolio('web');
    expect(row?.summary).toEqual((await memory.summaries({ surface: 'web' }))[0]);
    expect(row?.rosterLatest).toEqual(await memory.rosterLatest(store.storeId, 'web'));
    expect(row?.summary).toMatchObject({ ranked: 1, unavailable: 1, averageOrganicRank: 2 });
    expect(row?.rosterLatest).toMatchObject({ historicalOnly: 1, withRecord: 2, qualifiedRanked: 1, unavailable: 1 });
    expect(discoveries).toHaveLength(1);
    expect(finds.every(call => call.options.limit <= 2 && !call.options.projection.topListings && !call.options.projection.evidence)).toBe(true);
  });

  it.each([center, null])('preserves the broader historical unlocated roster for a legacy store with center %j', async legacyCenter => {
    const { fixedPoints: _points, ...legacy } = store;
    legacy.center = legacyCenter;
    const rows = [observed('matching', 2, 5, { pointId: 'r0c0' }), observed('unknown-location', 6, 12, {
      pointId: 'r0c0', locationMode: 'query_only', point: { latitude: null, longitude: null, distanceKm: null, ring: null } })];
    const { mongo, memory } = repositories(legacy, rows);
    const [row] = await mongo.portfolio('web');
    expect(row?.summary).toEqual((await memory.summaries({ surface: 'web' }))[0]);
    expect(row?.rosterLatest).toEqual(await memory.rosterLatest(legacy.storeId, 'web'));
    expect(row?.summary?.averageOrganicRank).toBe(legacyCenter ? 2 : null);
    expect(row?.rosterLatest?.newestObservedAt).toBe(day(12));
  });
});
