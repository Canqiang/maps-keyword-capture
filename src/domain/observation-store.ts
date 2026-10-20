import { MongoClient, type MongoClientOptions } from 'mongodb';
import type { RankObservation } from './model.js';

export interface UpsertResult { inserted: number; updated: number }
export interface ObservationStore {
  upsert(observations: RankObservation[]): Promise<UpsertResult>;
  close(): Promise<void>;
}

/** In-memory store for tests and dry runs. */
export class MemoryObservationStore implements ObservationStore {
  readonly documents = new Map<string, RankObservation>();
  async upsert(observations: RankObservation[]): Promise<UpsertResult> {
    let inserted = 0, updated = 0;
    for (const observation of observations) {
      if (this.documents.has(observation.observationId)) updated++; else inserted++;
      this.documents.set(observation.observationId, structuredClone(observation));
    }
    return { inserted, updated };
  }
  async close(): Promise<void> { /* nothing to release */ }
}

export interface MongoObservationStoreOptions {
  uri: string; database: string; collection?: string; timeoutMs?: number;
  createClient?: (uri: string, options: MongoClientOptions) => MongoClient;
}
/**
 * MongoDB store: one document per observation, `_id` = observationId, so ingesting the same
 * manifest twice is a no-op. Indexes serve the trend (store, keyword, surface, point, time) and
 * the per-scan lookups.
 */
export class MongoObservationStore implements ObservationStore {
  private readonly client: MongoClient;
  private readonly database: string;
  private readonly collection: string;
  private connected = false;
  private indexed = false;
  constructor(options: MongoObservationStoreOptions) {
    if (!options.uri?.trim()) throw new Error('observation store uri is required');
    const timeoutMs = options.timeoutMs ?? 15_000;
    const clientOptions: MongoClientOptions = { appName: 'maps-keyword-capture-tracking', serverSelectionTimeoutMS: timeoutMs, connectTimeoutMS: timeoutMs, socketTimeoutMS: timeoutMs };
    this.client = options.createClient ? options.createClient(options.uri, clientOptions) : new MongoClient(options.uri, clientOptions);
    this.database = options.database;
    this.collection = options.collection ?? 'observations';
  }
  private async coll() {
    if (!this.connected) { await this.client.connect(); this.connected = true; }
    const collection = this.client.db(this.database).collection<RankObservation & { _id: string }>(this.collection);
    if (!this.indexed) {
      await collection.createIndexes([
        { key: { storeId: 1, keywordKey: 1, surface: 1, pointId: 1, observedAt: -1 }, name: 'trend' },
        { key: { scanId: 1 }, name: 'scan' },
        { key: { storeId: 1, localDate: 1, surface: 1 }, name: 'daily' },
      ]);
      this.indexed = true;
    }
    return collection;
  }
  async upsert(observations: RankObservation[]): Promise<UpsertResult> {
    if (!observations.length) return { inserted: 0, updated: 0 };
    const collection = await this.coll();
    const result = await collection.bulkWrite(observations.map(observation => ({
      replaceOne: { filter: { _id: observation.observationId }, replacement: { _id: observation.observationId, ...observation }, upsert: true },
    })), { ordered: false });
    return { inserted: result.upsertedCount, updated: result.modifiedCount + (result.matchedCount - result.modifiedCount) };
  }
  /** Latest observations, newest first, for operational checks. */
  async recent(query: { storeId?: string; limit: number }): Promise<RankObservation[]> {
    const collection = await this.coll();
    const docs = await collection.find(query.storeId ? { storeId: query.storeId } : {}, { sort: { observedAt: -1 }, limit: query.limit, projection: { _id: 0 } }).toArray();
    return docs as unknown as RankObservation[];
  }
  async close(): Promise<void> {
    if (this.connected) { await this.client.close(); this.connected = false; }
  }
}
