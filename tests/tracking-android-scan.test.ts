import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAndroidScan } from '../src/domain/android-scan.js';
import { parseTrackingConfig } from '../src/domain/tracking-config.js';
import { MemoryObservationStore } from '../src/domain/observation-store.js';
import { LocalArtifactStore } from '../src/storage/local.js';
import type { AndroidCaptureConfig } from '../src/android/contracts.js';
import type { AndroidCaptureOutput } from '../src/android/runner.js';
import type { ArtifactStore } from '../src/storage/types.js';

const config = parseTrackingConfig({schemaVersion:'tracking-config/v1', stores:[{storeId:'s',name:'Store',placeId:'ChIJstore',aliases:['Store'],center:{latitude:40.7,longitude:-73.8},keywords:{core:['food'],longTail:Array.from({length:24},(_,i)=>`food ${i}`)}}], surfaces:{web:{point:{everyHours:2,keywords:'all'},grid:{enabled:false}},android:{point:{everyHours:2,keywords:'all'},grid:{enabled:false}}}, database:{provider:'mongo',database:'tracking'}});
function fakeRunner(options:{fatal?:boolean;unverified?:boolean;blocked?:boolean;cancel?:()=>void}={}) {
  let calls=0;
  const runner=async(c:AndroidCaptureConfig,_device:unknown,store:ArtifactStore):Promise<AndroidCaptureOutput>=>{
    calls++; const runId=`android_run_${calls}`, prefix=`android-maps/2026-10-21/${runId}`;
    const manifest={schemaVersion:'android-maps-manifest/v1',runId,prefix,surface:'google_maps_android_app',adapterVersion:'android-screen-ocr/v4',profileHash:'p',startedAt:'2026-10-21T00:00:00Z',finishedAt:'2026-10-21T00:01:00Z',persistenceMode:store.mode,executionStatus:'needs_review',device:null,rankingStatus:'evaluated',mapsLocationStatus:'unverified',
      queries:c.tasks.map((t,i)=>({...t,queryId:`q${i}`,rankingStatus:'not_evaluated',organicRank:null,displayPosition:null,targetMatches:[],listingQuality:null,listings:[],listingStatus:'partial',evidenceStatus:'needs_review',stopReason:'ranking_unreliable',screens:[],locationScreen:null,locationEvidence:null,error:null})),
      artifacts:[],errors:options.fatal?[{code:'device_lease_quarantined',message:'cleanup unconfirmed'}]:[],evidenceLimits:[],counts:{total:c.tasks.length,captured:0,needsReview:c.tasks.length,failed:0,skipped:0,screenshots:0,locationScreenshots:0,completeListingQueries:0,partialListingQueries:c.tasks.length,rankedQueries:0,listings:0,ads:0,organic:0,unknown:0}} as unknown as AndroidCaptureOutput['manifest'];
    if(options.blocked){manifest.queries[0]!.stopReason='screen_blocked';manifest.queries[0]!.evidenceStatus='failed';manifest.errors.push({code:'screen_blocked',message:'challenge'});manifest.counts.failed=1;}
    const written=await store.writeFile(`${prefix}/manifest.json`,JSON.stringify(manifest,null,2));
    const state=await store.persist(written);
    const receipt={...written,...state,...(options.unverified?{storageStatus:'failed' as const,storageError:{code:'artifact_delivery_failed',message:'failed'}}:{})};
    options.cancel?.();
    return {manifest,receipt,exitCode:2,cancelled:false};
  };
  return {runner,get calls(){return calls;}};
}
async function deps(){const root=await mkdtemp(join(tmpdir(),'android-scan-'));return {config,tier:'point' as const,store:new LocalArtifactStore(root),observations:new MemoryObservationStore(),env:{MAPS_ANDROID_SERIAL:'emulator-5554',MAPS_ANDROID_ADB_PATH:'/sdk/adb'},deviceFactory:()=>({} as never)};}
describe('scheduled Android scan',()=>{
  it('executes every bounded batch, ingests review evidence, and never calls it qualified',async()=>{
    const d=await deps(),fake=fakeRunner();const s=await runAndroidScan({...d,batchRunner:fake.runner});
    expect(fake.calls).toBe(2);expect(s).toMatchObject({exitCode:2,status:'partial',queries:{planned:25,dispatched:25,observed:25,ranked:0},observations:{inserted:25,notIngested:0}});
    expect(d.observations.documents.size).toBe(25);expect([...d.observations.documents.values()].every(o=>o.rank.organicRank===null)).toBe(true);
    expect(JSON.parse(await readFile(d.store.absolutePath(`${s.prefix}/scan.json`),'utf8')).batches.run).toBe(2);
  });
  it('stops on unsafe device cleanup instead of starting another session',async()=>{
    const d=await deps(),fake=fakeRunner({fatal:true});const s=await runAndroidScan({...d,batchRunner:fake.runner});
    expect(fake.calls).toBe(1);expect(s).toMatchObject({status:'failed',exitCode:1,queries:{dispatched:20,skipped:5}});
  });
  it('withholds ingestion and stops after an unverified manifest',async()=>{
    const d=await deps(),fake=fakeRunner({unverified:true});const s=await runAndroidScan({...d,batchRunner:fake.runner});
    expect(fake.calls).toBe(1);expect(d.observations.documents.size).toBe(0);expect(s).toMatchObject({status:'failed',observations:{notIngested:1},batches:{deliveryFailed:1}});
  });
  it('does not continue after cancellation',async()=>{
    const d=await deps(),controller=new AbortController(),fake=fakeRunner({cancel:()=>controller.abort()});
    const s=await runAndroidScan({...d,batchRunner:fake.runner,signal:controller.signal});expect(fake.calls).toBe(1);expect(s.status).toBe('cancelled');
  });
  it('reports blocked when the collector also records the challenge as an error',async()=>{
    const d=await deps(),fake=fakeRunner({blocked:true});const s=await runAndroidScan({...d,batchRunner:fake.runner});
    expect(fake.calls).toBe(1);expect(s).toMatchObject({status:'blocked',exitCode:1,queries:{skipped:5}});
  });
  it('keeps cancellation status when the runner throws after abort',async()=>{
    const d=await deps(),controller=new AbortController();
    const s=await runAndroidScan({...d,signal:controller.signal,batchRunner:async()=>{controller.abort();throw new Error('aborted');}});
    expect(s).toMatchObject({status:'cancelled',exitCode:1,queries:{skipped:5}});
  });
  it('retains evidence and marks failed database delivery without logging secrets',async()=>{
    const d=await deps(),fake=fakeRunner(),logs:unknown[]=[];
    const s=await runAndroidScan({...d,batchRunner:fake.runner,ingestRetryDelayMs:0,observations:{close:async()=>{},upsert:async()=>{throw new Error('mongodb://user:password@private');}},log:e=>logs.push(e)});
    expect(s).toMatchObject({status:'partial',observations:{notIngested:2}});expect(JSON.stringify(logs)).not.toContain('password');
  });
});
