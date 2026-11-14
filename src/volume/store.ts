import { MongoClient } from 'mongodb';
import type { VolumeRow } from './sync.js';

export interface StoreVolumes { storeId: string; runId: string; checkedAt: string; rows: VolumeRow[] }
export interface VolumeReader { get(storeId: string): Promise<StoreVolumes | null>; close(): Promise<void> }
export class MongoVolumeStore implements VolumeReader {
  private readonly client: MongoClient;
  constructor(uri: string, private readonly database: string) { this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000, socketTimeoutMS: 30_000, appName: 'maps-search-volume' }); }
  private get current() { return this.client.db(this.database).collection<StoreVolumes & { _id: string }>('search-volume-current-v1'); }
  async get(storeId: string): Promise<StoreVolumes | null> { const row = await this.current.findOne({ _id: storeId }, { maxTimeMS: 5000 }); if (!row) return null; const { _id, ...data } = row; return data; }
  async save(data: StoreVolumes): Promise<void> {
    await this.client.db(this.database).collection<StoreVolumes & { _id: string }>('search-volume-history-v1').replaceOne({ _id: `${data.runId}/${data.storeId}` }, data, { upsert: true });
    await this.current.replaceOne({ _id: data.storeId }, data, { upsert: true });
  }
  async acquire(runId: string, now: Date): Promise<boolean> {
    const col = this.client.db(this.database).collection<{ _id: string; runId: string; expiresAt: Date }>('search-volume-lock-v1');
    try { return (await col.updateOne({ _id: 'weekly', expiresAt: { $lte: now } }, { $set: { runId, expiresAt: new Date(now.getTime() + 2 * 3600_000) } }, { upsert: true })).acknowledged; }
    catch (e) { if ((e as { code?: number }).code === 11000) return false; throw e; }
  }
  async release(runId: string): Promise<void> { await this.client.db(this.database).collection<{_id: string; runId: string}>('search-volume-lock-v1').deleteOne({ _id: 'weekly', runId }); }
  async saveRun(runId: string, data: Record<string, unknown>): Promise<void> { await this.client.db(this.database).collection<{ _id: string }>('search-volume-runs-v1').updateOne({ _id: runId }, { $set: data }, { upsert: true }); }
  async close(): Promise<void> { await this.client.close(); }
}
