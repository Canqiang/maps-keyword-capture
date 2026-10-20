import { MongoClient, type MongoClientOptions } from 'mongodb';
import type { RankObservation, Surface } from './model.js';
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
}
export interface TrendPoint { observedAt: string; status: RankObservation['rank']['status']; displayPosition: number | null; organicRank: number | null; scanId: string }
export interface StoreSummary { storeId: string; lastObservedAt: string | null; keywords: number; ranked: number; top3: number; averageOrganicRank: number | null }

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
  summaries(): Promise<StoreSummary[]>;
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
    out.push({ keyword: current.keyword, keywordKey: current.keywordKey, keywordTier: current.keywordTier, surface: current.surface, pointId: current.pointId,
      observedAt: current.observedAt, status: current.rank.status, displayPosition: current.rank.displayPosition, organicRank: current.rank.organicRank,
      listingsObserved: current.rank.listingsObserved, previousOrganicRank: previous?.rank.organicRank ?? null, previousObservedAt: previous?.observedAt ?? null,
      screenshotKeys: current.evidence.screenshotKeys, topListings: current.topListings });
  }
  const tierOrder = (tier: LatestRank['keywordTier']): number => (tier === 'core' ? 0 : tier === 'longTail' ? 1 : 2);
  return out.sort((a, b) => tierOrder(a.keywordTier) - tierOrder(b.keywordTier) || (a.organicRank ?? 99) - (b.organicRank ?? 99) || a.keyword.localeCompare(b.keyword));
}
function summarize(storeId: string, latest: LatestRank[]): StoreSummary {
  const ranks = latest.map(l => l.organicRank).filter((r): r is number => r !== null);
  return { storeId, lastObservedAt: latest.reduce<string | null>((max, l) => (max === null || l.observedAt > max ? l.observedAt : max), null), keywords: latest.length, ranked: ranks.length,
    top3: ranks.filter(r => r <= 3).length, averageOrganicRank: ranks.length ? Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 10) / 10 : null };
}

export class MemoryTrackingRepository implements TrackingRepository {
  readonly stores = new Map<string, StoredStore>();
  constructor(readonly observations: RankObservation[] = []) {}
  async listStores(options: { includeInactive?: boolean } = {}) { return [...this.stores.values()].filter(s => options.includeInactive || s.active).sort((a, b) => a.name.localeCompare(b.name)); }
  async getStore(storeId: string) { return this.stores.get(storeId) ?? null; }
  async saveStore(raw: unknown, now = new Date()) {
    const store = parseStore(raw);
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
    return toLatest(this.observations.filter(o => o.storeId === storeId && (!options.surface || o.surface === options.surface) && o.pointId === (options.pointId ?? 'r0c0')));
  }
  async trend(storeId: string, keywordKey: string, options: { surface: Surface; pointId?: string; since: string }) {
    return this.observations.filter(o => o.storeId === storeId && o.keywordKey === keywordKey && o.surface === options.surface && o.pointId === (options.pointId ?? 'r0c0') && o.observedAt >= options.since)
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
      .map(o => ({ observedAt: o.observedAt, status: o.rank.status, displayPosition: o.rank.displayPosition, organicRank: o.rank.organicRank, scanId: o.scanId }));
  }
  async day(storeId: string, keywordKey: string, options: { surface: Surface; localDate: string }) {
    return this.observations.filter(o => o.storeId === storeId && o.keywordKey === keywordKey && o.surface === options.surface && o.localDate === options.localDate);
  }
  async summaries() {
    const stores = await this.listStores({ includeInactive: true });
    return Promise.all(stores.map(async s => summarize(s.storeId, await this.latest(s.storeId))));
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
    const col = await this.obsCol();
    const match: Record<string, unknown> = { storeId, pointId: options.pointId ?? 'r0c0', ...(options.surface ? { surface: options.surface } : {}) };
    // Two newest per keyword, surface and point.
    const rows = await col.aggregate<RankObservation>([
      { $match: match }, { $sort: { observedAt: -1 } },
      { $group: { _id: { s: '$surface', k: '$keywordKey', p: '$pointId' }, docs: { $push: '$$ROOT' } } },
      { $project: { docs: { $slice: ['$docs', 2] } } }, { $unwind: '$docs' }, { $replaceRoot: { newRoot: '$docs' } }, { $project: { _id: 0 } },
    ], { allowDiskUse: true }).toArray();
    return toLatest(rows);
  }
  async trend(storeId: string, keywordKey: string, options: { surface: Surface; pointId?: string; since: string }) {
    const docs = await (await this.obsCol()).find({ storeId, keywordKey, surface: options.surface, pointId: options.pointId ?? 'r0c0', observedAt: { $gte: options.since } },
      { sort: { observedAt: 1 }, limit: 2000, projection: { observedAt: 1, rank: 1, scanId: 1 } }).toArray();
    return docs.map(d => ({ observedAt: d.observedAt, status: d.rank.status, displayPosition: d.rank.displayPosition, organicRank: d.rank.organicRank, scanId: d.scanId }));
  }
  async day(storeId: string, keywordKey: string, options: { surface: Surface; localDate: string }) {
    const docs = await (await this.obsCol()).find({ storeId, keywordKey, surface: options.surface, localDate: options.localDate }, { projection: { _id: 0 }, limit: 5000 }).toArray();
    return docs as unknown as RankObservation[];
  }
  async summaries() {
    const stores = await this.listStores({ includeInactive: true });
    return Promise.all(stores.map(async s => summarize(s.storeId, await this.latest(s.storeId))));
  }
  async close() { if (this.connected) { await this.client.close(); this.connected = null; } }
}
