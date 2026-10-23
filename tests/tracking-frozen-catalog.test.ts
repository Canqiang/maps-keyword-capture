import * as gate from '../src/domain/scan-gate.js';
import { MongoRoundRepository, type RoundRecord } from '../src/domain/scan-round.js';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/domain/cli.js';
import * as web from '../src/domain/scan.js';
import * as android from '../src/domain/android-scan.js';
import { MongoTrackingRepository } from '../src/domain/repository.js';
import { MongoObservationStore, MemoryObservationStore } from '../src/domain/observation-store.js';
import { parseTrackingConfig, planScan, withStores } from '../src/domain/tracking-config.js';
import { parseTargetCatalog } from '../src/domain/target-catalog.js';
import { LocalArtifactStore } from '../src/storage/local.js';
const configPath = new URL('../deploy/tracking-targets/tracking.json', import.meta.url).pathname;
const catalogPath = new URL('../deploy/tracking-targets/liya-90-v1.json', import.meta.url).pathname;
const bytes = await readFile(catalogPath), sha256 = createHash('sha256').update(bytes).digest('hex');
const catalog = parseTargetCatalog(JSON.parse(bytes.toString('utf8')));
const base = parseTrackingConfig(JSON.parse(await readFile(configPath, 'utf8')));
const frozen = { version: catalog.version, sha256, bytes };
afterEach(() => vi.restoreAllMocks());

describe('pinned per-round catalog', () => {
  it.each(['web','android'] as const)('executes both %s shards from pinned bytes without a live Mongo catalog read', async surface => {
    const calls: Array<web.WebScanDeps | android.AndroidScanDeps> = [];
    if (surface === 'web') vi.spyOn(web, 'runWebScan').mockImplementation(async deps => { calls.push(deps); return { exitCode: 0, batches: { failed: 0 } } as web.WebScanSummary; });
    else vi.spyOn(android, 'runAndroidScan').mockImplementation(async deps => { calls.push(deps); return { exitCode: 0, batches: { failed: 0 } } as android.AndroidScanSummary; });
    const list = vi.spyOn(MongoTrackingRepository.prototype, 'listStores').mockRejectedValue(new Error('mutable catalog must not be read'));
    vi.spyOn(MongoObservationStore.prototype, 'close').mockResolvedValue();
    vi.spyOn(console,'log').mockImplementation(()=>{}); vi.spyOn(console,'error').mockImplementation(()=>{});
    const root=await mkdtemp(join(tmpdir(),'pinned-catalog-'));
    for (const index of [0,1]) expect(await main(['scan','--config',configPath,'--catalog',catalogPath,'--catalog-sha256',sha256,'--surface',surface,'--tier','point','--storage','local','--output-dir',root,'--shard-count','2','--shard-strategy','balanced','--shard-index',String(index)])).toBe(0);
    expect(list).not.toHaveBeenCalled(); expect(calls).toHaveLength(2);
    const planned=calls.flatMap(d=>planScan(d.config,{surface,tier:'point'}).queries);
    expect(planned).toHaveLength(270); expect(new Set(planned.map(q=>`${q.storeId}/${q.point.id}/${q.keyword}`)).size).toBe(270);
    for(const call of calls) {
      expect(call.catalogSnapshot?.sha256).toBe(sha256);
      expect(call.catalogSnapshot?.version).toBe(catalog.version);
      expect(call.catalogSnapshot?.bytes.equals(bytes)).toBe(true);
    }
  });
  it.each(['web', 'android'] as const)('freezes a live Mongo catalog across the actual %s CLI workers', async surface => {
    const calls: Array<web.WebScanDeps | android.AndroidScanDeps> = [];
    if (surface === 'web') vi.spyOn(web, 'runWebScan').mockImplementation(async deps => { calls.push(deps); return { exitCode: 0, batches: { failed: 0 } } as web.WebScanSummary; });
    else vi.spyOn(android, 'runAndroidScan').mockImplementation(async deps => { calls.push(deps); return { exitCode: 0, batches: { failed: 0 } } as android.AndroidScanSummary; });
    const leave = vi.fn(async () => {}); vi.spyOn(gate, 'enterScanGate').mockResolvedValue(leave);
    vi.spyOn(gate.MongoGateRepository.prototype, 'close').mockResolvedValue();
    vi.spyOn(MongoObservationStore.prototype, 'close').mockResolvedValue();
    vi.spyOn(MongoRoundRepository.prototype, 'close').mockResolvedValue();
    const records = new Map<string, RoundRecord>();
    vi.spyOn(MongoRoundRepository.prototype, 'claim').mockImplementation(async record => { if (records.has(record._id)) return false; records.set(record._id, record); return true; });
    vi.spyOn(MongoRoundRepository.prototype, 'get').mockImplementation(async id => records.get(id) ?? null);
    vi.spyOn(MongoRoundRepository.prototype, 'publish').mockImplementation(async (id, json, sha256) => { Object.assign(records.get(id)!, { state: 'ready', json, sha256 }); });
    const list = vi.spyOn(MongoTrackingRepository.prototype, 'listStores').mockResolvedValue(catalog.stores as never);
    vi.spyOn(MongoTrackingRepository.prototype, 'close').mockResolvedValue();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const root = await mkdtemp(join(tmpdir(), 'round-cli-'));
    const args = ['scan', '--config', configPath, '--surface', surface, '--tier', 'point', '--output-dir', root, '--shard-count', '2', '--shard-strategy', 'balanced', '--mongo-uri-env', 'TEST_MONGO'];
    for (const index of [0, 1]) {
      expect(await main([...args, '--shard-index', String(index)], { JOB_UID: 'job-uid', TRACKING_SCAN_GROUP: 'test-target', TEST_MONGO: 'mongodb://localhost:1' })).toBe(0);
      list.mockResolvedValue([]); // A concurrent settings edit must not change the second worker.
    }
    expect(list).toHaveBeenCalledTimes(1); expect(leave).toHaveBeenCalledTimes(2);
    const planned = calls.flatMap(d => planScan(d.config, { surface, tier: 'point' }).queries);
    expect(planned).toHaveLength(270); expect(new Set(planned.map(q => `${q.storeId}/${q.point.id}/${q.keyword}`)).size).toBe(270);
    expect(calls[0]!.catalogSnapshot!.sha256).toBe(calls[1]!.catalogSnapshot!.sha256);
    const artifact = new LocalArtifactStore(root);
    const receipt = await web.persistScanCatalog(calls[0]!.catalogSnapshot!, calls[0]!.config, artifact, 'test-round', { surface, tier: 'point' });
    expect(JSON.parse(await readFile(artifact.absolutePath(receipt.relativePath), 'utf8')).schemaVersion).toBe('tracking-scan-round/v1');
    for (const bad of [ { ...calls[0]!.config, timezone: 'UTC' }, { ...calls[0]!.config, stores: calls[0]!.config.stores.slice(1) } ]) {
      await expect(web.persistScanCatalog(calls[0]!.catalogSnapshot!, bad, artifact, 'bad', { surface, tier: 'point' })).rejects.toThrow('configuration or shard');
    }
    await expect(web.persistScanCatalog(calls[0]!.catalogSnapshot!, calls[0]!.config, artifact, 'bad', { surface: surface === 'web' ? 'android' : 'web', tier: 'point' })).rejects.toThrow('configuration or shard');
    const edited = structuredClone(calls[0]!.config); edited.stores[0]!.aliases.push('changed');
    await expect(web.persistScanCatalog(calls[0]!.catalogSnapshot!, edited, artifact, 'bad-round', { surface, tier: 'point' })).rejects.toThrow('do not match');
  });
  it.each(['missing','wrong','changed'] as const)('rejects %s catalog pin before dispatch', async mode=>{
    const dispatch=vi.spyOn(web,'runWebScan').mockResolvedValue({exitCode:0} as web.WebScanSummary);
    vi.spyOn(console,'log').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});
    const dir=await mkdtemp(join(tmpdir(),'catalog-pin-')),path=join(dir,'catalog.json');
    await writeFile(path,mode==='changed'?Buffer.concat([bytes,Buffer.from('\n')]):bytes);
    const pin=mode==='missing'?[]:['--catalog-sha256',mode==='wrong'?'0'.repeat(64):sha256];
    expect(await main(['scan','--config',configPath,'--catalog',path,...pin,'--surface','web','--tier','point','--output-dir',dir])).toBe(64);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it.each(['web','android'] as const)('retains exact catalog receipt in the %s terminal scan manifest before capture',async surface=>{
    const store=new LocalArtifactStore(await mkdtemp(join(tmpdir(),'catalog-receipt-')));
    const config=withStores(base,[catalog.stores[0]!]);
    let dispatched=0;
    const failAfterPreflight=async()=>{
      dispatched++;
      // The catalog must already be durable before any browser/device action.
      const {readdir}=await import('node:fs/promises');
      const scanRoot=join(store.rootDirectory,'tracking',surface);
      expect(await readdir(scanRoot)).not.toHaveLength(0);
      throw new Error('bounded injected capture failure');
    };
    const common={config,tier:'point' as const,store,observations:new MemoryObservationStore(),catalogSnapshot:frozen};
    const summary=surface==='web'?await web.runWebScan({...common,batchRunner:failAfterPreflight}):await android.runAndroidScan({...common,batchRunner:failAfterPreflight,deviceFactory:()=>({} as never)});
    expect(dispatched).toBeGreaterThan(0);
    expect(summary.catalogSnapshot).toMatchObject({version:catalog.version,sha256,bytes:bytes.length,storeIds:[catalog.stores[0]!.storeId],storageStatus:'local_only'});
    expect(await readFile(store.absolutePath(summary.catalogSnapshot!.relativePath))).toEqual(bytes);
    expect(JSON.parse(await readFile(store.absolutePath(`${summary.prefix}/scan.json`),'utf8')).catalogSnapshot).toEqual(summary.catalogSnapshot);
  });
  it.each(['web','android'] as const)('does not execute %s when catalog persistence fails',async surface=>{
    const store=new LocalArtifactStore(await mkdtemp(join(tmpdir(),'catalog-failed-')));
    vi.spyOn(store,'persist').mockResolvedValue({storageStatus:'failed',objectKey:null,verifiedAt:null,storageError:{code:'upload_failed',message:'unavailable'}});
    const runner=vi.fn(async()=>{throw new Error('must not dispatch');});
    const common={config:withStores(base,[catalog.stores[0]!]),tier:'point' as const,store,observations:new MemoryObservationStore(),catalogSnapshot:frozen};
    const summary=surface==='web'?await web.runWebScan({...common,batchRunner:runner}):await android.runAndroidScan({...common,batchRunner:runner,deviceFactory:()=>({} as never)});
    expect(runner).not.toHaveBeenCalled(); expect(summary.status).toBe('failed'); expect(summary.exitCode).toBe(1); expect(summary.queries.dispatched).toBe(0);expect(summary.queries.skipped).toBe(30);
  });
  it.each(['mutated_bytes','different_store'] as const)('rejects %s at the capture boundary too',async mode=>{
    const store=new LocalArtifactStore(await mkdtemp(join(tmpdir(),'catalog-boundary-')));
    const selected=structuredClone(catalog.stores[0]!);
    if(mode==='different_store')selected.aliases.push('different identity alias');
    const runner=vi.fn(async()=>{throw new Error('must not dispatch');});
    const summary=await web.runWebScan({config:withStores(base,[selected]),tier:'point',store,observations:new MemoryObservationStore(),catalogSnapshot:mode==='mutated_bytes'?{...frozen,bytes:Buffer.concat([bytes,Buffer.from('\n')])}:frozen,batchRunner:runner});
    expect(runner).not.toHaveBeenCalled();expect(summary.status).toBe('failed');expect(summary.queries.skipped).toBe(30);
  });
});

describe('CLI execution gate cleanup boundary', () => {
  it.each(['success', 'partial', 'failed', 'throw', 'timeout', 'close_failed', 'cancelled'] as const)('handles %s without releasing an uncertain runtime', async mode => {
    const leave = vi.fn(async () => {});
    vi.spyOn(gate, 'enterScanGate').mockResolvedValue(leave); vi.spyOn(gate.MongoGateRepository.prototype, 'close').mockResolvedValue();
    vi.spyOn(MongoObservationStore.prototype, 'close').mockResolvedValue();
    vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(web, 'runWebScan').mockImplementation(async deps => {
      if (mode === 'throw') throw new Error('runtime exception');
      if (mode === 'timeout') deps.log?.({ stage: 'browser_close_timeout' });
      if (mode === 'close_failed') deps.log?.({ stage: 'browser_close_failed' });
      if (mode === 'cancelled') process.emit('SIGTERM');
      return { exitCode: mode === 'failed' ? 1 : mode === 'partial' ? 2 : 0, batches: { failed: mode === 'failed' ? 1 : 0 } } as web.WebScanSummary;
    });
    const root = await mkdtemp(join(tmpdir(), 'gate-cli-'));
    const code = await main(['scan', '--config', configPath, '--catalog', catalogPath, '--catalog-sha256', sha256, '--surface', 'web', '--tier', 'point', '--output-dir', root, '--mongo-uri-env', 'TEST_MONGO'],
      { JOB_UID: 'job-test', TRACKING_SCAN_GROUP: 'test-group', TEST_MONGO: 'mongodb://localhost:1' });
    expect(code).toBe(['throw', 'failed', 'timeout', 'close_failed', 'cancelled'].includes(mode) ? 1 : mode === 'partial' ? 2 : 0);
    expect(leave).toHaveBeenCalledTimes(mode === 'success' || mode === 'partial' ? 1 : 0);
  });
  it('releases a pre-capture validation failure without invoking a collector', async () => {
    const leave = vi.fn(async () => {}); vi.spyOn(gate, 'enterScanGate').mockResolvedValue(leave); vi.spyOn(gate.MongoGateRepository.prototype, 'close').mockResolvedValue();
    const dispatch = vi.spyOn(web, 'runWebScan'); vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['scan', '--config', configPath, '--catalog', catalogPath, '--catalog-sha256', '0'.repeat(64), '--surface', 'web', '--tier', 'point', '--mongo-uri-env', 'TEST_MONGO'],
      { JOB_UID: 'job-test', TRACKING_SCAN_GROUP: 'test-group', TEST_MONGO: 'mongodb://localhost:1' })).toBe(64);
    expect(dispatch).not.toHaveBeenCalled(); expect(leave).toHaveBeenCalledTimes(1);
  });
});
