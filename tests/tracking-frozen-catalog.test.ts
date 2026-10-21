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
    if (surface === 'web') vi.spyOn(web, 'runWebScan').mockImplementation(async deps => { calls.push(deps); return { exitCode: 0 } as web.WebScanSummary; });
    else vi.spyOn(android, 'runAndroidScan').mockImplementation(async deps => { calls.push(deps); return { exitCode: 0 } as android.AndroidScanSummary; });
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
