import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { parseAndroidConfig } from '../src/android/config.js';
import { runAndroidCapture, acquireDeviceLease } from '../src/android/runner.js';
import { LocalArtifactStore } from '../src/storage/local.js';
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
const pngWith=(seed:number)=>{const chunk=(type:string,data:Buffer)=>{const body=Buffer.concat([Buffer.from(type,'ascii'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(zlib.crc32(body)>>>0);const len=Buffer.alloc(4);len.writeUInt32BE(data.length);return Buffer.concat([len,body,crc]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=0;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.from([0,seed&255]))),chunk('IEND',Buffer.alloc(0))]);};
// Synthetic full-screen OCR: every screen shows the sheet header plus one card per name.
const shaOf=(buffer:Buffer)=>createHash('sha256').update(buffer).digest('hex');
const ocrLine=(text:string,top:number)=>({text,confidence:90,bounds:{left:40,top,right:600,bottom:top+30}});
const cardScreen=(...names:string[])=>(png:Buffer)=>({schemaVersion:'android-screen-ocr/v1' as const,imageSha256:shaOf(png),imageWidth:1,imageHeight:1,engine:'test',engineVersion:'synthetic',languages:'eng',scale:1,
 lines:[ocrLine('noodles x',200),...names.flatMap((name,i)=>[ocrLine(name.replace(/^AD:/,''),300+i*300),ocrLine(name.startsWith('AD:')?'4.5% (12) - Chinese':`4.6% (${20+[...name].reduce((sum,c)=>sum+c.charCodeAt(0),0)%997}) - $10-20 - Chinese`,340+i*300),ocrLine('Closed . Opens 9:30 AM - 0.2 mi',380+i*300)].concat(name.startsWith('AD:')?[ocrLine('Sponsored',270+i*300)]:[]))]});
const emptyScreen=()=>(png:Buffer)=>({schemaVersion:'android-screen-ocr/v1' as const,imageSha256:shaOf(png),imageWidth:1,imageHeight:1,engine:'test',engineVersion:'synthetic',languages:'eng',scale:1,lines:[ocrLine('noodles x',200),ocrLine('Discover through photos',400)]});
/** Returns the screens in order; the last screen repeats for any further shot. */
const recognizerFor=(screens:Array<(png:Buffer)=>any>)=>{let i=0;return async(request:{png:Buffer})=>screens[Math.min(i++,screens.length-1)]!(request.png);};

describe('native screenshot evidence runner',()=>{
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
  expect(r.manifest.queries[0]?.listings).toHaveLength(1);expect(r.manifest.queries[0]?.rankingStatus).toBe('not_found_in_prefix');
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

const fixtureXml=async(name:string,keyword='noodles')=>(await readFile(new URL(`./fixtures/android/${name}.xml`,import.meta.url),'utf8')).replaceAll('seafood buffet',keyword);

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
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([cardScreen('Crown One'),cardScreen('Crown One','KEKE BRAISED DELI'),cardScreen('KEKE BRAISED DELI','Er Hou Roast Chicken'),cardScreen('Er Hou Roast Chicken'),cardScreen('Er Hou Roast Chicken')])});
  const q=r.manifest.queries[0]!;
  expect(r.exitCode).toBe(0);expect(swipes).toBe(5);expect(q.screens).toHaveLength(6);
  expect(q.listings.map(x=>[x.displayPosition,x.organicRank,x.name])).toEqual([[1,1,'Crown One'],[2,2,'KEKE BRAISED DELI'],[3,3,'Er Hou Roast Chicken']]);
  expect(q).toMatchObject({listingStatus:'complete',stopReason:'list_end',rankingStatus:'ranked',displayPosition:2,organicRank:2,evidenceStatus:'captured'});
  expect(q.targetMatch).toEqual({displayPosition:2,organicRank:2,name:'KEKE BRAISED DELI',alias:'Keke Braised Deli'});
  expect(q.screens[0]?.ocr?.kind).toBe('ocr_json');expect(q.screens[0]?.screenFrame?.kind).toBe('screen_frame');expect(q.screens[1]?.cardsRecognized).toBe(2);
  expect(r.manifest.adapterVersion).toBe('android-screen-ocr/v4');expect(r.manifest.counts).toMatchObject({rankedQueries:1,completeListingQueries:1,listings:3,organic:3});
  const csv=await readFile(join(s.root,r.manifest.artifacts.find(x=>x.relativePath.endsWith('/listings.csv'))!.relativePath),'utf8');
  expect(csv).toContain('isTarget');expect(csv).toContain('"KEKE BRAISED DELI"');expect(csv).toContain('"0.2 mi"');
  const queries=await readFile(join(s.root,r.manifest.artifacts.find(x=>x.relativePath.endsWith('/queries.csv'))!.relativePath),'utf8');expect(queries).toContain('ranked');
  for(const a of r.manifest.artifacts){const b=await readFile(join(s.root,a.relativePath));expect(b.length).toBe(a.bytes);expect(createHash('sha256').update(b).digest('hex')).toBe(a.sha256);}
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
 it('treats an identical screenshot as list end',async()=>{
  const source=await fixtureXml('results-en');let swipes=0;const s=await setup({snapshot:async()=>({png,xml:source,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()}),swipeResults:async()=>{swipes++;}});
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([cardScreen('Crown One')])});
  expect(swipes).toBe(1);expect(r.manifest.queries[0]?.screens).toHaveLength(2);expect(r.manifest.queries[0]?.stopReason).toBe('list_end');expect(r.manifest.queries[0]?.listingStatus).toBe('complete');
 });
 it.each([['screenshot_budget',{maxScreenshotsPerQuery:2}],['scroll_budget',{maxScrolls:1}]])('retains a partial prefix at %s',async(stop,patch)=>{
  const s=await setup(await resultsSnapshot());Object.assign(s.config,patch);s.config.maxScreenshotsPerQuery=Math.min(s.config.maxScreenshotsPerQuery,3);
  const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root),{screenRecognizer:recognizerFor([cardScreen('A'),cardScreen('B'),cardScreen('C'),cardScreen('D')])});
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
  expect(ok.manifest.queries[0]?.stopReason).toBe('list_end');expect(ok.manifest.queries[0]?.listings).toHaveLength(1);
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
 it('keeps original PNG and malformed XML as diagnostics while marking query failed',async()=>{
  const malformed='<hierarchy><node>';const s=await setup({snapshot:async()=>({png,xml:malformed,packageName:'com.google.android.apps.maps',capturedAt:new Date().toISOString()})});const r=await runAndroidCapture(s.config,s.device,new LocalArtifactStore(s.root));
  expect(r.exitCode).toBe(2);expect(r.manifest.queries[0]?.error?.code).toBe('invalid_ui_xml');const shot=r.manifest.queries[0]?.screens[0];expect(shot?.role).toBe('diagnostic');expect(shot?.analysis.kind).toBe('unknown');expect((await readFile(join(s.root,shot!.png.relativePath))).equals(png)).toBe(true);
 });
});
