import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { parseAndroidConfig } from '../src/android/config.js';
import { CommandJournal } from '../src/android/command-diagnostics.js';
import { runAndroidCapture, acquireDeviceLease } from '../src/android/runner.js';
import { LocalArtifactStore } from '../src/storage/local.js';
import { ingestAndroidManifest } from '../src/domain/ingest.js';
import { organicRankForMetrics } from '../src/domain/model.js';
import type { AndroidDevice } from '../src/android/contracts.js';
import type { ArtifactStore } from '../src/storage/types.js';
const roots: string[]=[];
const testLeases: Array<{directory:string;owner:string}>=[];
async function trackTestLease(serial:string){
 const directory=join(tmpdir(),`maps-keyword-capture-android-${createHash('sha256').update(serial).digest('hex').slice(0,32)}.lock`);
 try{const owner=await readFile(join(directory,'owner'),'utf8');expect(owner.startsWith(`${process.pid}:`)).toBe(true);testLeases.push({directory,owner});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
}
async function expectDeviceBusy(serial:string){
 let release:(()=>Promise<void>)|undefined;let busy=false;
 try{release=await acquireDeviceLease(serial);}catch(error){busy=error instanceof Error&&error.message==='device_busy';}finally{await release?.();}
 expect(busy).toBe(true);
}
afterEach(async()=>{vi.restoreAllMocks();for(const lease of testLeases.splice(0)){expect(await readFile(join(lease.directory,'owner'),'utf8')).toBe(lease.owner);await rm(lease.directory,{recursive:true});}await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
// SYNTHETIC 1x1 PNG, with valid chunk CRCs; not a device screenshot.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');
const homeXml='<hierarchy><node package="com.google.android.apps.maps" class="android.widget.EditText" resource-id="com.google.android.apps.maps:id/search_omnibox_text_box" text="" content-desc="Search here" enabled="true" bounds="[0,0][100,50]"/><node package="com.google.android.apps.maps" class="android.view.View" content-desc="Enter compass mode" enabled="true" bounds="[0,50][50,100]"/></hierarchy>';
const preparedLocation=(requested:Parameters<AndroidDevice['setLocation']>[0])=>({requested,injectionStatus:'sent' as const,deviceLocationStatus:'matched' as const,observed:{latitude:requested.latitude,longitude:requested.longitude,provider:'gps'},mapsLocationStatus:'unverified' as const,checkedAt:new Date().toISOString(),note:'synthetic fresh GPS and following viewport',preparation:{homeReadyAt:new Date().toISOString(),providerReadyAt:new Date().toISOString(),injectedAt:new Date().toISOString(),beforeElapsedMs:1000,observedElapsedMs:2000,readbackElapsedMs:2100,accuracyMeters:5,viewportStatus:'following' as const,viewportAction:'recenter_clicked' as const,viewportCheckedAt:new Date().toISOString()}});
const xml='<hierarchy><node package="com.google.android.apps.maps" class="android.widget.EditText" resource-id="com.google.android.apps.maps:id/search_omnibox_text_box" text="noodles" displayed="true" enabled="true" bounds="[0,0][100,50]"/><node package="com.google.android.apps.maps" class="android.widget.TextView" resource-id="com.google.android.apps.maps:id/unknown_test_view" text="Noodles shops" displayed="true" bounds="[0,50][100,150]"/></hierarchy>';
async function setup(extra:Partial<AndroidDevice>={}){
 const root=await mkdtemp(join(tmpdir(),'android-runner-test-'));roots.push(root);
 const config=parseAndroidConfig({schemaVersion:'android-maps-input/v1',serial:'emulator-5554',outputDirectory:root,tasks:[{storeId:'keke',storeName:'Keke',keyword:'noodles',sourceReference:'synthetic test',location:{id:'test',label:'test point',latitude:40.76,longitude:-73.83,source:'synthetic test'}}]});
 let closed=0,locationPending=false;
 const device:AndroidDevice={preflight:async()=>({serial:config.serial,androidVersion:'35',appVersion:'test',appPackage:'com.google.android.apps.maps',locale:'en-US',timezone:config.timezone,emulator:true}),start:async()=>{},swipeResults:async()=>{},close:async()=>{closed++;},...extra,
 setLocation:async requested=>{locationPending=true;return extra.setLocation?extra.setLocation(requested):preparedLocation(requested);},
 search:async keyword=>{locationPending=false;await extra.search?.(keyword);},
 snapshot:async()=>locationPending?{png,xml:homeXml,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()}:extra.snapshot?extra.snapshot():{png,xml,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()}};
 return {root,config,device,closed:()=>closed};
}

// A valid 1x1 grayscale PNG whose pixel value is the seed, so screenshots differ without breaking PNG checks.
const pngWith=(seed:number,width=1,height=1)=>{const chunk=(type:string,data:Buffer)=>{const body=Buffer.concat([Buffer.from(type,'ascii'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(zlib.crc32(body)>>>0);const len=Buffer.alloc(4);len.writeUInt32BE(data.length);return Buffer.concat([len,body,crc]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=0;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;
 const pixels=Buffer.alloc(height*(width+1));pixels[1]=seed&255;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);};
// Synthetic full-screen OCR: every screen shows the sheet header plus one card per name.
const shaOf=(buffer:Buffer)=>createHash('sha256').update(buffer).digest('hex');
const ocrLine=(text:string,top:number)=>({text,confidence:90,bounds:{left:40,top,right:600,bottom:top+30}});
const cardScreen=(...names:string[])=>(png:Buffer)=>({schemaVersion:'android-screen-ocr/v1' as const,imageSha256:shaOf(png),imageWidth:1,imageHeight:1,engine:'test',engineVersion:'synthetic',languages:'eng',scale:2,
 lines:[ocrLine('noodles x',200),ocrLine('Relevance Open now Price',240),...names.flatMap((name,i)=>[ocrLine(name.replace(/^AD:/,''),300+i*300),ocrLine(name.startsWith('AD:')?'4.5% (12) - Chinese':`4.6% (${20+[...name].reduce((sum,c)=>sum+c.charCodeAt(0),0)%997}) - $10-20 - Chinese`,340+i*300),ocrLine('Closed . Opens 9:30 AM - 0.2 mi',380+i*300)].concat(name.startsWith('AD:')?[ocrLine('Sponsored',270+i*300)]:[]))]});
const emptyScreen=()=>(png:Buffer)=>({schemaVersion:'android-screen-ocr/v1' as const,imageSha256:shaOf(png),imageWidth:1,imageHeight:1,engine:'test',engineVersion:'synthetic',languages:'eng',scale:2,lines:[ocrLine('noodles x',200),ocrLine('Discover through photos',400)]});
/** Returns the screens in order; the last screen repeats for any further shot. */
const recognizerFor=(screens:Array<(png:Buffer)=>any>)=>{let i=0;return async(request:{png:Buffer})=>screens[Math.min(i++,screens.length-1)]!(request.png);};

describe('native screenshot evidence runner',()=>{
 it('keeps cancellation authoritative if it arrives while an ANR screenshot is persisted',async()=>{
  const source=await readFile(new URL('./fixtures/android/maps-anr-20261024/dialog.xml',import.meta.url),'utf8');const controller=new AbortController();
  const s=await setup({snapshot:async()=>({png,xml:source,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()})});const local=new LocalArtifactStore(s.root);
  const store:ArtifactStore={mode:'local_only',rootDirectory:s.root,absolutePath:p=>local.absolutePath(p),writeFile:(p,b)=>local.writeFile(p,b),persist:async(f,o)=>{const r=await local.persist(f,o);if(f.relativePath.endsWith('__01.xml'))controller.abort();return r;}};
  const r=await runAndroidCapture(s.config,s.device,store,{signal:controller.signal});expect(r.manifest.queries[0]?.stopReason).toBe('cancelled');expect(r.manifest.queries[0]?.organicRank).toBeNull();
 });

 it('never sends an ANR capture frame to OCR and preserves it as diagnostic evidence',async()=>{
  const source=await readFile(new URL('./fixtures/android/maps-anr-20261024/dialog.xml',import.meta.url),'utf8');let ocr=0;
  const s=await setup({snapshot:async()=>({png,xml:source,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()})});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:async()=>{ocr++;throw Error('unexpected');}});
  expect(ocr).toBe(0);expect(r.manifest.queries[0]?.stopReason).toBe('app_not_responding');expect(r.manifest.queries[0]?.screens[0]?.role).toBe('diagnostic');
 });
 it('persists the original ANR screen and system diagnostics before cleanup without retrying search',async()=>{
  const anrXml=await readFile(new URL('./fixtures/android/maps-anr-20261024/dialog.xml',import.meta.url),'utf8');let searches=0,ocr=0;const events:string[]=[];
  const report={schemaVersion:'android-app-diagnostics/v1',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),commands:[]};
  const s=await setup({search:async()=>{searches++;throw {code:'UNKNOWN_SEARCH_LAYOUT'};},snapshot:async()=>({png,xml:anrXml,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()}),close:async()=>{events.push('close');},...({appDiagnostics:async()=>{events.push('diagnostics');return report;}} as any)});
  const local=new LocalArtifactStore(s.root);const r=await runAndroidCapture(s.config,s.device,local,{screenRecognizer:async()=>{ocr++;throw Error('must not OCR modal');}});const q=r.manifest.queries[0]!;
  expect(q.stopReason).toBe('app_not_responding');expect(q.screens[0]?.analysis.kind).toBe('app_not_responding');expect(q.organicRank).toBeNull();expect(searches).toBe(1);expect(ocr).toBe(0);expect(events).toEqual(['diagnostics','close']);
  const a=r.manifest.artifacts.find(a=>(a.kind as string)==='app_diagnostics');expect(a).toBeDefined();expect(JSON.parse(await readFile(local.absolutePath(a!.relativePath),'utf8'))).toEqual(report);
 });

 it('saves OCR failure diagnostics beside the immutable screenshot and fails closed on log storage failure',async()=>{
  for(const storageFailure of [false,true]){
   let searches=0;const s=await setup({search:async()=>{searches++}});const local=new LocalArtifactStore(s.root);
   const store:ArtifactStore={mode:'local_only',rootDirectory:s.root,absolutePath:p=>local.absolutePath(p),writeFile:async(p,b)=>{if(storageFailure&&p.endsWith('.ocr-process.json'))throw Error('storage failure');return local.writeFile(p,b);},persist:(f,o)=>local.persist(f,o)};
   const r=await runAndroidCapture(s.config,s.device,store,{screenRecognizer:async request=>{
    await request.onDiagnostics?.({schemaVersion:'android-ocr-process/v1',imageSha256:shaOf(request.png),startedAt:new Date().toISOString(),durationMs:30,timeoutMs:30,threadLimit:1,outcome:'failed',failureReason:'timeout',exitCode:null,signal:'SIGKILL',timedOut:true,cancelled:false,stderrBytes:0,stderrSha256:shaOf(Buffer.alloc(0)),stages:[],lastStage:'full_screen'});
    throw Error('private OCR error');
   }});
   const q=r.manifest.queries[0]!;expect(searches).toBe(1);expect(q.screens[0]?.png).toBeDefined();expect(q.listingStatus).not.toBe('complete');expect(r.exitCode).toBe(2);
   const log=r.manifest.artifacts.find(a=>a.kind==='ocr_process_log');expect(log).toBeDefined();
   if(!storageFailure){expect(q.screens[0]?.ocrProcess?.relativePath).toBe(log?.relativePath);expect(JSON.parse(await readFile(local.absolutePath(log!.relativePath),'utf8')).timedOut).toBe(true);}
   else expect(log?.storageStatus).toBe('failed');
   expect(JSON.stringify(r)).not.toContain('private OCR error');
  }
 });
 it('never starts a second query after the first final command checkpoint fails',async()=>{
  const journal=new CommandJournal();let locations=0;
  const s=await setup({commandDiagnostics:()=>journal.snapshot(),setLocation:async requested=>{locations++;return preparedLocation(requested);}});
  s.config.tasks.push({...s.config.tasks[0]!,keyword:'second'});
  const local=new LocalArtifactStore(s.root);
  const store:ArtifactStore={mode:'local_only',rootDirectory:s.root,absolutePath:p=>local.absolutePath(p),writeFile:async(p,b)=>{if(p.endsWith('-query-final.json'))throw new Error('test persistence failure');return local.writeFile(p,b);},persist:(f,o)=>local.persist(f,o)};
  const r=await runAndroidCapture(s.config,s.device,store,{screenRecognizer:recognizerFor([emptyScreen()])});
  expect(locations).toBe(1);expect(r.manifest.queries[1]!.evidenceStatus).toBe('skipped');expect(r.exitCode).toBe(2);
 });
 it('preserves the primary error when command-log storage fails',async()=>{
  const journal=new CommandJournal();
  const s=await setup({commandDiagnostics:()=>journal.snapshot(),search:async()=>{throw Object.assign(new Error('private'),{code:'APPIUM_PROTOCOL_ERROR'});}});
  const local=new LocalArtifactStore(s.root);
  const store:ArtifactStore={...local,mode:'local_only',rootDirectory:s.root,absolutePath:p=>local.absolutePath(p),writeFile:async(p,b)=>{if(p.endsWith('-query-final.json'))throw new Error('private storage');return local.writeFile(p,b);},persist:(f,o)=>local.persist(f,o)};
  const r=await runAndroidCapture(s.config,s.device,store);
  expect(r.manifest.queries[0]!.stopReason).toBe('appium_protocol_error');
  expect(r.manifest.errors.some(e=>e.code==='storage_unverified')).toBe(true);expect(r.exitCode).toBe(2);
  expect(JSON.stringify(r)).not.toContain('private');
 });
 it('persists failure and cleanup command checkpoints even when search throws',async()=>{
  const journal=new CommandJournal();
  const s=await setup({commandDiagnostics:()=>journal.snapshot(),search:async()=>{
   journal.record({stage:'search.submit',command:'mobile:performEditorAction',outcome:'failed',httpStatus:500,w3cError:'unknown error',durationMs:10});
   throw Object.assign(new Error('private server details'),{code:'APPIUM_PROTOCOL_ERROR'});
  },close:async()=>{journal.record({stage:'close',command:'DELETE session',outcome:'ok',durationMs:1});}});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));
  const logs=r.manifest.artifacts.filter(a=>a.kind==='command_log');expect(logs.length).toBeGreaterThanOrEqual(2);
  const queryLog=logs.find(a=>a.relativePath.endsWith('-query-final.json'))!;
  const q=JSON.parse(await readFile(join(s.root,queryLog.relativePath),'utf8'));
  expect(q.failures[0]).toMatchObject({command:'mobile:performEditorAction',httpStatus:500});
  const final=JSON.parse(await readFile(join(s.root,logs.at(-1)!.relativePath),'utf8'));
  expect(final.recent.at(-1)).toMatchObject({stage:'close',outcome:'ok'});
  expect(r.manifest.queries[0]!.stopReason).toBe('appium_protocol_error');
  expect(JSON.stringify(r)).not.toContain('private server details');
 });

 it('persists source images and UI trees with independently verifiable receipts and no invented ranks',async()=>{
  const s=await setup();const result=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([emptyScreen()])});
  expect(s.closed()).toBe(1);expect(result.manifest.queries[0]?.rankingStatus).toBe('not_evaluated');expect(result.manifest.queries[0]?.organicRank).toBeNull();
  expect(result.manifest.queries[0]?.evidenceStatus).toBe('needs_review');expect(result.manifest.queries[0]?.stopReason).toBe('no_cards_recognized');expect(result.exitCode).toBe(2);
  for(const a of result.manifest.artifacts){const b=await readFile(join(s.root,a.relativePath));expect(b.length).toBe(a.bytes);expect(createHash('sha256').update(b).digest('hex')).toBe(a.sha256);}
  const shot=result.manifest.queries[0]!.screens[0]!;expect(shot.width).toBe(1);expect(shot.height).toBe(1);
  expect((await readFile(join(s.root,shot.png.relativePath))).equals(png)).toBe(true);
 });
 it('refuses another foreground package and marks remaining work skipped',async()=>{
  const s=await setup({snapshot:async()=>({png,xml,packageName:'com.android.chrome',capturedAt:new Date().toISOString()})});s.config.tasks.push({...s.config.tasks[0]!,keyword:'tea'});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));expect(r.exitCode).toBe(2);expect(r.manifest.counts.failed).toBe(1);expect(r.manifest.counts.skipped).toBe(1);expect(r.manifest.queries[0]?.screens.length).toBe(0);
 });
 it('never searches after injected GPS mismatch',async()=>{
  let searched=false;const s=await setup({setLocation:async requested=>({requested,injectionStatus:'sent',deviceLocationStatus:'mismatch',observed:{latitude:0,longitude:0,provider:'gps'},mapsLocationStatus:'unverified',checkedAt:new Date().toISOString(),note:'test mismatch'}),search:async()=>{searched=true;}});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));expect(searched).toBe(false);expect(r.exitCode).toBe(2);
 });
 it('does not continue or report success after failed Azure persistence',async()=>{
  const s=await setup();const local=new LocalArtifactStore(s.root);let started=false;s.device.start=async()=>{started=true;};
  const store:ArtifactStore={mode:'azure_blob',rootDirectory:s.root,absolutePath:p=>local.absolutePath(p),writeFile:(p,b)=>local.writeFile(p,b),persist:async()=>({storageStatus:'failed',objectKey:null,verifiedAt:null,storageError:{code:'test_failure',message:'unavailable'}})};
  const r=await runAndroidCapture(s.config,s.device,store);expect(r.exitCode).toBe(2);expect(r.manifest.executionStatus).toBe('failed');expect(started).toBe(false);expect(r.receipt.storageStatus).toBe('failed');
 });
 it.each(['UNKNOWN_SCROLL_LAYOUT','ADB_COMMAND_FAILED','COMMAND_TIMEOUT'])('retains the safe native swipe failure code %s',async code=>{
  const s=await setup({swipeResults:async()=>{throw Object.assign(new Error('private native diagnostic'),{code});}});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([cardScreen('One'),cardScreen('Two')])});
  expect(r.manifest.queries[0]?.stopReason).toBe(code.toLowerCase());expect(r.exitCode).toBe(2);expect(JSON.stringify(r)).not.toContain('private native diagnostic');
  expect(r.manifest.queries[0]?.listings).toHaveLength(1);expect(r.manifest.queries[0]?.rankingStatus).toBe('not_evaluated');
 });
 it('retains diagnostics for search failure but never calls it ranked capture',async()=>{
  const s=await setup({search:async()=>{throw new Error('search_field_not_found');}});const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));expect(r.manifest.queries[0]?.evidenceStatus).toBe('failed');expect(r.manifest.queries[0]?.screens[0]?.role).toBe('diagnostic');expect(r.exitCode).toBe(2);
 });
 it('rejects malformed PNG instead of writing screenshot success',async()=>{
  const s=await setup({snapshot:async()=>({png:Buffer.from('fake'),xml,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()})});const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));expect(r.exitCode).toBe(2);expect(r.manifest.queries[0]?.screens.length).toBe(0);
 });
 it('leases an emulator across output directories and releases it',async()=>{
  const key=`emulator-test-${process.pid}`;const release=await acquireDeviceLease(key);await expect(acquireDeviceLease(key)).rejects.toThrow('device_busy');await release();const next=await acquireDeviceLease(key);await next();
 });
});

const fixtureXml=async(name:string,keyword='noodles')=>{
 const source=(await readFile(new URL(`./fixtures/android/${name}.xml`,import.meta.url),'utf8')).replaceAll('seafood buffet',keyword);
 // These isolated OCR/control-flow tests supply arbitrary synthetic merchants.
 // Do not pair them with the fixture's unrelated SEE JOY advertisement. The
 // contradictory native-ad pair has a dedicated fail-closed regression below.
 return name==='results-en'?source.replace('text="Sponsored"','text="Synthetic control"'):source;
};

describe('v2 location preparation gates',()=>{
 it.each(['unverified','mismatch'] as const)('stops before search when GPS is %s',async status=>{
  let searches=0;const s=await setup({setLocation:async requested=>({...preparedLocation(requested),deviceLocationStatus:status}),search:async()=>{searches++;}});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));
  expect(searches).toBe(0);expect(r.exitCode).toBe(2);expect(r.manifest.queries[0]?.screens).toHaveLength(0);
 });
 it.each(['missing','unverified'] as const)('stops before search when viewport preparation is %s',async state=>{
  let searches=0;const s=await setup({setLocation:async requested=>{const result=preparedLocation(requested);return {...result,preparation:state==='missing'?undefined:{...result.preparation,viewportStatus:'unverified' as const}};},search:async()=>{searches++;}});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));
  expect(searches).toBe(0);expect(r.exitCode).toBe(2);expect(r.manifest.queries[0]?.screens).toHaveLength(0);
 });
 it('persists a separate location screen before searching and counts only result screens toward the query budget',async()=>{
  const calls:string[]=[];const resultXml=await fixtureXml('no-results-en');const s=await setup({snapshot:async()=>({png,xml:resultXml,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()})});
  for(const method of ['setLocation','snapshot','search'] as const){const original=s.device[method].bind(s.device);(s.device as unknown as Record<string,unknown>)[method]=async(...args:unknown[])=>{calls.push(method);return (original as (...args:unknown[])=>unknown)(...args);};}
  s.config.maxScreenshotsPerQuery=1;
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([emptyScreen()])});const q=r.manifest.queries[0]!;
  expect(calls).toEqual(['setLocation','snapshot','search','snapshot']);expect(r.exitCode).toBe(0);
  expect(r.manifest.adapterVersion).toBe('android-screen-ocr/v4');expect(q.locationScreen?.role).toBe('location');expect(q.screens).toHaveLength(1);
  expect(r.manifest.counts).toMatchObject({screenshots:1,locationScreenshots:1});expect(q.locationScreen?.png.relativePath).toMatch(/__location\.png$/);
  expect(q.locationScreen?.png.relativePath).not.toBe(q.screens[0]?.png.relativePath);
  const csv=await readFile(join(s.root,r.manifest.artifacts.find(a=>a.kind==='csv')!.relativePath),'utf8');expect(csv).toContain('viewportStatus');expect(csv).toContain('locationPng');expect(csv).toContain('following');
 });
 it('fails closed before search if the location PNG cannot be verified in storage',async()=>{
  let searches=0;const s=await setup({search:async()=>{searches++;}});const local=new LocalArtifactStore(s.root);
  const store:ArtifactStore={mode:'azure_blob',rootDirectory:s.root,absolutePath:p=>local.absolutePath(p),writeFile:(p,b)=>local.writeFile(p,b),persist:async f=>f.relativePath.endsWith('__location.png')?{storageStatus:'uploaded',objectKey:f.relativePath,verifiedAt:null,storageError:null}:{storageStatus:'verified',objectKey:f.relativePath,verifiedAt:new Date().toISOString(),storageError:null}};
  const r=await runAndroidCapture(s.config,s.device,store);expect(searches).toBe(0);expect(r.exitCode).toBe(2);expect(r.manifest.counts.screenshots).toBe(0);expect(r.manifest.queries[0]?.error?.code).toBe('storage_unverified');
 });
 it('accepts the actual dynamic native hint again at location screenshot time',async()=>{
  const source=await readFile(new URL('./fixtures/android/home-dynamic-hint.xml',import.meta.url),'utf8');
  let searches=0,shots=0;const s=await setup({search:async()=>{searches++;}});
  s.device.snapshot=async()=>({png,xml:shots++===0?source:xml,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));
  expect(searches).toBe(1);expect(r.manifest.queries[0]?.stopReason).not.toBe('location_screen_unverified');expect(r.manifest.queries[0]?.screens).toHaveLength(1);
 });
 it('accepts actual compass-follow location evidence before a single search',async()=>{
  const source=await readFile(new URL('./fixtures/android/home-compass-20261024/home.xml',import.meta.url),'utf8');
  let searches=0,shots=0;const s=await setup({search:async()=>{searches++;}});
  s.device.snapshot=async()=>({png,xml:shots++===0?source:xml,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));expect(searches).toBe(1);expect(r.manifest.queries[0]?.stopReason).not.toBe('location_screen_unverified');
 });
 it('rejects ambiguous compass controls at location screenshot time',async()=>{
  const source=homeXml.replace('</hierarchy>','<node package="com.google.android.apps.maps" content-desc="Exit compass mode" bounds="[50,50][100,100]"/></hierarchy>');
  let searches=0;const s=await setup({search:async()=>{searches++;}});s.device.snapshot=async()=>({png,xml:source,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));expect(searches).toBe(0);expect(r.manifest.queries[0]?.stopReason).toBe('location_screen_unverified');
 });
 it.each(['entered','not-following','no-native-hint'])('rejects a changed dynamic home screen: %s',async variant=>{
  const original=await readFile(new URL('./fixtures/android/home-dynamic-hint.xml',import.meta.url),'utf8');
  const source=variant==='entered'?original.replace('text="" content-desc="Try gas stations, ATMs"','text="hot pot" content-desc="Try gas stations, ATMs"'):variant==='not-following'?original.replaceAll('Enter compass mode','Your location'):original.replaceAll('showing-hint="true"','showing-hint="false"');
  expect(source).not.toBe(original);let searches=0;const s=await setup({search:async()=>{searches++;}});
  s.device.snapshot=async()=>({png,xml:source,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));expect(searches).toBe(0);expect(r.manifest.queries[0]?.stopReason).toBe('location_screen_unverified');
 });
 it.each([xml,homeXml.replace('Enter compass mode','Your location'),homeXml.replace('Search here','old query')])('rejects stale/nonfollowing location XML before search',async source=>{
  let searches=0;const s=await setup({search:async()=>{searches++;}});s.device.snapshot=async()=>({png,xml:source,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));expect(searches).toBe(0);expect(r.exitCode).toBe(2);expect(r.manifest.queries[0]?.screens).toHaveLength(0);expect(r.manifest.queries[0]?.locationScreen).not.toBeNull();
 });
});


describe('v4 full-screen OCR listing evidence',()=>{
 const resultsSnapshot=async()=>{const source=await fixtureXml('results-en');let shots=0;return {snapshot:async()=>({png:pngWith(shots++),xml:source,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()})};};
 it('merges swiped frames into ranked listings, finds the target by alias and completes at list end',async()=>{
  let swipes=0;const s=await setup({...await resultsSnapshot(),swipeResults:async()=>{swipes++;}});
  s.config.tasks[0]!.aliases=['Keke Braised Deli'];
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([cardScreen('Crown One'),cardScreen('Crown One','KEKE BRAISED DELI'),cardScreen('KEKE BRAISED DELI','Er Hou Roast Chicken'),cardScreen('Er Hou Roast Chicken'),(image:Buffer)=>({...cardScreen('Er Hou Roast Chicken')(image),lines:[...cardScreen('Er Hou Roast Chicken')(image).lines,ocrLine("You've reached the end of the list",500)]})])});
  const q=r.manifest.queries[0]!;
  expect(r.exitCode).toBe(0);expect(swipes).toBe(4);expect(q.screens).toHaveLength(5);
  expect(q.listings.map(x=>[x.displayPosition,x.organicRank,x.name])).toEqual([[1,1,'Crown One'],[2,2,'KEKE BRAISED DELI'],[3,3,'Er Hou Roast Chicken']]);
  expect(q).toMatchObject({listingStatus:'complete',stopReason:'list_end',rankingStatus:'ranked',displayPosition:2,organicRank:2,evidenceStatus:'captured'});
  expect(q.targetMatch).toEqual({displayPosition:2,organicRank:2,name:'KEKE BRAISED DELI',alias:'Keke Braised Deli'});
  expect(q.screens[0]?.ocr?.kind).toBe('ocr_json');expect(q.screens[0]?.screenFrame?.kind).toBe('screen_frame');expect(q.screens[1]?.cardsRecognized).toBe(2);
  expect(r.manifest.adapterVersion).toBe('android-screen-ocr/v4');expect(r.manifest.counts).toMatchObject({rankedQueries:1,completeListingQueries:1,listings:3,organic:3});
  const csv=await readFile(join(s.root,r.manifest.artifacts.find(x=>x.relativePath.endsWith('/listings.csv'))!.relativePath),'utf8');
  expect(csv).toContain('isTarget');expect(csv).toContain('"KEKE BRAISED DELI"');expect(csv).toContain('"0.2 mi"');
  const queries=await readFile(join(s.root,r.manifest.artifacts.find(x=>x.relativePath.endsWith('/queries.csv'))!.relativePath),'utf8');expect(queries).toContain('ranked');
  for(const a of r.manifest.artifacts){const b=await readFile(join(s.root,a.relativePath));expect(b.length).toBe(a.bytes);expect(createHash('sha256').update(b).digest('hex')).toBe(a.sha256);}
  const observations = ingestAndroidManifest({manifest:r.manifest,placeIds:new Map([['keke','ChIJFixture']])},{timezone:'America/New_York'});
  expect(observations[0]?.quality).toMatchObject({rankingReliable:true,sequenceVerified:true,classificationComplete:true,screenshotCoverageComplete:true,organicCoverage:3,endOfResults:true});
  expect(observations[0]?.rank).toMatchObject({status:'ranked',organicRank:2});
  expect(organicRankForMetrics(observations[0]!)).toBe(2);
 });
 it('carries independent ad and organic target occurrences from OCR through ingest',async()=>{
  const s=await setup(await resultsSnapshot());s.config.tasks[0]!.aliases=['Keke'];s.config.maxDisplayedResults=2;
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([cardScreen('AD:Keke','Keke')])});
  expect(r.manifest.queries[0]).toMatchObject({organicRank:1,displayPosition:2,rankingStatus:'ranked'});
  expect(r.manifest.queries[0]?.targetMatches).toHaveLength(2);
  const observations=ingestAndroidManifest({manifest:r.manifest,placeIds:new Map([['keke','ChIJFixture']])},{timezone:'America/New_York'});
  expect(observations[0]?.rank).toMatchObject({status:'ranked',organicRank:1,adDisplayPositions:[1]});
  expect(observations[0]?.rank.targetOccurrences).toEqual([{displayPosition:1,organicRank:null,resultType:'ad'},{displayPosition:2,organicRank:1,resultType:'organic'}]);
  expect(organicRankForMetrics(observations[0]!)).toBe(1);
 });
 it.each(['single_frame','overlap_frame','ad_prefix'])('does not claim list end when %s crosses the retained display cap',async(mode)=>{
  const s=await setup(await resultsSnapshot());s.config.maxDisplayedResults=2;
  const names=mode==='ad_prefix'?['AD:Other one','Other two','Keke']:['Other one','Other two','Keke'];
  const terminal=(image:Buffer)=>({...cardScreen(...names)(image),lines:[...cardScreen(...names)(image).lines,ocrLine("You've reached the end of the list",1200)]});
  const frames=mode==='overlap_frame'?[cardScreen('Other one'),terminal]:[terminal];
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor(frames)});
  const q=r.manifest.queries[0]!;
  expect(q.listings).toHaveLength(2);
  expect(q.listingQuality).toMatchObject({endOfResults:false,truncatedCount:1});
  expect(q.stopReason).toBe('target_reached');
  expect(q.screens.at(-1)?.cardsRecognized).toBe(3);
  const savedFrame=JSON.parse(await readFile(join(s.root,q.screens.at(-1)!.screenFrame!.relativePath),'utf8'));
  expect(savedFrame.cards.map((row:{name:string})=>row.name)).toContain('Keke');
  const observation=ingestAndroidManifest({manifest:r.manifest,placeIds:new Map([['keke','ChIJFixture']])},{timezone:'America/New_York'})[0]!;
  expect(observation.quality?.organicCoverage).toBe(mode==='ad_prefix'?1:2);
  expect(organicRankForMetrics(observation)).toBeUndefined();
 });
 it.each([2,3])('preserves true terminal absence when %i display slots retain every occurrence',async(cap)=>{
  const s=await setup(await resultsSnapshot());s.config.maxDisplayedResults=cap;
  const terminal=(image:Buffer)=>({...cardScreen('Other one','Other two')(image),lines:[...cardScreen('Other one','Other two')(image).lines,ocrLine("You've reached the end of the list",900)]});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([terminal])});
  expect(r.manifest.queries[0]).toMatchObject({stopReason:'list_end',rankingStatus:'not_found',listingQuality:{endOfResults:true,truncatedCount:0}});
  const observation=ingestAndroidManifest({manifest:r.manifest,placeIds:new Map([['keke','ChIJFixture']])},{timezone:'America/New_York'})[0]!;
  expect(organicRankForMetrics(observation)).toBeNull();
 });
 it('stops at the display target and reports not_found when the alias never appears',async()=>{
  const s=await setup(await resultsSnapshot());s.config.maxDisplayedResults=2;
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([cardScreen('Crown One'),cardScreen('Crown One','Er Hou')])});
  const q=r.manifest.queries[0]!;expect(q.stopReason).toBe('target_reached');expect(q.listingStatus).toBe('complete');expect(q.rankingStatus).toBe('not_found');expect(q.listings).toHaveLength(2);expect(r.exitCode).toBe(0);
 });
 it('gives ads a display position without an organic rank',async()=>{
  const s=await setup(await resultsSnapshot());s.config.tasks[0]!.aliases=['Er Hou'];
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([cardScreen('AD:Xiao Mao Market','Er Hou'),cardScreen('AD:Xiao Mao Market','Er Hou')])});
  const q=r.manifest.queries[0]!;expect(q.listings.map(x=>[x.displayPosition,x.organicRank,x.resultType])).toEqual([[1,null,'ad'],[2,1,'organic']]);expect(q).toMatchObject({displayPosition:2,organicRank:1,rankingStatus:'ranked'});expect(r.manifest.counts.ads).toBe(1);
 });
 it('keeps an identical screenshot as a stalled partial prefix',async()=>{
  const source=await fixtureXml('results-en');let swipes=0;const s=await setup({snapshot:async()=>({png,xml:source,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()}),swipeResults:async()=>{swipes++;}});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([cardScreen('Crown One')])});
  expect(swipes).toBe(1);expect(r.manifest.queries[0]?.screens).toHaveLength(2);expect(r.manifest.queries[0]?.stopReason).toBe('stalled_same_frame');expect(r.manifest.queries[0]?.listingStatus).toBe('partial');expect(r.exitCode).toBe(2);
 });
 it.each([['screenshot_budget',{maxScreenshotsPerQuery:2}],['scroll_budget',{maxScrolls:1}]])('retains a partial prefix at %s',async(stop,patch)=>{
  const s=await setup(await resultsSnapshot());Object.assign(s.config,patch);s.config.maxScreenshotsPerQuery=Math.min(s.config.maxScreenshotsPerQuery,3);
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([cardScreen('Alpha'),cardScreen('Alpha','Bravo'),cardScreen('Bravo','Charlie'),cardScreen('Charlie','Delta')])});
  const q=r.manifest.queries[0]!;expect(q.stopReason).toBe(stop);expect(q.listingStatus).toBe('partial');expect(q.evidenceStatus).toBe('needs_review');expect(q.rankingStatus).toBe('not_found_in_prefix');expect(q.listings.length).toBeGreaterThanOrEqual(2);expect(r.exitCode).toBe(2);
 });
 it('does not publish ranked rows when OCR provenance has the wrong screenshot hash',async()=>{
  const s=await setup(await resultsSnapshot());
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:async()=>({...cardScreen('Crown One')(png),imageSha256:'b'.repeat(64)})});
  expect(r.exitCode).toBe(2);expect(r.manifest.queries[0]?.listings).toEqual([]);expect(r.manifest.queries[0]?.error?.code).toBe('ocr_provenance_mismatch');
 });
 it('fails closed on a malformed OCR payload',async()=>{
  const s=await setup(await resultsSnapshot());
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:async()=>({nonsense:true} as any)});
  expect(r.manifest.queries[0]?.error?.code).toBe('invalid_screen_ocr');expect(r.exitCode).toBe(2);
 });
 it('retains the screenshot but fails closed if OCR artifact delivery fails',async()=>{
  const s=await setup(await resultsSnapshot());const local=new LocalArtifactStore(s.root);
  const store:ArtifactStore={mode:'azure_blob',rootDirectory:s.root,absolutePath:p=>local.absolutePath(p),writeFile:(p,b)=>local.writeFile(p,b),persist:async f=>f.relativePath.endsWith('.ocr.json')?{storageStatus:'failed',objectKey:f.relativePath,verifiedAt:null,storageError:{code:'test',message:'x'}}:{storageStatus:'verified',objectKey:f.relativePath,verifiedAt:new Date().toISOString(),storageError:null}};
  const r=await runAndroidCapture(s.config,s.device,store,{screenRecognizer:recognizerFor([cardScreen('Crown One')])});
  expect(r.exitCode).toBe(2);expect(r.manifest.queries[0]?.listings).toEqual([]);expect(r.manifest.queries[0]?.screens).toHaveLength(1);expect(r.manifest.queries[0]?.error?.code).toBe('storage_unverified');
 });
 it('accepts the query from the OCR sheet header when native XML cannot see it, and reviews when neither can',async()=>{
  const source=await fixtureXml('results-en','sushi');const s=await setup({snapshot:async()=>({png,xml:source,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()})});
  const ok=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([cardScreen('Crown One')])});
  expect(ok.manifest.queries[0]?.stopReason).toBe('stalled_same_frame');expect(ok.manifest.queries[0]?.listings).toHaveLength(1);
  const blind=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:async(request:{png:Buffer})=>({...cardScreen('Crown One')(request.png),lines:[ocrLine('Crown One',300),ocrLine('4.6% (9) - Chinese',340)]})});
  expect(blind.manifest.queries[0]?.stopReason).toBe('query_not_visible');expect(blind.manifest.queries[0]?.evidenceStatus).toBe('needs_review');expect(blind.exitCode).toBe(2);
 });
 it.each(['detail-en','no-results-en'])('records %s as a non-ranking page with not_evaluated rank',async(name)=>{
  const source=await fixtureXml(name);const s=await setup({snapshot:async()=>({png,xml:source,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()})});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([emptyScreen()])});
  const q=r.manifest.queries[0]!;expect(q.screens[0]?.analysis.kind).toBe(name==='detail-en'?'detail':'no_results');expect(q.listingStatus).toBe('non_ranking');expect(q.stopReason).toBe(`screen_${name==='detail-en'?'detail':'no_results'}`);expect(q.organicRank).toBeNull();expect(q.rankingStatus).toBe('not_evaluated');expect(r.exitCode).toBe(0);
 });
 it('stops after a query error and keeps raw error secrets out of manifest and receipt',async()=>{
  let searches=0;const s=await setup({search:async()=>{searches++;throw new Error('token=SUPERSECRET https://blob.test/x?sig=VERYSECRET');}});s.config.tasks.push({...s.config.tasks[0]!,keyword:'tea'});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));expect(searches).toBe(1);expect(r.manifest.counts.skipped).toBe(1);expect(JSON.stringify(r)).not.toContain('SECRET');expect(s.closed()).toBe(1);
 });
 it('stops after an unverified screenshot upload and only attempts the terminal manifest',async()=>{
  let searches=0;const s=await setup({search:async()=>{searches++;}});s.config.tasks.push({...s.config.tasks[0]!,keyword:'tea'});const local=new LocalArtifactStore(s.root);const persisted:string[]=[];
  const store:ArtifactStore={mode:'azure_blob',rootDirectory:s.root,absolutePath:p=>local.absolutePath(p),writeFile:(p,b)=>local.writeFile(p,b),persist:async f=>{persisted.push(f.relativePath);return f.relativePath.endsWith('.png')&&!f.relativePath.endsWith('__location.png')?{storageStatus:'uploaded',objectKey:f.relativePath,verifiedAt:null,storageError:null}:{storageStatus:'verified',objectKey:f.relativePath,verifiedAt:new Date().toISOString(),storageError:null};}};
  const r=await runAndroidCapture(s.config,s.device,store,{screenRecognizer:recognizerFor([cardScreen('A')])});expect(searches).toBe(1);expect(r.exitCode).toBe(2);expect(r.manifest.executionStatus).toBe('failed');expect(persisted.at(-1)).toMatch(/manifest.json$/);
 });
 it('returns a failed terminal receipt when final delivery throws without leaking secrets',async()=>{
  const s=await setup();const local=new LocalArtifactStore(s.root);const store:ArtifactStore={mode:'azure_blob',rootDirectory:s.root,absolutePath:p=>local.absolutePath(p),writeFile:(p,b)=>local.writeFile(p,b),persist:async f=>{if(f.relativePath.endsWith('/manifest.json'))throw new Error('SUPERSECRET');return {storageStatus:'verified',objectKey:f.relativePath,verifiedAt:new Date().toISOString(),storageError:null};}};
  const r=await runAndroidCapture(s.config,s.device,store,{screenRecognizer:recognizerFor([emptyScreen()])});expect(r.exitCode).toBe(2);expect(r.receipt.storageStatus).toBe('failed');expect(JSON.stringify(r)).not.toContain('SUPERSECRET');expect(s.closed()).toBe(1);
 });
 it.each(['truncated','crc','missing_idat'])('rejects structurally invalid PNG: %s',async(kind)=>{
  const bad=kind==='truncated'?png.subarray(0,png.length-4):kind==='missing_idat'?Buffer.concat([png.subarray(0,33),png.subarray(png.length-12)]):Buffer.from(png);
  if(kind==='crc')bad[45]=bad[45]!^1;
  const s=await setup({snapshot:async()=>({png:bad,xml,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()})});const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));expect(r.exitCode).toBe(2);expect(r.manifest.queries[0]?.screens).toHaveLength(0);expect(r.manifest.queries[0]?.error?.code).toBe('invalid_png');
 });
 it('quarantines the exact device lease if close fails instead of allowing an overlapping session',async()=>{
  const s=await setup({close:async()=>{throw new Error('private cleanup details');}});s.config.serial=`emulator-${20000+process.pid%40000}`;const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([emptyScreen()])});await trackTestLease(s.config.serial);
  expect(r.manifest.errors.some(e=>e.code==='device_lease_quarantined')).toBe(true);await expectDeviceBusy(s.config.serial);expect(JSON.stringify(r)).not.toContain('private cleanup details');
 });
 it('quarantines ambiguous session creation when the driver cannot confirm cleanup',async()=>{
  const s=await setup({start:async()=>{throw Object.assign(new Error('creation request timed out'),{code:'COMMAND_TIMEOUT'});},close:async()=>{throw Object.assign(new Error('unknown server-side session creation'),{code:'SESSION_OUTCOME_UNKNOWN'});}});s.config.serial=`emulator-${20000+(process.pid+7)%40000}`;
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));await trackTestLease(s.config.serial);expect(r.manifest.errors.map(e=>e.code)).toEqual(expect.arrayContaining(['command_timeout','session_outcome_unknown','device_lease_quarantined']));await expectDeviceBusy(s.config.serial);
 });
 it('releases the lease after a preflight failure with confirmed no active session',async()=>{
  const s=await setup({preflight:async()=>{throw new Error('Maps missing');}});const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));expect(r.exitCode).toBe(2);const release=await acquireDeviceLease(s.config.serial);await release();
 });
 it('writes immutable source, query and CSV artifacts and returns the manifest receipt separately',async()=>{
  const s=await setup();const store=new LocalArtifactStore(s.root);const a=await runAndroidCapture(s.config,s.device,store,{screenRecognizer:recognizerFor([emptyScreen()])});const b=await runAndroidCapture(s.config,s.device,store,{screenRecognizer:recognizerFor([emptyScreen()])});
  expect(a.receipt.relativePath).not.toBe(b.receipt.relativePath);expect(a.receipt.relativePath).toMatch(/^android-maps\/\d{4}-\d{2}-\d{2}\/run_/);
  expect(new Set(a.manifest.artifacts.map(x=>x.kind))).toEqual(new Set(['input','device','png','ui_xml','ocr_json','screen_frame','query_json','csv']));expect(a.manifest.artifacts.some(x=>x.relativePath===a.receipt.relativePath)).toBe(false);
  const persisted=JSON.parse(await readFile(join(s.root,a.receipt.relativePath),'utf8'));expect(persisted).toEqual(a.manifest);expect(a.manifest.queries[0]?.screens[0]?.png.relativePath).toMatch(/\d{8}T\d{6}\.\d{3}Z__noodles/);
 });
});

describe('native run cancellation',()=>{
 it('stops after the current command, skips remaining work and releases the lease',async()=>{
  const controller=new AbortController();let snapshots=0;const s=await setup({search:async()=>{controller.abort();},snapshot:async()=>{snapshots++;return {png,xml,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()};}});s.config.tasks.push({...s.config.tasks[0]!,keyword:'tea'});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{signal:controller.signal});expect(r.exitCode).toBe(2);expect(snapshots).toBe(0);expect(r.manifest.counts.skipped).toBe(1);expect(s.closed()).toBe(1);const release=await acquireDeviceLease(s.config.serial);await release();
 });
});

describe('native terminal boundaries and profile identity',()=>{
 it('fails if the final screenshot persistence crosses the query deadline',async()=>{
  const source=await fixtureXml('results-en');const s=await setup({snapshot:async()=>({png,xml:source,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()})});s.config.maxScreenshotsPerQuery=1;
  let clock=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>clock);const local=new LocalArtifactStore(s.root);
  const store:ArtifactStore={mode:'local_only',rootDirectory:s.root,absolutePath:p=>local.absolutePath(p),writeFile:(p,b)=>local.writeFile(p,b),persist:async f=>{if(f.relativePath.endsWith('.png'))clock+=s.config.keywordTimeoutMs+1;return local.persist(f);}};
  const r=await runAndroidCapture(s.config,s.device,store,{screenRecognizer:recognizerFor([cardScreen('A')])});expect(r.exitCode).toBe(2);expect(r.manifest.queries[0]?.error?.code).toBe('query_timeout');expect(r.manifest.queries[0]?.screens).toHaveLength(1);
 });
 it.each(['query.json','manifest.json'])('does not return success if cancellation arrives while persisting %s',async(name)=>{
  const source=await fixtureXml('no-results-en');const controller=new AbortController();const s=await setup({snapshot:async()=>({png,xml:source,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()})});const local=new LocalArtifactStore(s.root);
  const store:ArtifactStore={mode:'local_only',rootDirectory:s.root,absolutePath:p=>local.absolutePath(p),writeFile:(p,b)=>local.writeFile(p,b),persist:async f=>{if(f.relativePath.endsWith('/'+name))controller.abort();return local.persist(f);}};
  const r=await runAndroidCapture(s.config,s.device,store,{signal:controller.signal,screenRecognizer:recognizerFor([emptyScreen()])});expect(r.exitCode).toBe(2);if(name==='query.json')expect(r.manifest.errors.some(e=>e.code==='cancelled')).toBe(true);
 });
 it('identifies native profiles deterministically and changes the profile when the app version changes',async()=>{
  const a=await setup();const b=await setup();const c=await setup();const old=c.device.preflight;c.device.preflight=async()=>({...await old(),appVersion:'different'});const opts={screenRecognizer:recognizerFor([emptyScreen()])};
  const ra=await runAndroidCapture(a.config,a.device,new LocalArtifactStore(a.root),opts);const rb=await runAndroidCapture(b.config,b.device,new LocalArtifactStore(b.root),opts);const rc=await runAndroidCapture(c.config,c.device,new LocalArtifactStore(c.root),opts);
  expect(ra.manifest.surface).toBe('google_maps_android_app');expect(ra.manifest.adapterVersion).toBe('android-screen-ocr/v4');expect(ra.manifest.profileHash).toMatch(/^[a-f0-9]{64}$/);expect(ra.manifest.profileHash).toBe(rb.manifest.profileHash);expect(ra.manifest.profileHash).not.toBe(rc.manifest.profileHash);
 });
 it('persists actual display metadata and separates each display condition without inventing historical defaults',async()=>{
  const displays = [undefined, {widthPixels:720,heightPixels:1280,densityDpi:320,fontScale:1}, {fontScale:1,densityDpi:320,heightPixels:1280,widthPixels:720},
    {widthPixels:1080,heightPixels:1280,densityDpi:320,fontScale:1}, {widthPixels:720,heightPixels:2400,densityDpi:320,fontScale:1},
    {widthPixels:720,heightPixels:1280,densityDpi:420,fontScale:1}, {widthPixels:720,heightPixels:1280,densityDpi:320,fontScale:1.15}];
  const profiles: Array<string|null> = [];
  for(const display of displays){const s=await setup();const original=s.device.preflight;s.device.preflight=async()=>({...await original(),...(display ? {display} : {})});
    const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([emptyScreen()])});
    profiles.push(r.manifest.profileHash);const deviceFile=r.manifest.artifacts.find(a=>a.kind==='device')!;
    const saved=JSON.parse(await readFile(join(s.root,deviceFile.relativePath),'utf8'));expect(saved.display).toEqual(display);expect(r.manifest.device?.display).toEqual(display);
    if(!display)expect(Object.hasOwn(saved,'display')).toBe(false);
  }
  expect(profiles[1]).toBe(profiles[2]);expect(new Set(profiles.filter((_,i)=>i!==2)).size).toBe(6);
 });
 it('keeps original PNG and malformed XML as diagnostics while marking query failed',async()=>{
  const malformed='<hierarchy><node>';const s=await setup({snapshot:async()=>({png,xml:malformed,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()})});const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));
  expect(r.exitCode).toBe(2);expect(r.manifest.queries[0]?.error?.code).toBe('invalid_ui_xml');const shot=r.manifest.queries[0]?.screens[0];expect(shot?.role).toBe('diagnostic');expect(shot?.analysis.kind).toBe('unknown');expect((await readFile(join(s.root,shot!.png.relativePath))).equals(png)).toBe(true);
 });
});


describe('review regressions: runner ranking and stop boundaries', () => {
  it('honors the reviewed native backward-scroll evidence over apparent OCR top controls', async () => {
    const source = await readFile(new URL('./fixtures/android/ranking/trial-overlap-controls-before.xml', import.meta.url), 'utf8');
    const s = await setup({ snapshot: async () => ({ png, xml: source, packageName: 'com.google.android.apps.maps', capturedAt: new Date().toISOString() }) });
    s.config.tasks[0]!.keyword = 'hot pot near me'; s.config.maxDisplayedResults = 1;
    const r = await runAndroidCapture(s.config, s.device, new LocalArtifactStore(s.root), { screenRecognizer: async ({png}) => {
      const result = cardScreen('Keke')(png); result.lines[0]!.text = 'hot pot near me x'; return result;
    } });
    expect(r.manifest.queries[0]).toMatchObject({ rankingStatus: 'not_evaluated', organicRank: null, listingStatus: 'partial' });
    expect(r.manifest.queries[0]?.listingQuality?.sequenceVerified).toBe(false);
    expect(r.exitCode).toBe(2);
  });

  it.each(['same_png', 'no_new_cards'])('does not claim list end from %s', async mode => {
    let shot = 0; const source = await fixtureXml('results-en');
    const s = await setup({ snapshot: async () => ({ png: mode === 'same_png' ? png : pngWith(shot++), xml: source, packageName: 'com.google.android.apps.maps', capturedAt: new Date().toISOString() }) });
    const r = await runAndroidCapture(s.config, s.device, new LocalArtifactStore(s.root), { screenRecognizer: recognizerFor([cardScreen('Crown One')]) });
    expect(r.manifest.queries[0]).toMatchObject({ listingStatus: 'partial', evidenceStatus: 'needs_review', rankingStatus: 'not_found_in_prefix' });
    expect(r.manifest.queries[0]?.stopReason).not.toBe('list_end');
    expect(r.exitCode).toBe(2);
  });
  it('does not publish a target rank from unreliable card order', async () => {
    const s = await setup(); s.config.maxDisplayedResults = 2; s.config.tasks[0]!.aliases = ['Keke'];
    const r = await runAndroidCapture(s.config, s.device, new LocalArtifactStore(s.root), { screenRecognizer: async ({ png }) => ({ ...cardScreen('Keke')(png), lines: [ocrLine('noodles x',200), ocrLine('Relevance Open now Price',240), ocrLine('4.8 (33)',280), ocrLine('Keke',400),ocrLine('4.6 (9)',440)] }) });
    expect(r.manifest.queries[0]).toMatchObject({ organicRank: null, displayPosition: null, rankingStatus: 'not_evaluated', evidenceStatus: 'needs_review' });
    expect(r.exitCode).toBe(2);
  });
});

describe('grid regression: native evidence stays attached to each OCR frame', () => {
  const fixtureRoot = new URL('./fixtures/android/grid-v3-20261020/', import.meta.url);
  it('resets the no-new-card stall counter only for measured movement, then stops after three stationary frames', async () => {
    const root = new URL('./fixtures/android/repair-probe-20261021/', import.meta.url);
    const sequence = [1, 2, 3, 3, 3, 3];
    const samples = await Promise.all(sequence.map(async n => {
      const stem = `q0003-frame${String(n).padStart(2, '0')}`;
      return { xml: await readFile(new URL(`${stem}.xml`, root), 'utf8'), ocr: JSON.parse(await readFile(new URL(`${stem}.ocr.json`, root), 'utf8')) };
    }));
    let shot = 0, ocrIndex = 0; const swipe = vi.fn(async () => {});
    const s = await setup({ snapshot: async () => ({ png: pngWith(++shot, 720, 1280), xml: samples[Math.min(shot - 1, 5)]!.xml,
      packageName: 'com.google.android.apps.maps', capturedAt: new Date().toISOString() }), swipeResults: swipe });
    s.config.tasks[0]!.keyword = 'bubble tea near me'; s.config.maxScreenshotsPerQuery = 7; s.config.maxScrolls = 6;
    const result = await runAndroidCapture(s.config, s.device, new LocalArtifactStore(s.root), {
      // Synthetic pixels exercise runner control flow; native/OCR geometry is replayed from the actual probe.
      screenRecognizer: async ({ png }) => ({ ...samples[Math.min(ocrIndex++, 5)]!.ocr, imageSha256: shaOf(png) }),
    });
    expect(result.manifest.queries[0]?.stopReason).toBe('stalled_no_new_cards');
    expect(result.manifest.queries[0]?.screens).toHaveLength(6);
    expect(swipe).toHaveBeenCalledTimes(5);
    expect(result.manifest.queries[0]?.listingStatus).toBe('partial');
    expect(result.exitCode).toBe(2);
  });
  it('refuses organic rank when native ad evidence cannot be matched to the OCR card', async () => {
    const source = (await readFile(new URL('./fixtures/android/results-en.xml', import.meta.url), 'utf8')).replaceAll('seafood buffet', 'noodles');
    const swipe = vi.fn(async () => {});
    const s = await setup({ snapshot: async () => ({ png, xml: source, packageName: 'com.google.android.apps.maps', capturedAt: new Date().toISOString() }), swipeResults: swipe });
    s.config.tasks[0]!.aliases = ['Keke'];
    const result = await runAndroidCapture(s.config, s.device, new LocalArtifactStore(s.root), { screenRecognizer: recognizerFor([cardScreen('Keke')]) });
    expect(result.manifest.queries[0]).toMatchObject({ organicRank: null, rankingStatus: 'not_evaluated', evidenceStatus: 'needs_review', stopReason: 'ranking_unreliable' });
    expect(result.manifest.queries[0]?.listings[0]?.resultType).toBe('unknown');
    expect(swipe).not.toHaveBeenCalled(); expect(result.exitCode).toBe(2);
  });
  it('persists native top/ad proof and sends the same captured XML to the bounded gesture', async () => {
    const source = await readFile(new URL('bamboo-ad-cjk-header.xml', fixtureRoot), 'utf8');
    const ocr = JSON.parse(await readFile(new URL('bamboo-ad-cjk-header.ocr.json', fixtureRoot), 'utf8'));
    const synthetic = pngWith(7, 720, 1280); // synthetic pixels; real OCR is replayed offline only
    const swipe = vi.fn(async () => {});
    const s = await setup({ snapshot: async () => ({ png: synthetic, xml: source, packageName: 'com.google.android.apps.maps', capturedAt: new Date().toISOString() }), swipeResults: swipe });
    s.config.tasks[0]!.keyword = '卤味'; s.config.maxScreenshotsPerQuery = 2;
    const r = await runAndroidCapture(s.config, s.device, new LocalArtifactStore(s.root), { screenRecognizer: async () => ({ ...ocr, imageSha256: shaOf(synthetic) }) });
    expect(swipe).toHaveBeenCalledTimes(1);
    expect(swipe).toHaveBeenCalledWith(expect.objectContaining({ sourceXml: source, listBounds: { left: 0, top: 456, right: 720, bottom: 1232 } }));
    const gesture = (swipe.mock.calls as unknown as Array<[{anchors: Array<{text: string}>; ocrScrollAnchor?: unknown}]>)[0]![0];
    expect(gesture.anchors.map(anchor => anchor.text)).toEqual(['Directions', 'Call', 'Website', 'Menu']);
    expect(gesture.ocrScrollAnchor).toBeUndefined(); // shallow title cannot support movement above the guarded 10% fallback
    expect(r.manifest.queries[0]?.listings[0]).toMatchObject({ resultType: 'ad', name: 'Sweet Bamboo Chinese Food | Hillside', organicRank: null });
    const first = r.manifest.queries[0]!.screens[0]!.screenFrame!;
    expect(JSON.parse(await readFile(join(s.root, first.relativePath), 'utf8'))).toMatchObject({ topStateSource: 'native_scroll_actions', sheetBoundarySource: 'native_result_list' });
  });
  it('passes a full deep OCR title and same-PNG receipt for an adaptive gesture', async () => {
    const base = new URL('./fixtures/android/repair-probe-20261021/q0003-frame02', import.meta.url);
    const source = await readFile(`${base.pathname}.xml`, 'utf8');
    const ocr = JSON.parse(await readFile(`${base.pathname}.ocr.json`, 'utf8'));
    const synthetic = pngWith(10, 720, 1280), swipe = vi.fn(async () => {});
    const s = await setup({ snapshot: async () => ({ png: synthetic, xml: source, packageName: 'com.google.android.apps.maps', capturedAt: new Date().toISOString() }), swipeResults: swipe });
    s.config.tasks[0]!.keyword = 'bubble tea near me'; s.config.maxScreenshotsPerQuery = 2;
    await runAndroidCapture(s.config, s.device, new LocalArtifactStore(s.root), { screenRecognizer: async () => ({ ...ocr, imageSha256: shaOf(synthetic) }) });
    expect(swipe).toHaveBeenCalledTimes(1);
    expect(swipe).toHaveBeenCalledWith(expect.objectContaining({ sourceXml: source, listBounds: { left: 0, top: 272, right: 720, bottom: 1232 },
      ocrScrollAnchor: { name: 'Tea Magic', nameConfidence: 96.14, nameBounds: { left: 41, top: 1091, right: 200.5, bottom: 1125.5 },
        ratingBounds: { left: 41, top: 1137, right: 429, bottom: 1163 }, imageSha256: shaOf(synthetic) } }));
  });
  it.each(['UNKNOWN_SCROLL_LAYOUT', 'SOURCE_CHANGED'])('keeps %s as an unqualified partial and still captures the next query', async code => {
    const s = await setup({ swipeResults: async () => { throw Object.assign(new Error('no gesture was sent'), { code }); } });
    s.config.tasks.push({ ...s.config.tasks[0]! }); s.config.maxScreenshotsPerQuery = 3;
    const frames = code === 'SOURCE_CHANGED' ? [cardScreen('Keke'), cardScreen('Keke'), emptyScreen()] : [cardScreen('Keke'), emptyScreen()];
    const r = await runAndroidCapture(s.config, s.device, new LocalArtifactStore(s.root), { screenRecognizer: recognizerFor(frames) });
    expect(r.manifest.queries[0]).toMatchObject({ evidenceStatus: 'needs_review', stopReason: code.toLowerCase(), rankingStatus: 'not_evaluated', error: null });
    expect(r.manifest.queries[0]?.listingQuality?.rankingReliable).toBe(false);
    expect(r.manifest.queries[1]?.screens).toHaveLength(1);
    expect(r.manifest.counts).toMatchObject({ failed: 0, skipped: 0 });
    expect(r.manifest.errors).toHaveLength(0);
    expect(r.exitCode).toBe(2);
  });
  it('rejects OCR dimensions that do not match the persisted PNG', async () => {
    const s = await setup();
    const r = await runAndroidCapture(s.config, s.device, new LocalArtifactStore(s.root), { screenRecognizer: async request => ({ ...cardScreen('Keke')(request.png), imageWidth: 720, imageHeight: 1280 }) });
    expect(r.manifest.queries[0]).toMatchObject({ evidenceStatus: 'failed', stopReason: 'ocr_dimensions_mismatch' });
    expect(r.manifest.queries[0]?.listings).toEqual([]);
  });
});

describe('bounded native-source refresh before any gesture', () => {
  it('captures and persists fresh XML/PNG/OCR once before replanning, even when no gesture changed the pixels', async () => {
    const first = await fixtureXml('results-en'), refreshed = first.replace('<hierarchy', '<hierarchy refreshed="true"');
    let shot = 0, calls = 0; const sources: string[] = [];
    const s = await setup({ snapshot: async () => ({ png: shot++ < 2 ? png : pngWith(5), xml: shot === 1 ? first : refreshed, packageName: 'com.google.android.apps.maps', capturedAt: new Date().toISOString() }),
      swipeResults: async evidence => { sources.push(evidence!.sourceXml); if (++calls === 1) throw Object.assign(new Error('source changed before any action'), { code: 'SOURCE_CHANGED' }); } });
    s.config.maxDisplayedResults = 2; s.config.maxScreenshotsPerQuery = 3;
    const r = await runAndroidCapture(s.config, s.device, new LocalArtifactStore(s.root), { screenRecognizer: recognizerFor([cardScreen('A'), cardScreen('A'), cardScreen('A', 'B')]) });
    expect(r.manifest.queries[0]).toMatchObject({ listingStatus: 'complete', stopReason: 'target_reached', nativeFrameRefreshes: [{ reason: 'source_changed', afterFrameId: 'q0001:frame-001', refreshFrameId: 'q0001:frame-002' }] });
    expect(r.manifest.queries[0]?.screens).toHaveLength(3); expect(sources).toEqual([first, refreshed]);
    expect(await readFile(join(s.root, r.manifest.queries[0]!.screens[1]!.xml.relativePath), 'utf8')).toBe(refreshed);
    expect(r.exitCode).toBe(0);
  });
  it('does not retry another source mismatch after the single fresh-frame allowance', async () => {
    const source = await fixtureXml('results-en'); let calls = 0;
    const s = await setup({ snapshot: async () => ({ png, xml: source, packageName: 'com.google.android.apps.maps', capturedAt: new Date().toISOString() }), swipeResults: async () => { calls++; throw Object.assign(new Error('source changed'), { code: 'SOURCE_CHANGED' }); } });
    s.config.maxScreenshotsPerQuery = 5;
    const r = await runAndroidCapture(s.config, s.device, new LocalArtifactStore(s.root), { screenRecognizer: recognizerFor([cardScreen('A')]) });
    expect(r.manifest.queries[0]?.stopReason).toBe('source_changed'); expect(calls).toBe(2);
    expect(r.manifest.queries[0]?.screens).toHaveLength(2); expect(r.manifest.queries[0]?.listingQuality?.rankingReliable).toBe(false); expect(r.exitCode).toBe(2);
  });
  it('allows one fresh frame per sent gesture and stops on two refusals in a row (probe 5 q0003, candidate10)', async () => {
    const source = await fixtureXml('results-en'); let calls = 0, shots = 0;
    // Gestures 1, 3, 5 and 7 are refused before any action; 2, 4 and 6 are sent; 8 is refused right after a refresh.
    const s = await setup({ snapshot: async () => ({ png: pngWith(++shots), xml: source, packageName: 'com.google.android.apps.maps', capturedAt: new Date().toISOString() }),
      swipeResults: async () => { if (++calls % 2 === 1 || calls === 8) throw Object.assign(new Error('source changed'), { code: 'SOURCE_CHANGED' }); } });
    s.config.maxScreenshotsPerQuery = 12; s.config.maxScrolls = 12;
    const r = await runAndroidCapture(s.config, s.device, new LocalArtifactStore(s.root), { screenRecognizer: recognizerFor([cardScreen('A'), cardScreen('A'), cardScreen('A', 'B'), cardScreen('A', 'B'), cardScreen('A', 'B', 'C'), cardScreen('A', 'B', 'C'), cardScreen('A', 'B', 'C', 'D'), cardScreen('A', 'B', 'C', 'D')]) });
    // A fourth refresh is allowed because three gestures were sent; the old fixed cap of three would have stopped here.
    expect(r.manifest.queries[0]?.nativeFrameRefreshes).toEqual([
      { reason: 'source_changed', afterFrameId: 'q0001:frame-001', refreshFrameId: 'q0001:frame-002' },
      { reason: 'source_changed', afterFrameId: 'q0001:frame-003', refreshFrameId: 'q0001:frame-004' },
      { reason: 'source_changed', afterFrameId: 'q0001:frame-005', refreshFrameId: 'q0001:frame-006' },
      { reason: 'source_changed', afterFrameId: 'q0001:frame-007', refreshFrameId: 'q0001:frame-008' },
    ]);
    expect(r.manifest.queries[0]?.stopReason).toBe('source_changed'); expect(calls).toBe(8);
    expect(r.manifest.queries[0]?.screens).toHaveLength(8); expect(r.manifest.queries[0]?.listings.map(row => row.name)).toEqual(['A', 'B', 'C', 'D']);
  });
  // A frame whose content moved by about a card height: the card sits low, no filter chips, and
  // nothing shares a position with the previous frame (probe 6/7 page-boundary jump).
  // Cards start 150 px below the native list top (272) so no header is clipped; the jumped frame
  // moved by about a card height so nothing shares a position with the previous frame.
  const rating = (name: string) => `4.6% (${20 + [...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 997}) - $10-20 - Chinese`;
  const seated = (...names: string[]) => (png: Buffer) => ({ ...cardScreen(...names)(png), imageWidth: 720, imageHeight: 1280, lines: [ocrLine('chinese food x', 200), ...names.flatMap((name, i) => [ocrLine(name, 420 + i * 300), ocrLine(rating(name), 460 + i * 300), ocrLine('Closed . Opens 9:30 AM - 0.2 mi', 500 + i * 300)])] });
  const jumped = (name: string) => (png: Buffer) => ({ ...cardScreen(name)(png), imageWidth: 720, imageHeight: 1280, lines: [ocrLine('chinese food x', 200), ocrLine(name, 820), ocrLine(rating(name), 860), ocrLine('Closed . Opens 9:30 AM - 0.2 mi', 900)] });
  // The synthetic results fixture exposes no gesture-grade native list; the correction needs one, so
  // these two tests pair the synthetic OCR with a real probe-5 list frame for the same exact query.
  const liveList = async () => (await readFile(new URL('./fixtures/android/repair-probe-20261021/candidate5-q0002-02.xml', import.meta.url), 'utf8'));
  it('corrects a missing ordered overlap with one backward gesture, discards the skipped frame, and keeps the sequence (probe 6/7 page jump)', async () => {
    const source = await liveList(), scrolled=(await readFile(new URL('./fixtures/android/sheet-recovery-20261023/keke-2.xml',import.meta.url),'utf8')).replaceAll('braised food flushing','chinese food'); let shots = 0; const directions: string[] = [];
    const s = await setup({ snapshot: async () => ({ png: pngWith(++shots, 720, 1280), xml: shots===1 ? source : scrolled, packageName: 'com.google.android.apps.maps', capturedAt: new Date().toISOString() }),
      swipeResults: async (_evidence, direction) => { directions.push(direction ?? 'forward'); } });
    s.config.tasks[0]!.keyword = 'chinese food'; s.config.maxDisplayedResults = 3; s.config.maxScreenshotsPerQuery = 8;
    const r = await runAndroidCapture(s.config, s.device, new LocalArtifactStore(s.root), { screenRecognizer: recognizerFor([seated('A'), jumped('C'), seated('A', 'B'), seated('B', 'C')]) });
    const q = r.manifest.queries[0]!;
    expect(directions).toEqual(['forward', 'backward', 'forward']);
    expect(q.nativeFrameCorrections).toEqual([{ reason: 'ordered_overlap_missing', afterFrameId: 'q0001:frame-001', discardedFrameId: 'q0001:frame-002' }]);
    expect(q.screens.map(screen => screen.discarded ?? null)).toEqual([null, 'ordered_overlap_missing', null, null]);
    expect(q.listings.map(row => row.name)).toEqual(['A', 'B', 'C']);
    expect(q).toMatchObject({ listingStatus: 'complete', stopReason: 'target_reached', listingQuality: { rankingReliable: true, sequenceVerified: true, frames: 3 } });
  });
  it.each(['ok','failed recovery','budget exhausted','scroll exhausted','repeat collapse'] as const)('re-expands native top with retained evidence and bounded recovery: %s', async kind=>{
    const root=new URL('./fixtures/android/sheet-recovery-20261023/',import.meta.url);
    const xmls=await Promise.all((kind==='repeat collapse'?[1,2,3,1,2,3]:[1,2,3,1]).map(n=>readFile(new URL(`keke-${n}.xml`,root),'utf8')));
    const ocrs=await Promise.all((kind==='repeat collapse'?[1,2,3,1,2,3]:[1,2,3,1]).map(async n=>JSON.parse(await readFile(new URL(`keke-${n}.ocr.json`,root),'utf8'))));
    // Force missing overlap independently of the new native-control continuity fix.
    for(const n of [1,4])if(ocrs[n])ocrs[n].lines=ocrs[n].lines.map((l:any)=>({...l,text:l.text.replace('(547)','(777)')}));
    let shot=0; const directions:string[]=[]; const restore=vi.fn(async()=>{if(kind==='failed recovery')throw Object.assign(new Error('test uncertain outcome'),{code:'APPIUM_PROTOCOL_ERROR'});});
    const s=await setup({snapshot:async()=>({png:pngWith(++shot,720,1280),xml:xmls[Math.min(shot-1,xmls.length-1)]!,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()}),
      restoreResultsAtTop:restore,swipeResults:async(_e,d)=>{directions.push(d??'forward');}});
    s.config.ocrScale=ocrs[0].scale;s.config.tasks[0]!.keyword='braised food flushing';s.config.maxDisplayedResults=20;s.config.maxScreenshotsPerQuery=kind==='budget exhausted'?3:kind==='repeat collapse'?6:4;
    if(kind==='scroll exhausted')s.config.maxScrolls=2;
    let i=0;const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:async req=>({...ocrs[i++],imageSha256:shaOf(req.png)})});
    const q=r.manifest.queries[0]!;
    if(kind==='failed recovery'){expect(restore).toHaveBeenCalledTimes(1);expect(q.stopReason).toBe('appium_protocol_error');expect(q.organicRank).toBeNull();expect(q.nativeSheetRecoveries![0]!.status).toBe('attempted');return;}
    if(kind==='budget exhausted'||kind==='scroll exhausted'){expect(restore).not.toHaveBeenCalled();expect(q.stopReason).toBe(kind==='budget exhausted'?'screenshot_budget':'scroll_budget');expect(q.organicRank).toBeNull();return;}
    if(kind==='repeat collapse'){expect(restore).toHaveBeenCalledTimes(1);expect(q.nativeSheetRecoveries).toHaveLength(1);expect(directions).toEqual(['forward','backward','forward','backward']);expect(r.exitCode).toBe(2);return;}
    expect(restore).toHaveBeenCalledTimes(1);expect(directions).toEqual(['forward','backward']);
    expect(q.screens.map(x=>x.discarded??null)).toEqual(['sheet_top_restart','ordered_overlap_missing','sheet_top_restart',null]);
    expect(q.nativeSheetRecoveries).toEqual([{reason:'collapsed_after_backward',afterFrameId:'q0001:frame-003',supersededFrameIds:['q0001:frame-001','q0001:frame-003'],status:'completed',restartFrameId:'q0001:frame-004'}]);
    expect(q.listings).toHaveLength(2);expect(q.listings.every(row=>row.frameIds.every(id=>id==='q0001:frame-004'))).toBe(true);
    expect(q.stopReason).toBe('screenshot_budget');expect(r.exitCode).toBe(2);
  });
  it('spends at most two backward corrections per query and then keeps the unqualified partial', async () => {
    const source = await liveList(), scrolled=(await readFile(new URL('./fixtures/android/sheet-recovery-20261023/keke-2.xml',import.meta.url),'utf8')).replaceAll('braised food flushing','chinese food'); let shots = 0; const directions: string[] = [];
    const s = await setup({ snapshot: async () => ({ png: pngWith(++shots, 720, 1280), xml: shots===1 ? source : scrolled, packageName: 'com.google.android.apps.maps', capturedAt: new Date().toISOString() }),
      swipeResults: async (_evidence, direction) => { directions.push(direction ?? 'forward'); } });
    s.config.tasks[0]!.keyword = 'chinese food'; s.config.maxScreenshotsPerQuery = 8;
    const r = await runAndroidCapture(s.config, s.device, new LocalArtifactStore(s.root), { screenRecognizer: recognizerFor([seated('A'), jumped('C'), jumped('D'), jumped('E')]) });
    const q = r.manifest.queries[0]!;
    expect(directions).toEqual(['forward', 'backward', 'backward']);
    expect(q.nativeFrameCorrections).toHaveLength(2);
    expect(q).toMatchObject({ stopReason: 'ranking_unreliable', listingStatus: 'partial', evidenceStatus: 'needs_review' });
    expect(q.screens).toHaveLength(4); expect(r.exitCode).toBe(2);
  });
  it('charges the fresh frame to the existing screenshot limit and never sends a gesture beyond it', async () => {
    const source = await fixtureXml('results-en'); const swipe = vi.fn(async () => { throw Object.assign(new Error('source changed'), { code: 'SOURCE_CHANGED' }); });
    const s = await setup({ snapshot: async () => ({ png, xml: source, packageName: 'com.google.android.apps.maps', capturedAt: new Date().toISOString() }), swipeResults: swipe }); s.config.maxScreenshotsPerQuery = 2;
    const r = await runAndroidCapture(s.config, s.device, new LocalArtifactStore(s.root), { screenRecognizer: recognizerFor([cardScreen('A')]) });
    expect(r.manifest.queries[0]?.stopReason).toBe('screenshot_budget'); expect(r.manifest.queries[0]?.screens).toHaveLength(2); expect(swipe).toHaveBeenCalledTimes(1); expect(r.exitCode).toBe(2);
  });
  it('rechecks the fresh native frame and stops on consent before any further gesture', async () => {
    const first = await fixtureXml('results-en'), consent = await fixtureXml('consent-en'); let snapshots = 0;
    const swipe = vi.fn(async () => { throw Object.assign(new Error('source changed'), { code: 'SOURCE_CHANGED' }); });
    const s = await setup({ snapshot: async () => ({ png, xml: snapshots++ === 0 ? first : consent, packageName: 'com.google.android.apps.maps', capturedAt: new Date().toISOString() }), swipeResults: swipe });
    const r = await runAndroidCapture(s.config, s.device, new LocalArtifactStore(s.root), { screenRecognizer: recognizerFor([cardScreen('Keke')]) });
    expect(r.manifest.queries[0]).toMatchObject({ evidenceStatus: 'failed', stopReason: 'screen_consent', rankingStatus: 'not_evaluated', organicRank: null });
    expect(r.manifest.queries[0]?.screens).toHaveLength(2); expect(swipe).toHaveBeenCalledTimes(1);
    expect(r.manifest.queries[0]?.screens[1]?.ocr).toBeUndefined();
    expect(r.manifest.queries[0]?.nativeFrameRefreshes).toEqual([{ reason: 'source_changed', afterFrameId: 'q0001:frame-001', refreshFrameId: null }]);
    expect(r.exitCode).toBe(2);
  });
  it('does not reset the query deadline when asking for a fresh frame', async () => {
    const source = await fixtureXml('results-en'); let clock = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const s = await setup({ snapshot: async () => ({ png, xml: source, packageName: 'com.google.android.apps.maps', capturedAt: new Date().toISOString() }), swipeResults: async () => { clock += 600001; throw Object.assign(new Error('source changed'), { code: 'SOURCE_CHANGED' }); } });
    const r = await runAndroidCapture(s.config, s.device, new LocalArtifactStore(s.root), { screenRecognizer: recognizerFor([cardScreen('A')]) });
    expect(r.manifest.queries[0]?.stopReason).toBe('query_timeout'); expect(r.manifest.queries[0]?.screens).toHaveLength(1); expect(r.exitCode).toBe(2);
  });
});


describe('candidate4 scroll-anchor geometry regression', () => {
 it('uses a valid earlier title instead of sending an overlapping title/rating anchor to the device', async () => {
  const root = new URL('./fixtures/android/repair-probe-20261021/', import.meta.url);
  const source = await readFile(new URL('candidate4-anchor.xml', root), 'utf8');
  const image = await readFile(new URL('candidate4-anchor.png', root));
  const ocr = JSON.parse(await readFile(new URL('candidate4-anchor.ocr.json', root), 'utf8'));
  const s = await setup({ snapshot: async () => ({ png: image, xml: source, packageName: 'com.google.android.apps.maps', capturedAt: new Date().toISOString() }),
   swipeResults: async proof => {
    const a=proof?.ocrScrollAnchor;
    if(a && (a.nameBounds.bottom>a.ratingBounds.top || a.ratingBounds.top-a.nameBounds.bottom>90)) throw Object.assign(new Error('Invalid title geometry'),{code:'UNKNOWN_SCROLL_LAYOUT'});
   } });
  s.config.tasks[0]!.keyword='bubble tea near me';s.config.maxScreenshotsPerQuery=2;
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:async()=>ocr});
  expect(r.manifest.queries[0]!.screens).toHaveLength(2);
  expect(r.manifest.queries[0]!.stopReason).not.toBe('unknown_scroll_layout');
  expect(r.manifest.queries[0]!.listingStatus).toBe('partial');
 });
});


describe('OCR resolution provenance', () => {
 it('passes explicit scale to the recognizer, persists it and separates profiles', async () => {
  const hashes: Array<string|null> = [];
  for(const scale of [2,3]) {
   const s=await setup();s.config.ocrScale=scale;s.config.maxDisplayedResults=1;
   const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:async request=>{
    if(request.scale!==scale) throw new Error('Requested OCR resolution lost');
    return {...cardScreen('Keke')(request.png),scale};
   }});
   expect(r.manifest.queries[0]!.screens[0]!.ocr).toBeDefined();
   const artifact=r.manifest.queries[0]!.screens[0]!.ocr!;
   expect(JSON.parse(await readFile(join(s.root,artifact.relativePath),'utf8')).scale).toBe(scale);
   hashes.push(r.manifest.profileHash);
  }
  expect(hashes[0]).not.toBe(hashes[1]);
 });
 it('does not rank results when the recognizer silently used another scale', async () => {
  const s=await setup();s.config.ocrScale=3;
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([cardScreen('Keke')])});
  expect(r.manifest.queries[0]!.stopReason).toBe('ocr_scale_mismatch');
  expect(r.manifest.queries[0]!.organicRank).toBeNull();
 });
});
