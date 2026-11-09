import { MongoClient, type MongoClientOptions } from 'mongodb';
import { keywordKey, observationCohortKey, organicRankForMetrics, type RankObservation, type Surface } from './model.js';
import { parseStore, type TrackingStore } from './tracking-config.js';
import { compareObservations, decodeHistoryCursor, historyPage, observedPoints, summarizeRoster, validCoordinates, type TimelineOptions, type TimelinePage, type PointInventory, type ObservedPoint, type RosterLatest } from './history.js';

/**
 * Read and manage tracking data: the stores collection (managed through the UI) and the
 * observations collection (written by scans). One interface, a MongoDB and an in-memory version.
 */
export interface StoredStore extends Omit<TrackingStore, 'center'> { center: TrackingStore['center'] | null; createdAt: string; updatedAt: string }
export interface LatestRank {
  keyword: string; keywordKey: string; keywordTier: RankObservation['keywordTier']; surface: Surface; pointId: string;
  observedAt: string; status: RankObservation['rank']['status']; displayPosition: number | null; organicRank: number | null;
  listingsObserved: number; previousOrganicRank: number | null; previousObservedAt: string | null;
  screenshotKeys: string[]; topListings: RankObservation['topListings'];
  eligible: boolean;
}
export interface TrendPoint { observedAt: string; status: RankObservation['rank']['status']; displayPosition: number | null; organicRank: number | null; scanId: string; eligible: boolean }
export interface StoreSummary { storeId: string; surface: Surface; lastObservedAt: string | null; keywords: number; ranked: number; top3: number; averageOrganicRank: number | null; unavailable: number }

/** One saved change to a store's configuration: who, when, and which top-level fields differ. */
export interface StoreChange { storeId: string; at: string; by: string | null; action: 'create' | 'update' | 'activate' | 'pause'; fields: string[]; keywordsAdded: string[]; keywordsRemoved: string[] }
export interface SaveStoreOptions { fillMissingCenter?: boolean; by?: string | null }

/** Field-level difference between two configurations, for the change log. */
export function describeStoreChange(previous: StoredStore | null, next: TrackingStore, at: string, by: string | null): StoreChange {
  const fields = (Object.keys({ ...(previous ?? {}), ...next }) as Array<keyof TrackingStore>)
    .filter(key => !['createdAt', 'updatedAt'].includes(key as string) && JSON.stringify(previous?.[key as keyof StoredStore] ?? null) !== JSON.stringify(next[key] ?? null)).sort();
  const words = (store: Pick<TrackingStore, 'keywordTargets'> | null) => new Map((store?.keywordTargets ?? []).map(t => [keywordKey(t.keyword), t.keyword]));
  const before = words(previous), after = words(next);
  return { storeId: next.storeId, at, by, action: previous ? 'update' : 'create', fields,
    keywordsAdded: [...after].filter(([k]) => !before.has(k)).map(([, v]) => v), keywordsRemoved: [...before].filter(([k]) => !after.has(k)).map(([, v]) => v) };
}

export interface TrackingRepository {
  listStores(options?: { includeInactive?: boolean }): Promise<StoredStore[]>;
  getStore(storeId: string): Promise<StoredStore | null>;
  /** Create or replace; validation happens here so every writer gets the same rules. Every save is appended to the change log. */
  saveStore(raw: unknown, now?: Date, options?: SaveStoreOptions): Promise<StoredStore>;
  /** Newest first. */
  storeChanges(storeId: string, limit?: number): Promise<StoreChange[]>;
  setActive(storeId: string, active: boolean, now?: Date, by?: string | null): Promise<StoredStore | null>;
  /** Most recent observation per keyword, surface and point, with the one before it for change. */
  latest(storeId: string, options?: { surface?: Surface; pointId?: string }): Promise<LatestRank[]>;
  trend(storeId: string, keywordKey: string, options: { surface: Surface; pointId?: string; since: string }): Promise<TrendPoint[]>;
  /** Observations of one store, keyword and surface on one local date (grid heat maps). */
  day(storeId: string, keywordKey: string, options: { surface: Surface; localDate: string }): Promise<RankObservation[]>;
  summaries(options?: { surface?: Surface }): Promise<StoreSummary[]>;
  /** Raw historical identity records; unlike latest(), no current-coordinate/cohort filtering. */
  timeline(storeId: string, options: TimelineOptions): Promise<TimelinePage>;
  observation(storeId: string, observationId: string, surface: Surface): Promise<RankObservation | null>;
  points(storeId: string, surface: Surface): Promise<PointInventory>;
  rosterLatest(storeId: string, surface: Surface): Promise<RosterLatest | null>;
  close(): Promise<void>;
}

function toLatest(rows: RankObservation[]): LatestRank[] {
  const groups = new Map<string, RankObservation[]>();
  for (const row of rows) {
    const key = `${row.surface}|${row.keywordKey}|${row.pointId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const out: LatestRank[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => compareObservations(b, a));
    const [current, previous] = group as [RankObservation, RankObservation | undefined];
    const rank = organicRankForMetrics(current);
    const cohort = observationCohortKey(current);
    const previousRank = previous && cohort !== null && cohort === observationCohortKey(previous) ? organicRankForMetrics(previous) : undefined;
    out.push({ keyword: current.keyword, keywordKey: current.keywordKey, keywordTier: current.keywordTier, surface: current.surface, pointId: current.pointId,
      observedAt: current.observedAt, status: current.rank.status, eligible: rank !== undefined, displayPosition: rank === undefined ? null : current.rank.displayPosition, organicRank: rank ?? null,
      listingsObserved: current.rank.listingsObserved, previousOrganicRank: previousRank ?? null, previousObservedAt: previousRank === undefined ? null : previous!.observedAt,
      screenshotKeys: current.evidence.screenshotKeys, topListings: current.topListings });
  }
  const tierOrder = (tier: LatestRank['keywordTier']): number => (tier === 'core' ? 0 : tier === 'longTail' ? 1 : 2);
  return out.sort((a, b) => tierOrder(a.keywordTier) - tierOrder(b.keywordTier) || (a.organicRank ?? 99) - (b.organicRank ?? 99) || a.keyword.localeCompare(b.keyword));
}
function summarize(storeId: string, surface: Surface, latest: LatestRank[]): StoreSummary {
  const usable = latest.filter(l => l.eligible);
  const ranks = usable.map(l => l.organicRank).filter((r): r is number => r !== null);
  return { storeId, surface, lastObservedAt: latest.reduce<string | null>((max, l) => (max === null || l.observedAt > max ? l.observedAt : max), null), keywords: usable.length, ranked: ranks.length, unavailable: latest.length - usable.length,
    top3: ranks.filter(r => r <= 3).length, averageOrganicRank: ranks.length ? Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 10) / 10 : null };
}

function ensureSameIdentity(existing: StoredStore | null | undefined, next: TrackingStore, fillMissingCenter = false): void {
  if (existing && (existing.placeId !== next.placeId || (!existing.center ? !(fillMissingCenter && next.monitoringCatalog) : existing.center.latitude !== next.center.latitude || existing.center.longitude !== next.center.longitude))) {
    throw new Error('store identity cannot change in the UI; use a new storeId for a different place, or a reviewed migration to move the same place');
  }
}
function defaultPointId(store: StoredStore | null): string { return store?.fixedPoints?.find(p => p.distanceKm === 0)?.id ?? 'r0c0'; }
function pointDefinition(store: StoredStore, pointId: string) { return store.fixedPoints?.find(p => p.id === pointId) ?? (pointId === 'r0c0' ? store.center : null); }
function pointCoordinatesFilter(store: StoredStore, pointId: string) {
  const point = pointDefinition(store, pointId);
  return point ? { 'point.latitude': { $gte: point.latitude - 0.000001, $lte: point.latitude + 0.000001 }, 'point.longitude': { $gte: point.longitude - 0.000001, $lte: point.longitude + 0.000001 } } : {};
}
function activeLatest(store: StoredStore, rows: LatestRank[]): LatestRank[] {
  if (!store.keywordTargets) return rows;
  const active = new Set(store.keywordTargets.map(t => keywordKey(t.keyword)));
  return rows.filter(row => active.has(row.keywordKey));
}
function belongsToStore(row: RankObservation, store: StoredStore | null): boolean {
  if (!store || row.placeId !== store.placeId) return false;
  const point = pointDefinition(store, row.pointId);
  if (!point) return row.pointId !== 'r0c0';
  return typeof row.point.latitude === 'number' && typeof row.point.longitude === 'number'
    && Math.abs(row.point.latitude - point.latitude) <= 0.000001
    && Math.abs(row.point.longitude - point.longitude) <= 0.000001;
}
function trendRows(rows: RankObservation[]): TrendPoint[] {
  const sorted = rows.slice().sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const anchor = sorted.find(row => observationCohortKey(row) !== null);
  const cohort = anchor ? observationCohortKey(anchor) : null;
  const compatible: RankObservation[] = [];
  for (const row of sorted) {
    const key = observationCohortKey(row);
    if (key !== null && key !== cohort) break;
    if (key === null && anchor) {
      // Missing results have no map mode/zoom, but remain explicit gaps at this identity/point.
      // Any known conflicting profile/location ends the comparable time segment.
      const conflicts = (a: unknown, b: unknown) => a != null && b != null && a !== b;
      if (conflicts(row.source.profileHash, anchor.source.profileHash) || conflicts(row.source.adapterVersion, anchor.source.adapterVersion)
        || conflicts(row.point.latitude, anchor.point.latitude) || conflicts(row.point.longitude, anchor.point.longitude)
        || conflicts(row.point.zoom, anchor.point.zoom) || (row.locationMode !== 'query_only' && row.locationMode !== anchor.locationMode)) {
        if (!compatible.length) compatible.push(row);
        break;
      }
    }
    compatible.push(row);
  }
  return compatible.slice(0, 2000).reverse().map(row => {
    const rank = observationCohortKey(row) === null ? undefined : organicRankForMetrics(row);
    return { observedAt: row.observedAt, status: row.rank.status, displayPosition: rank === undefined ? null : row.rank.displayPosition, organicRank: rank ?? null, scanId: row.scanId, eligible: rank !== undefined };
  });
}

export class MemoryTrackingRepository implements TrackingRepository {
  readonly stores = new Map<string, StoredStore>();
  constructor(readonly observations: RankObservation[] = []) {}
  async listStores(options: { includeInactive?: boolean } = {}) { return [...this.stores.values()].filter(s => options.includeInactive || s.active).sort((a, b) => a.name.localeCompare(b.name)); }
  async getStore(storeId: string) { return this.stores.get(storeId) ?? null; }
  readonly changes: StoreChange[] = [];
  async saveStore(raw: unknown, now = new Date(), options: SaveStoreOptions = {}) {
    const store = parseStore(raw);
    const existing = this.stores.get(store.storeId) ?? null;
    ensureSameIdentity(existing, store, options.fillMissingCenter);
    const clash = [...this.stores.values()].find(s => s.placeId === store.placeId && s.storeId !== store.storeId);
    if (clash) throw new Error(`placeId already tracked by ${clash.storeId}`);
    const saved: StoredStore = { ...store, createdAt: existing?.createdAt ?? now.toISOString(), updatedAt: now.toISOString() };
    this.stores.set(store.storeId, saved);
    this.changes.push(describeStoreChange(existing, store, now.toISOString(), options.by ?? null));
    return saved;
  }
  async storeChanges(storeId: string, limit = 20) { return this.changes.filter(c => c.storeId === storeId).reverse().slice(0, limit); }
  async setActive(storeId: string, active: boolean, now = new Date(), by: string | null = null) {
    const store = this.stores.get(storeId);
    if (!store) return null;
    if (store.active !== active) this.changes.push({ storeId, at: now.toISOString(), by, action: active ? 'activate' : 'pause', fields: ['active'], keywordsAdded: [], keywordsRemoved: [] });
    const saved = { ...store, active, updatedAt: now.toISOString() };
    this.stores.set(storeId, saved);
    return saved;
  }
  async latest(storeId: string, options: { surface?: Surface; pointId?: string } = {}) {
    const store = await this.getStore(storeId);
    return toLatest(this.observations.filter(o => o.storeId === storeId && belongsToStore(o, store) && (!options.surface || o.surface === options.surface) && o.pointId === (options.pointId ?? defaultPointId(store))));
  }
  async trend(storeId: string, keywordKey: string, options: { surface: Surface; pointId?: string; since: string }) {
    const store = await this.getStore(storeId);
    return trendRows(this.observations.filter(o => o.storeId === storeId && belongsToStore(o, store) && o.keywordKey === keywordKey && o.surface === options.surface && o.pointId === (options.pointId ?? defaultPointId(store)) && o.observedAt >= options.since));
  }
  async day(storeId: string, keywordKey: string, options: { surface: Surface; localDate: string }) {
    const store = await this.getStore(storeId);
    return this.observations.filter(o => o.storeId === storeId && o.placeId === store?.placeId && o.keywordKey === keywordKey && o.surface === options.surface && o.localDate === options.localDate);
  }
  async summaries(options: { surface?: Surface } = {}) {
    const surface = options.surface ?? 'web';
    const stores = await this.listStores({ includeInactive: true });
    return Promise.all(stores.map(async s => summarize(s.storeId, surface, activeLatest(s, await this.latest(s.storeId, { surface })))));
  }
  async timeline(storeId: string, options: TimelineOptions): Promise<TimelinePage> {
    const cursor = decodeHistoryCursor(storeId, options), store = await this.getStore(storeId);
    const rows = this.observations.filter(row => row.storeId === storeId && row.placeId === store?.placeId && row.surface === options.surface && row.pointId === options.pointId
      && row.localDate >= options.from && row.localDate <= options.to && (!options.keywordKey || row.keywordKey === options.keywordKey)
      && (!cursor || row.observedAt > cursor.observedAt || (row.observedAt === cursor.observedAt && row.observationId > cursor.observationId))).sort(compareObservations);
    return historyPage(storeId, rows, options);
  }
  async observation(storeId: string, observationId: string, surface: Surface) {
    const store = await this.getStore(storeId);
    return this.observations.find(row => row.storeId === storeId && row.placeId === store?.placeId && row.surface === surface && row.observationId === observationId) ?? null;
  }
  async points(storeId: string, surface: Surface) {
    const store = await this.getStore(storeId);
    return observedPoints(this.observations.filter(row => row.storeId === storeId && row.placeId === store?.placeId && row.surface === surface));
  }
  async rosterLatest(storeId: string, surface: Surface) {
    const store = await this.getStore(storeId);
    return store ? summarizeRoster(store, surface, this.observations.filter(row => row.storeId === storeId && row.placeId === store.placeId && row.surface === surface && row.pointId === defaultPointId(store) && (!store.fixedPoints || belongsToStore(row, store)))) : null;
  }
  async close() { /* nothing to release */ }
}

export interface MongoTrackingRepositoryOptions {
  uri: string; database: string; storesCollection?: string; observationsCollection?: string; timeoutMs?: number;
  createClient?: (uri: string, options: MongoClientOptions) => MongoClient;
}
export class MongoTrackingRepository implements TrackingRepository {
  private readonly client: MongoClient;
  private connected: Promise<void> | null = null;
  constructor(private readonly options: MongoTrackingRepositoryOptions) {
    if (!options.uri?.trim()) throw new Error('tracking repository uri is required');
    const t = options.timeoutMs ?? 15_000;
    const clientOptions: MongoClientOptions = { appName: 'maps-keyword-capture-tracking-ui', serverSelectionTimeoutMS: t, connectTimeoutMS: t, socketTimeoutMS: t };
    this.client = options.createClient ? options.createClient(options.uri, clientOptions) : new MongoClient(options.uri, clientOptions);
  }
  private async db() {
    // The driver reconnects across replica-set restarts by itself once connected.
    this.connected ??= this.client.connect().then(async () => {
      const stores = this.client.db(this.options.database).collection(this.options.storesCollection ?? 'stores');
      await stores.createIndexes([{ key: { placeId: 1 }, name: 'placeId', unique: true }, { key: { active: 1, name: 1 }, name: 'active' }]);
      // The UAT server rejects unindexed queries; the change log is read newest first per store.
      await this.client.db(this.options.database).collection((this.options.storesCollection ?? 'stores') + '-changes').createIndexes([{ key: { storeId: 1, at: -1 }, name: 'storeId_at' }]);
      // Same index the writer creates; ensure the read path gets it without waiting for the next scan.
      await this.client.db(this.options.database).collection(this.options.observationsCollection ?? 'observations')
        .createIndexes([{ key: { storeId: 1, placeId: 1, surface: 1, pointId: 1, observedAt: 1, observationId: 1 }, name: 'timeline' }]);
    }).catch(error => { this.connected = null; throw error; });
    await this.connected;
    return this.client.db(this.options.database);
  }
  private async storesCol() { return (await this.db()).collection<StoredStore & { _id: string }>(this.options.storesCollection ?? 'stores'); }
  private async changesCol() { return (await this.db()).collection<StoreChange>((this.options.storesCollection ?? 'stores') + '-changes'); }
  async storeChanges(storeId: string, limit = 20) {
    const docs = await (await this.changesCol()).find({ storeId }, { sort: { at: -1 }, limit: Math.min(Math.max(1, limit), 200), projection: { _id: 0 } }).toArray();
    return docs as StoreChange[];
  }
  private async obsCol() { return (await this.db()).collection<RankObservation & { _id: string }>(this.options.observationsCollection ?? 'observations'); }
  private strip(doc: (StoredStore & { _id?: string }) | null): StoredStore | null {
    if (!doc) return null;
    const { _id: _ignored, ...store } = doc;
    return store;
  }
  async listStores(options: { includeInactive?: boolean } = {}) {
    const docs = await (await this.storesCol()).find(options.includeInactive ? {} : { active: true }, { sort: { name: 1 } }).toArray();
    return docs.map(d => this.strip(d)!);
  }
  async getStore(storeId: string) { return this.strip(await (await this.storesCol()).findOne({ _id: storeId })); }
  async saveStore(raw: unknown, now = new Date(), options: SaveStoreOptions = {}) {
    const store = parseStore(raw);
    const col = await this.storesCol();
    const clash = await col.findOne({ placeId: store.placeId, _id: { $ne: store.storeId } });
    if (clash) throw new Error(`placeId already tracked by ${clash.storeId}`);
    const existing = this.strip(await col.findOne({ _id: store.storeId }));
    ensureSameIdentity(existing, store, options.fillMissingCenter);
    const saved: StoredStore = { ...store, createdAt: existing?.createdAt ?? now.toISOString(), updatedAt: now.toISOString() };
    await col.replaceOne({ _id: store.storeId }, saved, { upsert: true });
    await (await this.changesCol()).insertOne(describeStoreChange(existing, store, now.toISOString(), options.by ?? null));
    return saved;
  }
  async setActive(storeId: string, active: boolean, now = new Date(), by: string | null = null) {
    const col = await this.storesCol();
    const result = await col.updateOne({ _id: storeId, active: { $ne: active } }, { $set: { active, updatedAt: now.toISOString() } });
    if (result.modifiedCount) await (await this.changesCol()).insertOne({ storeId, at: now.toISOString(), by, action: active ? 'activate' : 'pause', fields: ['active'], keywordsAdded: [], keywordsRemoved: [] });
    return this.getStore(storeId);
  }
  async latest(storeId: string, options: { surface?: Surface; pointId?: string } = {}) {
    const store = await this.getStore(storeId);
    if (!store || ((options.pointId ?? defaultPointId(store)) === 'r0c0' && !store.center)) return [];
    const col = await this.obsCol();
    const pointId = options.pointId ?? defaultPointId(store);
    const match: Record<string, unknown> = { storeId, placeId: store.placeId, pointId, ...(options.surface ? { surface: options.surface } : {}),
      ...pointCoordinatesFilter(store, pointId) };
    // Two newest per keyword, surface and point.
    const rows = await col.aggregate<RankObservation>([
      { $match: match }, { $sort: { observedAt: -1, observationId: -1 } },
      { $group: { _id: { s: '$surface', k: '$keywordKey', p: '$pointId' }, docs: { $push: '$$ROOT' } } },
      { $project: { docs: { $slice: ['$docs', 2] } } }, { $unwind: '$docs' }, { $replaceRoot: { newRoot: '$docs' } }, { $project: { _id: 0 } },
    ], { allowDiskUse: true }).toArray();
    return toLatest(rows);
  }
  async trend(storeId: string, keywordKey: string, options: { surface: Surface; pointId?: string; since: string }) {
    const store = await this.getStore(storeId);
    if (!store || ((options.pointId ?? defaultPointId(store)) === 'r0c0' && !store.center)) return [];
    const pointId = options.pointId ?? defaultPointId(store);
    const col = await this.obsCol();
    const match = { storeId, placeId: store.placeId, keywordKey, surface: options.surface, pointId, observedAt: { $gte: options.since },
      ...pointCoordinatesFilter(store, pointId) };
    // Fetch a bounded timeline, including missing-result gaps and profile transitions. Filtering
    // metadata in Mongo would remove the very records that must break the rendered curve.
    const docs = await col.find(match, { sort: { observedAt: -1 }, limit: 2000, projection: { _id: 0 } }).toArray();
    return trendRows(docs);
  }
  async day(storeId: string, keywordKey: string, options: { surface: Surface; localDate: string }) {
    const store = await this.getStore(storeId);
    if (!store) return [];
    const docs = await (await this.obsCol()).find({ storeId, placeId: store.placeId, keywordKey, surface: options.surface, localDate: options.localDate }, { sort: { observedAt: -1, observationId: -1 }, projection: { _id: 0 }, limit: 5001 }).toArray();
    return docs as unknown as RankObservation[];
  }
  async summaries(options: { surface?: Surface } = {}) {
    const surface = options.surface ?? 'web';
    const stores = await this.listStores({ includeInactive: true });
    return Promise.all(stores.map(async s => summarize(s.storeId, surface, activeLatest(s, await this.latest(s.storeId, { surface })))));
  }
  async timeline(storeId: string, options: TimelineOptions): Promise<TimelinePage> {
    const cursor = decodeHistoryCursor(storeId, options), store = await this.getStore(storeId);
    if (!store) return { items: [], nextCursor: null, complete: true };
    const match = { storeId, placeId: store.placeId, surface: options.surface, pointId: options.pointId, localDate: { $gte: options.from, $lte: options.to },
      ...(options.keywordKey ? { keywordKey: options.keywordKey } : {}),
      ...(cursor ? { $or: [{ observedAt: { $gt: cursor.observedAt } }, { observedAt: cursor.observedAt, observationId: { $gt: cursor.observationId } }] } : {}) };
    const rows = await (await this.obsCol()).find(match, { sort: { observedAt: 1, observationId: 1 }, limit: options.limit + 1, projection: { _id: 0 } }).toArray();
    return historyPage(storeId, rows, options);
  }
  async observation(storeId: string, observationId: string, surface: Surface) {
    const store = await this.getStore(storeId);
    if (!store) return null;
    return (await this.obsCol()).findOne({ storeId, placeId: store.placeId, surface, observationId }, { projection: { _id: 0 } });
  }
  async points(storeId: string, surface: Surface): Promise<PointInventory> {
    const store = await this.getStore(storeId);
    if (!store) return { points: [], truncated: false };
    const groups = await (await this.obsCol()).aggregate<{ _id: string; latest: RankObservation; observedFrom: string; observedTo: string; observations: number; coordinateVariants: number }>([
      { $match: { storeId, placeId: store.placeId, surface } }, { $sort: { observedAt: -1, observationId: -1 } },
      { $group: { _id: '$pointId', latest: { $first: '$$ROOT' }, observedFrom: { $min: '$observedAt' }, observedTo: { $max: '$observedAt' }, observations: { $sum: 1 }, coordinates: { $addToSet: { latitude: '$point.latitude', longitude: '$point.longitude' } } } },
      { $project: { latest: 1, observedFrom: 1, observedTo: 1, observations: 1, coordinateVariants: { $size: '$coordinates' } } }, { $sort: { _id: 1 } }, { $limit: 501 },
    ], { allowDiskUse: true }).toArray();
    const points = groups.slice(0, 500).map((g): ObservedPoint => ({ pointId: g._id, point: g.latest.point, locationMode: g.latest.locationMode,
      coordinateStatus: validCoordinates(g.latest.point) ? 'recorded' : 'unavailable', coordinateVariants: g.coordinateVariants,
      observedFrom: g.observedFrom, observedTo: g.observedTo, observations: g.observations, latestObservationId: g.latest.observationId,
      latestStatus: g.latest.rank.status, locationEvidence: g.latest.quality?.locationEvidence ?? null }));
    return { points, truncated: groups.length > 500 };
  }
  async rosterLatest(storeId: string, surface: Surface): Promise<RosterLatest | null> {
    const store = await this.getStore(storeId);
    if (!store) return null;
    const rows = await (await this.obsCol()).aggregate<RankObservation>([
      { $match: { storeId, placeId: store.placeId, surface, pointId: defaultPointId(store), ...(store.fixedPoints ? pointCoordinatesFilter(store, defaultPointId(store)) : {}) } }, { $sort: { observedAt: -1, observationId: -1 } },
      { $group: { _id: '$keywordKey', row: { $first: '$$ROOT' } } }, { $replaceRoot: { newRoot: '$row' } }, { $project: { _id: 0 } },
    ], { allowDiskUse: true }).toArray();
    return summarizeRoster(store, surface, rows);
  }
  async close() { try { await this.client.close(); } finally { this.connected = null; } }
}
