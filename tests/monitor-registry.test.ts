import { describe, expect, it, vi } from 'vitest';
import { hashJson, sha256Hex } from '../src/ids.js';
import { parseMonitorConfig } from '../src/monitor/config.js';
import { MongoStoreRegistrySource, parseStoreRegistry, type RegistryMongoClient } from '../src/monitor/registry.js';

const discovery = { provider: 'mongo' as const, database: 'seo-integration', collection: 'local_keywords', maxStores: 40, maxRecords: 10000, timeoutMs: 100 };
const alias = { storeId: 'only-bear', merchantId: 'merchant-1', placeId: 'ChIJknown-place', name: 'Old name' };
const record = (patch = {}) => ({ _id: 'record-1', merchant_id: alias.merchantId, place_id: alias.placeId, name: 'New name', keywords: [{ keyword: 'boba', priority: 'P1' }], ...patch });
const opts = { aliases: [alias], maxStores: 40, maxRecords: 10000, fetchedAt: '2026-09-23T00:00:00.000Z' };
const monitor = { schemaVersion: '1', sourceBaseUrl: 'http://example.test', stores: [alias], maxKeywordsPerStore: 40, batchSize: 20, sourceTimeoutMs: 100, outputDirectory: '/tmp/discovery-test', capture: {} };

function fakeClient(records: unknown[] = [record()]) {
  const cursor = { toArray: vi.fn(async () => records), close: vi.fn(async () => {}) };
  const collection = { find: vi.fn(() => cursor) };
  const db = { collection: vi.fn(() => collection) };
  const client = { connect: vi.fn(async () => {}), db: vi.fn(() => db), close: vi.fn(async () => {}) };
  return { client, db, collection, cursor };
}
function provider(f = fakeClient(), patch = {}) {
  return { ...f, source: new MongoStoreRegistrySource({ uri: 'mongodb://user:secret@db.test', config: discovery, aliases: [alias], createClient: () => f.client as unknown as RegistryMongoClient, now: () => new Date(opts.fetchedAt), ...patch }) };
}

describe('daily store discovery configuration', () => {
  it('allows an empty or omitted alias list only with validated discovery', () => {
    expect(parseMonitorConfig({ ...monitor, stores: [], storeDiscovery: discovery }).stores).toEqual([]);
    const { stores: _, ...withoutStores } = monitor;
    expect(parseMonitorConfig({ ...withoutStores, storeDiscovery: discovery }).storeDiscovery).toEqual(discovery);
    expect(() => parseMonitorConfig({ ...monitor, stores: [] })).toThrow(/stores/);
    expect(() => parseMonitorConfig(withoutStores)).toThrow(/stores/);
  });
  it.each([{ provider: 'api' }, { maxStores: 0 }, { maxRecords: 0 }, { timeoutMs: 0 }, { timeoutMs: 60001 }, { database: 'db/escape' }, { collection: 'system.users' }, { uri: 'mongodb://secret' }, { maxStores: 3, maxRecords: 2 }])('rejects unsafe or invalid discovery settings %j', patch => {
    expect(() => parseMonitorConfig({ ...monitor, storeDiscovery: { ...discovery, ...patch } })).toThrow();
  });
});

describe('store registry normalization', () => {
  it('keeps an existing ID and expected area while using the current source name', () => {
    const expectedArea = { label: 'Mineola', latitude: 40.75, longitude: -73.64, radiusKm: 10, source: 'registry' };
    const snap = parseStoreRegistry([record()], { ...opts, aliases: [{ ...alias, expectedArea }] });
    expect(snap.stores).toEqual([{ ...alias, name: 'New name', expectedArea }]);
    expect(snap.counts).toEqual({ fetched: 1, eligible: 1, excluded: 0 });
    expect(snap).not.toHaveProperty('uri');
    expect(JSON.stringify(snap)).not.toContain('boba');
  });
  it('discovers new canonical stores and keeps IDs stable across rename/source order changes', () => {
    const fresh = record({ _id: 'new-record', merchant_id: 'merchant-2', place_id: 'OpaqueGooglePlaceKey', name: 'New store' });
    const first = parseStoreRegistry([record(), fresh], opts);
    const second = parseStoreRegistry([{ ...fresh, name: 'Renamed' }, record()], opts);
    const id = `place-${sha256Hex('OpaqueGooglePlaceKey').slice(0, 32)}`;
    expect(first.stores.find(s => s.storeId === id)?.name).toBe('New store');
    expect(second.stores.find(s => s.storeId === id)?.name).toBe('Renamed');
    expect(parseStoreRegistry([fresh, record()], opts).sourceResponseHash).toBe(first.sourceResponseHash);
  });
  it('hashes only normalized source identities and exclusions, not credentials or keyword content', () => {
    const first = parseStoreRegistry([record({ unexpected: 'private' })], opts);
    const second = parseStoreRegistry([record({ keywords: [{ keyword: 'changed' }] })], opts);
    expect(first.sourceResponseHash).toBe(second.sourceResponseHash);
    expect(first.sourceResponseHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.sourceResponseHash).not.toBe(hashJson([record()]));
  });
  it.each([
    [{ _id: undefined }, 'missing_source_id'],
    [{ merchant_id: '' }, 'invalid_merchant_id'],
    [{ place_id: undefined }, 'invalid_place_id'],
    [{ place_id: '90e03766-c90f-4804-9889-df5795400038' }, 'invalid_place_id'],
    [{ place_id: '65d656c5989919a65bc4d1ae' }, 'invalid_place_id'],
    [{ place_id: '../escape' }, 'invalid_place_id'],
    [{ name: ' ' }, 'missing_name'],
    [{ keywords: [] }, 'empty_keywords'],
    [{ keywords: 'wrong' }, 'invalid_keywords'],
  ])('records explicit exclusions for invalid/legacy data %j', (patch, reason) => {
    const snap = parseStoreRegistry([record(patch)], opts);
    expect(snap.stores).toEqual([]);
    expect(snap.exclusions).toEqual([{ sourceId: patch._id === undefined && '_id' in patch ? null : 'record-1', reason }]);
    expect(snap.counts).toEqual({ fetched: 1, eligible: 0, excluded: 1 });
  });
  it('does not invent an enabled flag absent from the keyword-library contract', () => {
    expect(parseStoreRegistry([record({ enabled: false, status: 'RETIRED' })], opts).stores).toHaveLength(1);
  });
  it.each([
    [[record(), record({ _id: 'other' })], 'registry_duplicate_place'],
    [[record(), record({ _id: 'other', merchant_id: 'other-merchant' })], 'registry_ownership_conflict'],
    [[record({ merchant_id: 'other-merchant' })], 'registry_alias_identity_mismatch'],
  ])('fails closed for ambiguous identity %j', (records, error) => expect(() => parseStoreRegistry(records, opts)).toThrow(error));
  it('rejects alias IDs or places that collide, including a generated ID collision', () => {
    expect(() => parseStoreRegistry([record()], { ...opts, aliases: [alias, { ...alias, placeId: 'Other' }] })).toThrow('registry_alias_collision');
    const generated = `place-${sha256Hex('NewPlace').slice(0, 32)}`;
    expect(() => parseStoreRegistry([record(), record({ _id: 'second', merchant_id: 'other', place_id: 'NewPlace' })], { ...opts, aliases: [{ ...alias, storeId: generated }] })).toThrow('registry_store_id_collision');
  });
  it('fails on capacity overflow instead of silently truncating or accepting an oversized source', () => {
    expect(() => parseStoreRegistry([record(), record({ _id: 'second', place_id: 'AnotherPlace' })], { ...opts, maxStores: 1 })).toThrow('registry_capacity_exceeded');
    expect(() => parseStoreRegistry([record(), record({ _id: 'second' })], { ...opts, maxRecords: 1 })).toThrow('registry_record_limit_exceeded');
  });
});

describe('Mongo registry read boundary', () => {
  it('uses a bounded projection read, current timestamp and immediate connection cleanup', async () => {
    const p = provider();
    const snap = await p.source.read();
    expect(p.client.connect).toHaveBeenCalledTimes(1);
    expect(p.client.db).toHaveBeenCalledWith('seo-integration');
    expect(p.db.collection).toHaveBeenCalledWith('local_keywords');
    expect(p.collection.find).toHaveBeenCalledWith({}, expect.objectContaining({ limit: 10001, sort: { _id: 1 }, maxTimeMS: 100, signal: expect.any(AbortSignal), projection: { _id: 1, merchant_id: 1, place_id: 1, name: 1, keywords: { $slice: 1 } } }));
    expect(snap.fetchedAt).toBe(opts.fetchedAt);
    expect(p.cursor.close).toHaveBeenCalledTimes(1);
    expect(p.client.close).toHaveBeenCalledTimes(1);
  });
  it('rejects absent credentials before constructing or connecting a client', async () => {
    const p = provider(undefined, { uri: undefined });
    await expect(p.source.read()).rejects.toThrow('registry_credentials_missing');
    expect(p.client.connect).not.toHaveBeenCalled();
  });
  it('replaces driver errors with a safe code and still closes connection', async () => {
    const f = fakeClient(); f.cursor.toArray.mockRejectedValueOnce(new Error('mongodb://user:secret@db.test'));
    const p = provider(f);
    await expect(p.source.read()).rejects.toThrow(/^registry_read_failed$/);
    expect(p.client.close).toHaveBeenCalledTimes(1);
  });
  it('cleans up on connection failure without exposing the URI', async () => {
    const f = fakeClient(); f.client.connect.mockRejectedValueOnce(new Error('mongodb://user:secret@db.test'));
    const p = provider(f);
    await expect(p.source.read()).rejects.toThrow(/^registry_read_failed$/);
    expect(p.collection.find).not.toHaveBeenCalled();
    expect(p.client.close).toHaveBeenCalledTimes(1);
  });
  it('does not hang indefinitely if connection cleanup stalls', async () => {
    const f = fakeClient(); f.client.close.mockImplementationOnce(() => new Promise(() => {}));
    const p = provider(f, { config: { ...discovery, timeoutMs: 10 } });
    await expect(p.source.read()).rejects.toThrow(/^registry_cleanup_failed$/);
  });
  it('does not report a successful discovery when connection cleanup rejects', async () => {
    const f = fakeClient(); f.client.close.mockRejectedValueOnce(new Error('secret'));
    await expect(provider(f).source.read()).rejects.toThrow(/^registry_cleanup_failed$/);
  });
  it('bounds a stalled read and closes both cursor and connection', async () => {
    const f = fakeClient(); f.cursor.toArray.mockImplementationOnce(() => new Promise(() => {}));
    const p = provider(f, { config: { ...discovery, timeoutMs: 10 } });
    await expect(p.source.read()).rejects.toThrow(/^registry_timeout$/);
    expect(p.cursor.close).toHaveBeenCalledTimes(1);
    expect(p.client.close).toHaveBeenCalledTimes(1);
    expect((p.collection.find.mock.calls[0] as any)[1].signal.aborted).toBe(true);
  });
  it('does not connect for an already-cancelled operation', async () => {
    const p = provider();
    await expect(p.source.read(AbortSignal.abort())).rejects.toThrow(/^registry_cancelled$/);
    expect(p.client.connect).not.toHaveBeenCalled();
  });
  it('cancels an in-flight read and never proceeds after a stalled connect resolves late', async () => {
    const f = fakeClient(); let release!: () => void;
    f.client.connect.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const p = provider(f); const abort = new AbortController();
    const read = p.source.read(abort.signal); abort.abort();
    await expect(read).rejects.toThrow(/^registry_cancelled$/);
    release(); await Promise.resolve(); await Promise.resolve();
    expect(p.collection.find).not.toHaveBeenCalled();
    expect(p.client.close).toHaveBeenCalled();
  });
});
