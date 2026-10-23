import { createHash } from 'node:crypto';
import { MongoClient, type Collection } from 'mongodb';
import { balancedShardStores, parseTrackingConfig, shardStores, type TrackingConfig, type ScanTier, type Surface } from './tracking-config.js';
import type { FrozenCatalog } from './scan.js';

export interface RoundRequest {
  roundId: string; configHash: string; surface: Surface; tier: ScanTier;
  shardCount: number; strategy: 'hash' | 'balanced'; storeId: string | null;
}
export interface RoundSnapshot { schemaVersion: 'tracking-scan-round/v1'; version: string; request: RoundRequest; config: TrackingConfig; assignments: string[][] }
export interface RoundRecord { _id: string; request: RoundRequest; state: 'initializing' | 'ready' | 'failed'; json?: string; sha256?: string }
export interface RoundRepository {
  claim(record: RoundRecord): Promise<boolean>;
  get(id: string): Promise<RoundRecord | null>;
  publish(id: string, json: string, sha256: string): Promise<void>;
  fail(id: string): Promise<void>;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const roundConfigHash = (config: TrackingConfig): string => hash(JSON.stringify({ ...config, stores: [] }));
const assignments = (config: TrackingConfig, request: RoundRequest): string[][] => Array.from({ length: request.shardCount }, (_, index) =>
  (request.strategy === 'balanced' ? balancedShardStores(config, request, index, request.shardCount) : shardStores(config.stores, index, request.shardCount)).map(store => store.storeId));

export function parseRoundSnapshot(raw: unknown): RoundSnapshot {
  const value = raw as RoundSnapshot;
  if (!value || value.schemaVersion !== 'tracking-scan-round/v1' || !value.request || value.version !== value.request.roundId) throw new Error('invalid scan round snapshot');
  validateRequest(value.request);
  const config = parseTrackingConfig(value.config);
  if (roundConfigHash(config) !== value.request.configHash || JSON.stringify(assignments(config, value.request)) !== JSON.stringify(value.assignments)) throw new Error('scan round config or assignments mismatch');
  return { ...value, config };
}
function validateRequest(request: RoundRequest): void {
  if (!/^[a-zA-Z0-9_-]{1,120}$/u.test(request.roundId) || !/^[a-f0-9]{64}$/u.test(request.configHash) ||
      !Number.isInteger(request.shardCount) || request.shardCount < 1 || request.shardCount > 100 ||
      !['web', 'android'].includes(request.surface) || !['point', 'grid'].includes(request.tier) || !['hash', 'balanced'].includes(request.strategy) ||
      !(request.storeId === null || typeof request.storeId === 'string')) throw new Error('invalid scan round identity or shard configuration');
}

/** The _id insert elects one initializer. Never steal an initializing round: a dead initializer fails closed. */
export async function resolveScanRound(repo: RoundRepository, request: RoundRequest, load: () => Promise<TrackingConfig>, options: { timeoutMs?: number; pollMs?: number } = {}): Promise<{ config: TrackingConfig; snapshot: FrozenCatalog }> {
  validateRequest(request);
  if (await repo.claim({ _id: request.roundId, request, state: 'initializing' })) {
    try {
      const config = await load();
      const value = parseRoundSnapshot({ schemaVersion: 'tracking-scan-round/v1', version: request.roundId, request, config, assignments: assignments(config, request) });
      const json = JSON.stringify(value);
      await repo.publish(request.roundId, json, hash(json));
    } catch (error) { await repo.fail(request.roundId).catch(() => undefined); throw error; }
  }
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  do {
    const record = await repo.get(request.roundId);
    if (!record || JSON.stringify(record.request) !== JSON.stringify(request)) throw new Error('scan round request mismatch');
    if (record.state === 'failed') throw new Error('scan round initialization failed; use a new round after investigation');
    if (record.state === 'ready') {
      if (!record.json || hash(record.json) !== record.sha256) throw new Error('scan round checksum mismatch');
      const value = parseRoundSnapshot(JSON.parse(record.json));
      if (JSON.stringify(value.request) !== JSON.stringify(request)) throw new Error('scan round payload identity mismatch');
      return { config: value.config, snapshot: { version: value.version, sha256: record.sha256!, bytes: Buffer.from(record.json) } };
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, options.pollMs ?? 250));
  } while (Date.now() <= deadline);
  throw new Error('scan round initialization timed out; no collection started');
}

export class MongoRoundRepository implements RoundRepository {
  private readonly client: MongoClient;
  private readonly collection: Collection<RoundRecord>;
  constructor(uri: string, database: string) {
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });
    this.collection = this.client.db(database).collection<RoundRecord>('scan-round-snapshots-v1', { writeConcern: { w: 'majority' }, readConcern: { level: 'majority' }, readPreference: 'primary' });
  }
  async claim(record: RoundRecord): Promise<boolean> {
    try { await this.collection.insertOne(record); return true; }
    catch (error) { if ((error as { code?: number }).code === 11000) return false; throw error; }
  }
  get(id: string): Promise<RoundRecord | null> { return this.collection.findOne({ _id: id }); }
  async publish(id: string, json: string, sha256: string): Promise<void> {
    const result = await this.collection.updateOne({ _id: id, state: 'initializing' }, { $set: { state: 'ready', json, sha256 } });
    if (result.matchedCount !== 1) throw new Error('scan round initializer lost ownership');
  }
  async fail(id: string): Promise<void> { await this.collection.updateOne({ _id: id, state: 'initializing' }, { $set: { state: 'failed' } }); }
  close(): Promise<void> { return this.client.close(); }
}
