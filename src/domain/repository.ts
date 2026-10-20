import { MongoClient, type MongoClientOptions } from 'mongodb';
import { observationCohortKey, organicRankForMetrics, type RankObservation, type Surface } from './model.js';
import { parseStore, type TrackingStore } from './tracking-config.js';

/**
 * Read and manage tracking data: the stores collection (managed through the UI) and the
 * observations collection (written by scans). One interface, a MongoDB and an in-memory version.
 */
export interface StoredStore extends TrackingStore { createdAt: string; updatedAt: string }
export interface LatestRank {
  keyword: string; keywordKey: string; keywordTier: RankObservation['keywordTier']; surface: Surface; pointId: string;
  observedAt: string; status: RankObservation['rank']['status']; displayPosition: number | null; organicRank: number | null;
  listingsObserved: number; previousOrganicRank: number | null; previousObservedAt: string | null;
  screenshotKeys: string[]; topListings: RankObservation['topListings'];
  eligible: boolean;
}
export interface TrendPoint { observedAt: string; status: RankObservation['rank']['status']; displayPosition: number | null; organicRank: number | null; scanId: string; eligible: boolean }
export interface StoreSummary { storeId: string; surface: Surface; lastObservedAt: string | null; keywords: number; ranked: number; top3: number; averageOrganicRank: number | null; unavailable: number }

export interface TrackingRepository {
  listStores(options?: { includeInactive?: boolean }): Promise<StoredStore[]>;
  getStore(storeId: string): Promise<StoredStore | null>;
  /** Create or replace; validation happens here so every writer gets the same rules. */
  saveStore(raw: unknown, now?: Date): Promise<StoredStore>;
  setActive(storeId: string, active: boolean, now?: Date): Promise<StoredStore | null>;
  /** Most recent observation per keyword, surface and point, with the one before it for change. */
  latest(storeId: string, options?: { surface?: Surface; pointId?: string }): Promise<LatestRank[]>;
  trend(storeId: string, keywordKey: string, options: { surface: Surface; pointId?: string; since: string }): Promise<TrendPoint[]>;
  /** Observations of one store, keyword and surface on one local date (grid heat maps). */
  day(storeId: string, keywordKey: string, options: { surface: Surface; localDate: string }): Promise<RankObservation[]>;
  summaries(options?: { surface?: Surface }): Promise<StoreSummary[]>;
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
    group.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
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

function ensureSameIdentity(existing: StoredStore | null | undefined, next: TrackingStore): void {
  if (existing && (existing.placeId !== next.placeId || existing.center.latitude !== next.center.latitude || existing.center.longitude !== next.center.longitude)) {
    throw new Error('store identity cannot change in the UI; use a new storeId for a different place, or a reviewed migration to move the same place');
  }
}
function belongsToStore(row: RankObservation, store: StoredStore | null): boolean {
  if (!store || row.placeId !== store.placeId) return false;
  if (row.pointId !== 'r0c0') return true;
  return typeof row.point.latitude === 'number' && typeof row.point.longitude === 'number'
    && Math.abs(row.point.latitude - store.center.latitude) <= 0.000001
    && Math.abs(row.point.longitude - store.center.longitude) <= 0.000001;
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
  async saveStore(raw: unknown, now = new Date()) {
    const store = parseStore(raw);
    ensureSameIdentity(this.stores.get(store.storeId), store);
    const clash = [...this.stores.values()].find(s => s.placeId === store.placeId && s.storeId !== store.storeId);
    if (clash) throw new Error(`placeId already tracked by ${clash.storeId}`);
    const saved: StoredStore = { ...store, createdAt: this.stores.get(store.storeId)?.createdAt ?? now.toISOString(), updatedAt: now.toISOString() };
    this.stores.set(store.storeId, saved);
    return saved;
  }
  async setActive(storeId: string, active: boolean, now = new Date()) {
    const store = this.stores.get(storeId);
    if (!store) return null;
    const saved = { ...store, active, updatedAt: now.toISOString() };
    this.stores.set(storeId, saved);
    return saved;
  }
  async latest(storeId: string, options: { surface?: Surface; pointId?: string } = {}) {
    const store = await this.getStore(storeId);
    return toLatest(this.observations.filter(o => o.storeId === storeId && belongsToStore(o, store) && (!options.surface || o.surface === options.surface) && o.pointId === (options.pointId ?? 'r0c0')));
  }
  async trend(storeId: string, keywordKey: string, options: { surface: Surface; pointId?: string; since: string }) {
    const store = await this.getStore(storeId);
    return trendRows(this.observations.filter(o => o.storeId === storeId && belongsToStore(o, store) && o.keywordKey === keywordKey && o.surface === options.surface && o.pointId === (options.pointId ?? 'r0c0') && o.observedAt >= options.since));
  }
  async day(storeId: string, keywordKey: string, options: { surface: Surface; localDate: string }) {
    const store = await this.getStore(storeId);
    return this.observations.filter(o => o.storeId === storeId && belongsToStore(o, store) && o.keywordKey === keywordKey && o.surface === options.surface && o.localDate === options.localDate);
  }
  async summaries(options: { surface?: Surface } = {}) {
    const surface = options.surface ?? 'web';
    const stores = await this.listStores({ includeInactive: true });
    return Promise.all(stores.map(async s => summarize(s.storeId, surface, await this.latest(s.storeId, { surface }))));
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
    }).catch(error => { this.connected = null; throw error; });
    await this.connected;
    return this.client.db(this.options.database);
  }
  private async storesCol() { return (await this.db()).collection<StoredStore & { _id: string }>(this.options.storesCollection ?? 'stores'); }
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
  async saveStore(raw: unknown, now = new Date()) {
    const store = parseStore(raw);
    const col = await this.storesCol();
    const clash = await col.findOne({ placeId: store.placeId, _id: { $ne: store.storeId } });
    if (clash) throw new Error(`placeId already tracked by ${clash.storeId}`);
    const existing = await col.findOne({ _id: store.storeId });
    ensureSameIdentity(existing, store);
    const saved: StoredStore = { ...store, createdAt: existing?.createdAt ?? now.toISOString(), updatedAt: now.toISOString() };
    await col.replaceOne({ _id: store.storeId }, saved, { upsert: true });
    return saved;
  }
  async setActive(storeId: string, active: boolean, now = new Date()) {
    const col = await this.storesCol();
    await col.updateOne({ _id: storeId }, { $set: { active, updatedAt: now.toISOString() } });
    return this.getStore(storeId);
  }
  async latest(storeId: string, options: { surface?: Surface; pointId?: string } = {}) {
    const store = await this.getStore(storeId);
    if (!store) return [];
    const col = await this.obsCol();
    const pointId = options.pointId ?? 'r0c0';
    const match: Record<string, unknown> = { storeId, placeId: store.placeId, pointId, ...(options.surface ? { surface: options.surface } : {}),
      ...(pointId === 'r0c0' ? { 'point.latitude': { $gte: store.center.latitude - 0.000001, $lte: store.center.latitude + 0.000001 }, 'point.longitude': { $gte: store.center.longitude - 0.000001, $lte: store.center.longitude + 0.000001 } } : {}) };
    // Two newest per keyword, surface and point.
    const rows = await col.aggregate<RankObservation>([
      { $match: match }, { $sort: { observedAt: -1 } },
      { $group: { _id: { s: '$surface', k: '$keywordKey', p: '$pointId' }, docs: { $push: '$$ROOT' } } },
      { $project: { docs: { $slice: ['$docs', 2] } } }, { $unwind: '$docs' }, { $replaceRoot: { newRoot: '$docs' } }, { $project: { _id: 0 } },
    ], { allowDiskUse: true }).toArray();
    return toLatest(rows);
  }
  async trend(storeId: string, keywordKey: string, options: { surface: Surface; pointId?: string; since: string }) {
    const store = await this.getStore(storeId);
    if (!store) return [];
    const pointId = options.pointId ?? 'r0c0';
    const col = await this.obsCol();
    const match = { storeId, placeId: store.placeId, keywordKey, surface: options.surface, pointId, observedAt: { $gte: options.since },
      ...(pointId === 'r0c0' ? { 'point.latitude': { $gte: store.center.latitude - 0.000001, $lte: store.center.latitude + 0.000001 }, 'point.longitude': { $gte: store.center.longitude - 0.000001, $lte: store.center.longitude + 0.000001 } } : {}) };
    // Fetch a bounded timeline, including missing-result gaps and profile transitions. Filtering
    // metadata in Mongo would remove the very records that must break the rendered curve.
    const docs = await col.find(match, { sort: { observedAt: -1 }, limit: 2000, projection: { _id: 0 } }).toArray();
    return trendRows(docs);
  }
  async day(storeId: string, keywordKey: string, options: { surface: Surface; localDate: string }) {
    const store = await this.getStore(storeId);
    if (!store) return [];
    const docs = await (await this.obsCol()).find({ storeId, placeId: store.placeId, keywordKey, surface: options.surface, localDate: options.localDate }, { sort: { observedAt: -1 }, projection: { _id: 0 }, limit: 5000 }).toArray();
    return docs as unknown as RankObservation[];
  }
  async summaries(options: { surface?: Surface } = {}) {
    const surface = options.surface ?? 'web';
    const stores = await this.listStores({ includeInactive: true });
    return Promise.all(stores.map(async s => summarize(s.storeId, surface, await this.latest(s.storeId, { surface }))));
  }
  async close() { try { await this.client.close(); } finally { this.connected = null; } }
}
