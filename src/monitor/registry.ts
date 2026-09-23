import { MongoClient, ObjectId, type MongoClientOptions } from 'mongodb';
import { hashJson, sha256Hex } from '../ids.js';
import { safeId, type EnrolledStore, type MonitorConfig } from './config.js';

export interface StoreRegistrySnapshot {
  schemaVersion: '1';
  fetchedAt: string;
  /** Hash of normalized source identities and exclusions, not the unprojected database documents. */
  sourceResponseHash: string;
  policy: string;
  stores: EnrolledStore[];
  exclusions: { sourceId: string | null; reason: string }[];
  counts: { fetched: number; eligible: number; excluded: number };
}
export interface StoreRegistrySource { read(signal?: AbortSignal): Promise<StoreRegistrySnapshot> }
export const REGISTRY_POLICY = 'Canonical keyword-library identities with nonempty keyword arrays; opaque safe place IDs excluding UUID/hex legacy IDs; no Google identity or geographic verification; exact place+merchant aliases; live names; stable place-derived IDs; no enabled flag; duplicate/conflicting identities and capacity overflow fail closed. Source hash covers normalized identities and exclusions only.';
const legacyId = /^(?:[a-f0-9]{24}|[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const validId = (value: unknown): value is string => safeId.safeParse(value).success;
const validPlaceId = (value: unknown): value is string => validId(value) && !legacyId.test(value);
class RegistryError extends Error {}
function fail(code: string): never { throw new RegistryError(code); }
function sourceId(value: unknown): string | null {
  if (typeof value === 'string' && validId(value)) return value;
  if (value instanceof ObjectId) return value.toHexString();
  return null;
}

export function parseStoreRegistry(records: unknown[], options: { aliases: EnrolledStore[]; maxStores: number; maxRecords: number; fetchedAt?: string }): StoreRegistrySnapshot {
  if (records.length > options.maxRecords) fail('registry_record_limit_exceeded');
  const aliases = new Map<string, EnrolledStore>();
  const aliasIds = new Set<string>();
  for (const alias of options.aliases) {
    if (!validId(alias.storeId) || !validId(alias.merchantId) || !validPlaceId(alias.placeId)) fail('registry_alias_invalid');
    if (aliases.has(alias.placeId) || aliasIds.has(alias.storeId)) fail('registry_alias_collision');
    aliases.set(alias.placeId, alias); aliasIds.add(alias.storeId);
  }
  const identities = new Map<string, string>();
  const stores: EnrolledStore[] = [];
  const exclusions: StoreRegistrySnapshot['exclusions'] = [];
  const normalized: { sourceId: string; merchantId: string; placeId: string; name: string }[] = [];
  const ids = new Set<string>();
  for (const raw of records) {
    const record = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const id = sourceId(record._id);
    const exclude = (reason: string) => { exclusions.push({ sourceId: id, reason }); };
    if (!id) { exclude('missing_source_id'); continue; }
    if (!validId(record.merchant_id)) { exclude('invalid_merchant_id'); continue; }
    if (!validPlaceId(record.place_id)) { exclude('invalid_place_id'); continue; }
    const merchantId = record.merchant_id, placeId = record.place_id;
    const owner = identities.get(placeId);
    if (owner !== undefined) fail(owner === merchantId ? 'registry_duplicate_place' : 'registry_ownership_conflict');
    identities.set(placeId, merchantId);
    const alias = aliases.get(placeId);
    if (alias && alias.merchantId !== merchantId) fail('registry_alias_identity_mismatch');
    if (typeof record.name !== 'string' || !record.name.trim()) { exclude('missing_name'); continue; }
    if (!Array.isArray(record.keywords)) { exclude('invalid_keywords'); continue; }
    if (record.keywords.length === 0) { exclude('empty_keywords'); continue; }
    const name = record.name.trim();
    const storeId = alias?.storeId ?? `place-${sha256Hex(placeId).slice(0, 32)}`;
    // Reserve all configured aliases, including aliases absent from today's source.
    if (ids.has(storeId) || (!alias && aliasIds.has(storeId))) fail('registry_store_id_collision');
    ids.add(storeId);
    stores.push({ storeId, merchantId, placeId, name, ...(alias?.expectedArea ? { expectedArea: alias.expectedArea } : {}) });
    normalized.push({ sourceId: id, merchantId, placeId, name });
  }
  if (stores.length > options.maxStores) fail('registry_capacity_exceeded');
  stores.sort((a, b) => a.storeId.localeCompare(b.storeId, 'en'));
  normalized.sort((a, b) => a.placeId.localeCompare(b.placeId, 'en') || a.sourceId.localeCompare(b.sourceId, 'en'));
  exclusions.sort((a, b) => (a.sourceId ?? '').localeCompare(b.sourceId ?? '', 'en') || a.reason.localeCompare(b.reason, 'en'));
  return { schemaVersion: '1', fetchedAt: options.fetchedAt ?? new Date().toISOString(), sourceResponseHash: hashJson({ identities: normalized, exclusions }), policy: REGISTRY_POLICY, stores, exclusions, counts: { fetched: records.length, eligible: stores.length, excluded: exclusions.length } };
}

export interface RegistryMongoCursor { toArray(): Promise<unknown[]>; close(): Promise<void> }
export interface RegistryMongoClient {
  connect(): Promise<unknown>;
  db(name: string): { collection(name: string): { find(filter: Record<string, never>, options: { projection: Record<string, unknown>; sort: { _id: 1 }; limit: number; maxTimeMS: number; signal: AbortSignal }): RegistryMongoCursor } };
  close(): Promise<void>;
}
export class MongoStoreRegistrySource implements StoreRegistrySource {
  constructor(private readonly options: {
    uri: string | undefined;
    config: NonNullable<MonitorConfig['storeDiscovery']>;
    aliases: EnrolledStore[];
    createClient?: (uri: string, options: MongoClientOptions) => RegistryMongoClient;
    now?: () => Date;
  }) {}
  async read(signal?: AbortSignal): Promise<StoreRegistrySnapshot> {
    if (signal?.aborted) fail('registry_cancelled');
    const { config, uri } = this.options;
    if (!uri?.trim()) fail('registry_credentials_missing');
    const controller = new AbortController();
    let client: RegistryMongoClient | undefined;
    let cursor: RegistryMongoCursor | undefined;
    let timer: NodeJS.Timeout | undefined;
    let abortReason: string | undefined;
    let onAbort: (() => void) | undefined;
    let readFailed = false;
    const stop = new Promise<never>((_, reject) => {
      const abort = (reason: string) => { abortReason = reason; controller.abort(); reject(new RegistryError(reason)); };
      timer = setTimeout(() => abort('registry_timeout'), config.timeoutMs);
      onAbort = () => abort('registry_cancelled');
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const clientOptions: MongoClientOptions = { appName: 'maps-keyword-capture-store-discovery', serverSelectionTimeoutMS: config.timeoutMs, connectTimeoutMS: config.timeoutMs, socketTimeoutMS: config.timeoutMs, timeoutMS: config.timeoutMs, maxPoolSize: 1, minPoolSize: 0, retryReads: false };
      client = this.options.createClient ? this.options.createClient(uri, clientOptions) : new MongoClient(uri, clientOptions);
      const activeClient = client;
      const request = async () => {
        await activeClient.connect();
        if (controller.signal.aborted) {
          // A connect that completes after the race must not start a database query or leave a newly connected client open.
          await activeClient.close().catch(() => {});
          fail(abortReason ?? 'registry_cancelled');
        }
        cursor = activeClient.db(config.database).collection(config.collection).find({}, {
          projection: { _id: 1, merchant_id: 1, place_id: 1, name: 1, keywords: { $slice: 1 } },
          sort: { _id: 1 }, limit: config.maxRecords + 1, maxTimeMS: config.timeoutMs, signal: controller.signal,
        });
        const records = await cursor.toArray();
        if (controller.signal.aborted) fail(abortReason ?? 'registry_cancelled');
        return parseStoreRegistry(records, { aliases: this.options.aliases, maxStores: config.maxStores, maxRecords: config.maxRecords, fetchedAt: (this.options.now?.() ?? new Date()).toISOString() });
      };
      return await Promise.race([stop, request()]);
    } catch (error) {
      readFailed = true;
      if (error instanceof RegistryError) throw error;
      // Driver errors may embed credentials, hosts or raw documents. Only fixed codes leave this boundary.
      throw new RegistryError(abortReason ?? 'registry_read_failed');
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      controller.abort();
      // Cleanup is attempted immediately and remains bounded even for a broken transport.
      // The driver's connection/query deadlines remain active for an outstanding connect.
      let cleanupTimer: NodeJS.Timeout | undefined;
      const cleanup = Promise.allSettled([Promise.resolve().then(() => cursor?.close()), Promise.resolve().then(() => client?.close())]);
      try {
        const closed = await Promise.race([cleanup, new Promise<null>(resolve => { cleanupTimer = setTimeout(() => resolve(null), Math.min(config.timeoutMs, 1000)); })]);
        if (!readFailed && (closed === null || closed.some(result => result.status === 'rejected'))) fail('registry_cleanup_failed');
      } finally { if (cleanupTimer) clearTimeout(cleanupTimer); }
    }
  }
}
