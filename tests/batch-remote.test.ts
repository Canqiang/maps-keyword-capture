import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlobServiceClient } from '@azure/storage-blob';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import type { BatchManifest } from '../src/contracts.js';
import { launchBrowser } from '../src/browser/launch.js';
import { closeWithin, runBatch } from '../src/runner/batch-runner.js';
import { DEFAULT_CONTAINER } from '../src/storage/azure-gateway.js';
import { createStore } from '../src/storage/factory.js';
import { LocalArtifactStore } from '../src/storage/local.js';
import { RemoteArtifactStore } from '../src/storage/remote.js';
import { startAzurite } from './helpers/azurite.js';
import { FakeGateway } from './helpers/fake-gateway.js';
import { namedCards, writeFixture } from './fixtures/feed-fixture.js';

let root: string;
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'mkc-batch-remote-')); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

function remoteStore(gateway: FakeGateway, dir = root) {
  return new RemoteArtifactStore({ gateway, local: new LocalArtifactStore(dir) });
}

describe('runBatch with remote delivery', () => {
  it('delivers every artifact and the final manifest, and exits 0', async () => {
    const gateway = new FakeGateway();
    const url = await writeFixture({ query: 'alpha', cards: namedCards(4), endMarkerInitially: true });
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['alpha'], outputDirectory: root });
    const out = await runBatch({ config, store: remoteStore(gateway), searchUrlFor: () => url });
    expect(out.exitCode).toBe(0);
    expect(out.manifest.persistenceMode).toBe('azure_blob');
    expect(out.manifest.queries.map((q) => [q.status, q.persistenceStatus])).toEqual([['captured', 'verified']]);
    expect(out.manifest.artifacts.every((a) => a.storageStatus === 'verified')).toBe(true);
    expect(out.manifest.artifacts.find((a) => a.id === 'request_json')).toMatchObject({ kind: 'request_json', queryId: null, storageStatus: 'verified' });
    expect(out.manifestReceipt).toMatchObject({ storageStatus: 'verified', filename: 'manifest.json', runId: out.manifest.runId });
    const keys = [...gateway.objects.keys()];
    expect(keys.some((k) => k.startsWith('maps-keyword-capture/'))).toBe(false);
    const prefix = out.manifestReceipt!.objectKey!.replace(/manifest\.json$/, '');
    expect(keys).toEqual(expect.arrayContaining([`${prefix}request.json`, `${prefix}manifest.progress.json`, `${prefix}manifest.json`]));
    expect(keys.some((k) => k.startsWith(`${prefix}q0001/qa01/`) && k.endsWith('.png'))).toBe(true);
    const local = await readFile(out.manifestPath);
    expect(gateway.objects.get(`${prefix}manifest.json`)!.equals(local)).toBe(true);
    const published = JSON.parse(local.toString()) as BatchManifest;
    expect(JSON.stringify(published)).not.toContain('manifest.json"');
  });

  it('skips every keyword and never launches a browser when storage is unavailable', async () => {
    const gateway = new FakeGateway();
    gateway.failOn = () => true;
    let launches = 0;
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['a', 'b'], outputDirectory: root });
    const out = await runBatch({ config, store: remoteStore(gateway), launch: async () => { launches += 1; return launchBrowser(); } });
    expect(launches).toBe(0);
    expect(out.manifest.queries.map((q) => [q.status, q.stopReason])).toEqual([['skipped', 'storage_unavailable'], ['skipped', 'storage_unavailable']]);
    expect(out.manifestReceipt).toMatchObject({ storageStatus: 'failed' });
    expect(out.exitCode).toBe(1);
    expect((await readFile(out.manifestPath, 'utf8')).length).toBeGreaterThan(0);
  });

  it('finishes the batch but exits 1 when part of one keyword cannot be delivered', async () => {
    const gateway = new FakeGateway();
    gateway.failOn = (op, key) => op === 'create' && key.includes('/q0001/') && key.endsWith('.png');
    const urls: Record<string, string> = {
      one: await writeFixture({ query: 'one', cards: namedCards(4), endMarkerInitially: true }),
      two: await writeFixture({ query: 'two', cards: namedCards(4), endMarkerInitially: true }),
    };
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['one', 'two'], outputDirectory: root });
    const out = await runBatch({ config, store: remoteStore(gateway), searchUrlFor: (k) => urls[k]! });
    expect(out.manifest.queries.map((q) => [q.status, q.persistenceStatus])).toEqual([['captured', 'failed'], ['captured', 'verified']]);
    expect(out.manifest.status).toBe('completed');
    expect(out.manifestReceipt?.storageStatus).toBe('verified');
    expect(out.exitCode).toBe(1);
  });

  it('stops the batch when a keyword delivers nothing', async () => {
    const gateway = new FakeGateway();
    gateway.failOn = (op, key) => op === 'create' && key.includes('/q0001/');
    const url = await writeFixture({ query: 'q', cards: namedCards(3), endMarkerInitially: true });
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['q', 'q', 'q'], outputDirectory: root });
    const out = await runBatch({ config, store: remoteStore(gateway), searchUrlFor: () => url });
    expect(out.manifest.queries.map((q) => [q.status, q.stopReason])).toEqual([['captured', 'end_of_results'], ['skipped', 'storage_unavailable'], ['skipped', 'storage_unavailable']]);
    expect(out.exitCode).toBe(1);
  });
});

describe('runBatch layout breaker', () => {
  it('stops after three consecutive unsupported layouts', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(3) });
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['a', 'b', 'c', 'd', 'e'], outputDirectory: root });
    let calls = 0;
    const out = await runBatch({
      config, searchUrlFor: () => url,
      openSearchImpl: async () => { calls += 1; return { state: { kind: 'place_redirect' as const }, finalUrl: 'https://www.google.com/maps/place/X' }; },
    });
    expect(calls).toBe(3);
    expect(out.manifest.queries.map((q) => [q.status, q.stopReason])).toEqual([
      ['partial', 'unsupported_layout'], ['partial', 'unsupported_layout'], ['partial', 'unsupported_layout'],
      ['skipped', 'unsupported_layout'], ['skipped', 'unsupported_layout'],
    ]);
    expect(out.exitCode).toBe(2);
  });
});

describe('closeWithin', () => {
  it('returns closed for a normal close and timed_out for a hung one', async () => {
    expect(await closeWithin({ close: async () => undefined }, 1000)).toBe('closed');
    const started = Date.now();
    expect(await closeWithin({ close: () => new Promise<void>(() => undefined) }, 100)).toBe('timed_out');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('runBatch against Azurite', () => {
  let azurite: Awaited<ReturnType<typeof startAzurite>>;
  beforeAll(async () => {
    azurite = await startAzurite();
    await BlobServiceClient.fromConnectionString(azurite.connectionString).getContainerClient(DEFAULT_CONTAINER).createIfNotExists();
  });
  afterAll(async () => { await azurite.stop(); });

  it('uploads a whole batch through the real SDK and reads it back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mkc-azurite-'));
    const { store } = createStore('azure', dir, { AZURE_STORAGE_CONNECTION_STRING: azurite.connectionString });
    const url = await writeFixture({ query: 'azurite', cards: namedCards(4), endMarkerInitially: true });
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['azurite'], outputDirectory: dir });
    const out = await runBatch({ config, store, searchUrlFor: () => url });
    expect(out.exitCode).toBe(0);
    const container = BlobServiceClient.fromConnectionString(azurite.connectionString).getContainerClient(DEFAULT_CONTAINER);
    const names: string[] = [];
    for await (const blob of container.listBlobsFlat({ prefix: out.manifestReceipt!.objectKey!.replace(/manifest\.json$/, '') })) names.push(blob.name);
    expect(names.some((n) => n.endsWith('/manifest.json'))).toBe(true);
    expect(names.some((n) => n.endsWith('.png'))).toBe(true);
    expect(names.some((n) => n.endsWith('.csv'))).toBe(true);
    const remote = await container.getBlockBlobClient(out.manifestReceipt!.objectKey!).downloadToBuffer();
    expect(remote.equals(await readFile(out.manifestPath))).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});
