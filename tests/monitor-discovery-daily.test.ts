import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { BatchManifest } from '../src/contracts.js';
import { hashJson } from '../src/ids.js';
import { parseMonitorConfig, type EnrolledStore } from '../src/monitor/config.js';
import { runDailyMonitor } from '../src/monitor/daily.js';
import { parseKeywordResponse } from '../src/monitor/source.js';
import { createAtomicClaim } from '../src/monitor/storage.js';
import type { BatchDeps, BatchOutput } from '../src/runner/batch-runner.js';
import { LocalArtifactStore } from '../src/storage/local.js';
import { RemoteArtifactStore } from '../src/storage/remote.js';
import { FakeGateway } from './helpers/fake-gateway.js';

const legacy = { storeId: 'only-bear', merchantId: 'merchant-1', placeId: 'ChIJexisting', name: 'Historical label' };
const added = { storeId: 'place-new', merchantId: 'merchant-2', placeId: 'ChIJnew', name: 'New store' };
const discovery = { provider: 'mongo' as const, database: 'test', collection: 'local_keywords', maxStores: 20, maxRecords: 100, timeoutMs: 100 };
const roster = (stores: EnrolledStore[] = [{ ...legacy, name: 'Current label' }, added]) => ({
  schemaVersion: '1' as const, fetchedAt: '2026-09-23T16:00:01Z', sourceResponseHash: 'registry-source-hash', policy: 'test linked records',
  stores, exclusions: [{ sourceId: 'disabled-record', reason: 'disabled' }], counts: { fetched: stores.length + 1, eligible: stores.length, excluded: 1 },
});

async function setup() {
  const local = new LocalArtifactStore(await mkdtemp(join(tmpdir(), 'monitor-discovery-')));
  const gateway = new FakeGateway();
  const store = new RemoteArtifactStore({ gateway, local });
  // Add the future configuration after parsing to exercise the real monitor before the parser extension exists.
  const config = { ...parseMonitorConfig({ schemaVersion: '1', sourceBaseUrl: 'http://example.test', stores: [legacy], maxKeywordsPerStore: 2, batchSize: 2, sourceTimeoutMs: 100, outputDirectory: local.rootDirectory, capture: {} }), storeDiscovery: discovery };
  const registrySource = { read: vi.fn(async () => roster()) };
  const source = { read: vi.fn(async (s: EnrolledStore) => parseKeywordResponse({ place_id: s.placeId, local_keywords: [{ local_keyword_id: `record-${s.storeId}`, merchant_id: s.merchantId, place_id: s.placeId, keywords: [{ keyword: `${s.storeId} query`, priority: 'P1' }] }] }, s)) };
  let index = 0;
  // Browser execution is external to this integration. Keep real artifact writes, claims, receipts and checkpoints.
  const batchRunner = vi.fn(async (deps: BatchDeps): Promise<BatchOutput> => {
    const runId = `run${++index}`;
    const relativeRoot = `maps-keyword-capture/2026-09-24/${runId}/att`;
    const manifest = { schemaVersion: '1', runId, attemptId: 'att', status: 'completed', persistenceMode: deps.store!.mode, startedAt: '', finishedAt: '', metadata: {}, queries: deps.config.keywords.map((keyword, inputIndex) => ({ queryId: `q${inputIndex}`, inputIndex, keyword, status: 'captured', stopReason: 'end_of_results', persistenceStatus: 'verified', attempts: [], resultFile: null })), artifacts: [] } as unknown as BatchManifest;
    const written = await deps.store!.writeFile(`${relativeRoot}/manifest.json`, JSON.stringify(manifest));
    const receipt = await deps.store!.persist(written);
    return { manifest, attemptRoot: deps.store!.absolutePath(relativeRoot), manifestPath: deps.store!.absolutePath(`${relativeRoot}/manifest.json`), manifestReceipt: { ...receipt, runId, attemptId: 'att', filename: 'manifest.json', bytes: written.bytes, sha256: written.sha256 }, exitCode: 0 };
  });
  return { config, local, gateway, store, source, registrySource, batchRunner, claim: createAtomicClaim(gateway), now: () => new Date('2026-09-23T16:00:00Z') };
}

describe('daily discovered store registry', () => {
  it('claims and durably checkpoints the live roster before fresh keyword reads and browser capture', async () => {
    const deps = await setup();
    deps.registrySource.read.mockImplementation(async () => {
      expect(deps.gateway.objects.has('claims/2026-09-24.json')).toBe(true);
      return roster();
    });
    const sourceRead = deps.source.read.getMockImplementation()!;
    deps.source.read.mockImplementation(async s => {
      const keys = [...deps.gateway.objects.keys()];
      const rosterKey = keys.find(key => key.endsWith('/store-registry.json'));
      expect(rosterKey).toBeDefined();
      const checkpoints = keys.filter(key => key.includes('/checkpoints/')).map(key => JSON.parse(deps.gateway.objects.get(key)!.toString()));
      expect(checkpoints.some(checkpoint => checkpoint.registry?.snapshotReceipt?.objectKey === rosterKey && checkpoint.registry.status === 'ready')).toBe(true);
      return sourceRead(s);
    });
    const execute = deps.batchRunner.getMockImplementation()!;
    deps.batchRunner.mockImplementation(async batch => {
      expect([...deps.gateway.objects.keys()].filter(key => key.endsWith('/keyword-selection.json'))).toHaveLength(2);
      return execute(batch);
    });
    const out = await runDailyMonitor(deps);
    expect(out.exitCode).toBe(0);
    expect(out.manifest?.counts).toMatchObject({ stores: 2, selected: 2, captured: 2, batches: 2 });
    expect(out.manifest?.stores.map(s => [s.storeId, s.placeId, s.name])).toEqual([['only-bear', 'ChIJexisting', 'Current label'], ['place-new', 'ChIJnew', 'New store']]);
    expect(out.manifest?.registry).toMatchObject({ mode: 'discovered', status: 'ready', error: null, counts: { fetched: 3, eligible: 2, excluded: 1 }, snapshotReceipt: { storageStatus: 'verified' } });
    const snapshot = JSON.parse((await deps.gateway.get(out.manifest!.registry!.snapshotReceipt!.objectKey!)).toString());
    expect(snapshot).toMatchObject({ dailyRunId: out.manifest?.dailyRunId, runKey: '2026-09-24', date: '2026-09-24', sourceResponseHash: 'registry-source-hash', stores: [{ storeId: 'only-bear' }, { storeId: 'place-new' }] });
    const claim = JSON.parse((await deps.gateway.get('claims/2026-09-24.json')).toString());
    expect(claim.configHash).toBe(hashJson(deps.config));
    expect(out.manifest?.configHash).toBe(claim.configHash);
  });

  it('uses only the discovered roster, so stale aliases do not keep removed stores enrolled', async () => {
    const deps = await setup(); deps.registrySource.read.mockResolvedValue(roster([added]));
    const out = await runDailyMonitor(deps);
    expect(out.exitCode).toBe(0);
    expect(out.manifest?.stores.map(s => s.storeId)).toEqual(['place-new']);
    expect(out.manifest?.counts).toMatchObject({ stores: 1, captured: 1 });
    expect([...deps.gateway.objects.keys()].some(key => key.includes('/only-bear/'))).toBe(false);
  });

  it.each(['registry_timeout', 'registry_invalid_response', 'registry_capacity_exceeded', 'registry_identity_conflict'])('persists %s as a registry failure without stale fallback or browser dispatch', async reason => {
    const deps = await setup(); deps.registrySource.read.mockRejectedValue(new Error(reason));
    const out = await runDailyMonitor(deps);
    expect(out.exitCode).toBe(1);
    expect(out.manifest).toMatchObject({ status: 'failed', executionStatus: 'failed', stopReason: 'registry_failed', stores: [], registry: { status: 'failed', error: reason, snapshotReceipt: null, counts: null } });
    expect(out.manifestReceipt?.storageStatus).toBe('verified');
    expect(deps.source.read).not.toHaveBeenCalled(); expect(deps.batchRunner).not.toHaveBeenCalled();
    expect(JSON.parse((await deps.gateway.get(out.manifestReceipt!.objectKey!)).toString()).registry.error).toBe(reason);
  });

  it('sanitizes unknown discovery failures rather than persisting connection secrets', async () => {
    const deps = await setup(); deps.registrySource.read.mockRejectedValue(new Error('mongodb://user:secret@host database connection failed'));
    const out = await runDailyMonitor(deps);
    expect(out.exitCode).toBe(1);
    expect(out.manifest?.registry?.error).toBe('registry_request_failed');
    expect(JSON.stringify(out.manifest)).not.toContain('secret');
  });

  it('fails closed when discovery is configured without its source dependency', async () => {
    const { registrySource: _missing, ...deps } = await setup();
    const out = await runDailyMonitor(deps);
    expect(out.exitCode).toBe(1);
    expect(out.manifest?.registry).toMatchObject({ status: 'failed', error: 'registry_source_missing' });
    expect(deps.source.read).not.toHaveBeenCalled(); expect(deps.batchRunner).not.toHaveBeenCalled();
  });

  it('persists an empty roster as no eligible stores and never labels it completed', async () => {
    const deps = await setup(); deps.registrySource.read.mockResolvedValue(roster([]));
    const out = await runDailyMonitor(deps);
    expect(out.exitCode).toBe(2);
    expect(out.manifest).toMatchObject({ status: 'partial', executionStatus: 'incomplete', stopReason: 'no_eligible_stores', stores: [], counts: { stores: 0, selected: 0 }, registry: { status: 'empty', error: null, counts: { fetched: 1, eligible: 0, excluded: 1 }, snapshotReceipt: { storageStatus: 'verified' } } });
    expect(deps.source.read).not.toHaveBeenCalled(); expect(deps.batchRunner).not.toHaveBeenCalled();
  });

  it.each(['registry_snapshot', 'registry_checkpoint'])('stops before keyword reads when %s cannot be delivered', async failure => {
    const deps = await setup();
    deps.gateway.corruptGet = key => failure === 'registry_snapshot' ? key.endsWith('/store-registry.json') : key.endsWith('/checkpoints/0002.json');
    const out = await runDailyMonitor(deps);
    expect(out.exitCode).toBe(1);
    expect(out.manifest?.stopReason).toBe('storage_unavailable');
    expect(deps.source.read).not.toHaveBeenCalled(); expect(deps.batchRunner).not.toHaveBeenCalled();
  });

  it('records a terminal registry state when writing the registry snapshot itself throws', async () => {
    const deps = await setup(); const storage = deps.store;
    const failingStore = { mode: storage.mode, rootDirectory: storage.rootDirectory, absolutePath: storage.absolutePath.bind(storage), persist: storage.persist.bind(storage), writeFile: async (path: string, data: Buffer | string) => {
      if (path.endsWith('/store-registry.json')) throw new Error('disk full');
      return storage.writeFile(path, data);
    } };
    const out = await runDailyMonitor({ ...deps, store: failingStore });
    expect(out.exitCode).toBe(1);
    expect(out.manifest).toMatchObject({ stopReason: 'storage_unavailable', registry: { status: 'failed', error: 'storage_unavailable', snapshotReceipt: null } });
    expect(out.manifestReceipt?.storageStatus).toBe('verified');
    expect(deps.source.read).not.toHaveBeenCalled(); expect(deps.batchRunner).not.toHaveBeenCalled();
  });

  it('duplicate claims stop before discovery as well as keyword/browser work', async () => {
    const deps = await setup();
    await deps.claim({ schemaVersion: '1', runKey: '2026-09-24', date: '2026-09-24', dailyRunId: 'prior-run', startedAt: '2026-09-23T16:00:00Z', configHash: 'prior-config' });
    const out = await runDailyMonitor(deps);
    expect(out.status).toBe('duplicate_skipped'); expect(out.exitCode).toBe(0);
    expect(deps.registrySource.read).not.toHaveBeenCalled(); expect(deps.source.read).not.toHaveBeenCalled(); expect(deps.batchRunner).not.toHaveBeenCalled();
  });

  it('honors cancellation before discovery without touching the database', async () => {
    const deps = await setup(); const controller = new AbortController(); controller.abort();
    const out = await runDailyMonitor({ ...deps, signal: controller.signal });
    expect(out.exitCode).toBe(2); expect(out.manifest?.stopReason).toBe('cancelled');
    expect(out.manifest?.status).toBe('partial'); expect(out.manifest?.stores).toEqual([]);
    expect(deps.registrySource.read).not.toHaveBeenCalled(); expect(deps.source.read).not.toHaveBeenCalled();
  });

  it('does not turn cancellation during registry read into a storage or provider failure', async () => {
    const deps = await setup(); const controller = new AbortController();
    deps.registrySource.read.mockImplementation(async () => { controller.abort(); throw new Error('registry_cancelled'); });
    const out = await runDailyMonitor({ ...deps, signal: controller.signal });
    expect(out.exitCode).toBe(2); expect(out.manifest?.stopReason).toBe('cancelled');
    expect(out.manifest?.executionStatus).toBe('incomplete'); expect(deps.source.read).not.toHaveBeenCalled();
  });

  it('ignores an injected registry source in unchanged static configuration', async () => {
    const deps = await setup(); const { storeDiscovery: _discovery, ...staticConfig } = deps.config;
    const out = await runDailyMonitor({ ...deps, config: staticConfig });
    expect(out.exitCode).toBe(0); expect(out.manifest?.stores.map(s => s.storeId)).toEqual(['only-bear']);
    expect(deps.registrySource.read).not.toHaveBeenCalled(); expect(out.manifest?.registry).toBeUndefined();
  });
});
