import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSnapshot } from '../src/web/snapshot.js';

const config = JSON.parse(await readFile(new URL('../docs/tracking-config.example.json', import.meta.url), 'utf8'));
const png = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082','hex');
const hash = createHash('sha256').update(png).digest('hex');
const dirs: string[] = [];
async function fixture(extra: Record<string,unknown> = {}) {
 const dir = await mkdtemp(join(tmpdir(),'maps-snapshot-')); dirs.push(dir);
 const path = join(dir,'original.png'); await writeFile(path,png);
 const store = {...config.stores[0], active:true, createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z'};
 const observation = {observationId:'real-observation',surface:'web',storeId:store.storeId,placeId:store.placeId,keyword:'braised food',keywordKey:'braised food',keywordTier:null,pointId:'r0c0',point:{latitude:null,longitude:null,distanceKm:null,ring:null},locationMode:'query_only',observedAt:'2026-10-02T05:00:00Z',localDate:'2026-10-02',scanId:'real-scan',queryId:'q001',rank:{status:'ranked',displayPosition:4,organicRank:4,listingsObserved:10,listingStatus:'captured',stopReason:'limit'},topListings:[],evidence:{manifestKey:null,resultKey:null,screenshotKeys:['2026-10-02/run/shot.png']},source:{adapterVersion:'legacy',profileHash:null},ingestedAt:'2026-10-03T00:00:00Z'};
 const data = {version:1,timezone:'America/New_York',stores:[store],observations:[observation],evidence:[{key:'2026-10-02/run/shot.png',path,bytes:png.length,sha256:hash}],info:{label:'Historical archive',coverageNote:'Not a live run'},...extra};
 const file = join(dir,'snapshot.json'); await writeFile(file,JSON.stringify(data)); return {dir,path,file,data};
}
afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
describe('read-only historical snapshot',()=>{
 it('retains raw rank and unknown quality without upgrading legacy data',async()=>{
  const f=await fixture(); const loaded=await loadSnapshot(f.file);
  expect(loaded.repo.observations[0]?.rank.organicRank).toBe(4);
  expect(loaded.repo.observations[0]?.quality).toBeUndefined();
  expect(loaded.previewInfo).toMatchObject({label:'Historical archive'});
  expect(JSON.stringify(loaded.previewInfo)).not.toContain(f.dir);
  expect(loaded.config.timezone).toBe('America/New_York');
  await expect(loaded.repo.saveStore(f.data.stores[0])).rejects.toThrow(/read.only/i);
  await expect(loaded.repo.setActive(f.data.stores[0].storeId,false)).rejects.toThrow(/read.only/i);
 });
 it('serves only exactly indexed PNGs and verifies their receipt on read',async()=>{
  const f=await fixture(); const loaded=await loadSnapshot(f.file);
  expect(await loaded.evidence.get('2026-10-02/run/shot.png')).toEqual(png);
  await expect(loaded.evidence.get('../original.png')).rejects.toThrow();
  await writeFile(f.path,Buffer.concat([png,Buffer.from('changed')]));
  await expect(loaded.evidence.get('2026-10-02/run/shot.png')).rejects.toThrow(/receipt|checksum|size/i);
 });
 it('uses a provided read-only remote fallback only for indexed receipts',async()=>{
  const f=await fixture(); await rm(f.path); const keys:string[]=[];
  const loaded=await loadSnapshot(f.file,{remote:{get:async key=>{keys.push(key);return png;}}});
  expect(await loaded.evidence.get('2026-10-02/run/shot.png')).toEqual(png);
  await expect(loaded.evidence.get('2026-10-02/unindexed.png')).rejects.toThrow();
  expect(keys).toEqual(['2026-10-02/run/shot.png']);
  expect(await readFile(f.path)).toEqual(png);
 });
 it('rejects unknown version, duplicate IDs and cross-store evidence observations',async()=>{
  const f=await fixture({version:2}); await expect(loadSnapshot(f.file)).rejects.toThrow(/version/i);
  const good=await fixture(); good.data.observations.push(good.data.observations[0]!); await writeFile(good.file,JSON.stringify(good.data));
  await expect(loadSnapshot(good.file)).rejects.toThrow(/duplicate/i);
  good.data.observations=[{...good.data.observations[0]!,placeId:'ChIJwrong'}]; await writeFile(good.file,JSON.stringify(good.data));
  await expect(loadSnapshot(good.file)).rejects.toThrow(/identity|store/i);
 });
 it('fails closed for unindexed screenshot references and external URL keys',async()=>{
  const f=await fixture({evidence:[]}); await expect(loadSnapshot(f.file)).rejects.toThrow(/unindexed|evidence/i);
  const other=await fixture(); other.data.evidence[0]!.key='https://example.com/s.png'; await writeFile(other.file,JSON.stringify(other.data));
  await expect(loadSnapshot(other.file)).rejects.toThrow(/key|evidence/i);
 });
 it('keeps a missing store center explicit in a read-only archive',async()=>{
  const f=await fixture(); (f.data.stores[0] as any).center=null; await writeFile(f.file,JSON.stringify(f.data));
  const loaded=await loadSnapshot(f.file); expect((await loaded.repo.listStores())[0]?.center).toBeNull();
 });
 it('preserves captured target provenance without promoting the report baseline to live evidence',async()=>{
  const catalog=JSON.parse(await readFile(new URL('../deploy/tracking-targets/liya-90-v1.json',import.meta.url),'utf8'));
  const store=catalog.stores[0], target={catalog:store.monitoringCatalog,point:store.fixedPoints[0],target:store.keywordTargets[0].pointTargets[0]};
  const f=await fixture(); Object.assign(f.data.observations[0]!,{monitoringTarget:target}); await writeFile(f.file,JSON.stringify(f.data));
  const loaded=await loadSnapshot(f.file);
  expect(loaded.repo.observations[0]?.monitoringTarget).toEqual(target);
  expect(loaded.repo.observations[0]?.monitoringTarget?.catalog.source.sourceBaselineIsLive).toBe(false);
  expect(loaded.repo.observations[0]?.quality).toBeUndefined();
 });
});
