import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { parseConfig } from '../src/config.js';
import { runQueryAttempt } from '../src/runner/query-runner.js';
import { LocalArtifactStore } from '../src/storage/local.js';
import { writeFixture, type FixtureCard } from './fixtures/feed-fixture.js';
let browser: Browser, root: string;

beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'selective-')); browser = await chromium.launch({ channel: 'chromium', headless: true }); });
afterAll(async () => { await browser?.close(); if (root) await rm(root, { recursive: true, force: true }); });
async function capture(target: number | 'ad' | 'absent' | 'unknown' | 'ad_before_ten', failImages: boolean | 'returned'=false) {
  const cards: FixtureCard[] = Array.from({length:15}, (_, i) => ({name:'Shop '+(i+1),placeId: '0x1:0x'+i+'!19s'+(target===i+1?'ChIJTarget':'ChIJOther'+i)}));
  if(target==='ad') cards[0] = {name:'Target ad', placeId:'0x1:0x0!19sChIJTarget', ad:true};
  if(target==='ad_before_ten'){cards[0]={...cards[0]!,ad:true};cards[10]={...cards[10]!,placeId:'0x1:0x10!19sChIJTarget'};}
  if(target==='unknown')cards[0]={...cards[0]!,description:'Advertisement'};
  const url = await writeFixture({query:'q', cards, endOfList:true});
  const config = parseConfig({schemaVersion:'1',keywords:['q'],outputDirectory:root, maxScrollsPerKeyword:20,
    screenshotPolicy:{mode:'target_organic_top10',targetPlaceId:'ChIJTarget'}}).config;
  let imageCalls=0;
  const openContext=browser.newContext.bind(browser);
  const spy=vi.spyOn(browser,'newContext').mockImplementation(async options=>{
    const ctx=await openContext(options);ctx.on('page',page=>{const take=page.screenshot.bind(page);vi.spyOn(page,'screenshot').mockImplementation(async options=>{imageCalls++;return take(options);});});return ctx;
  });
  const store=new LocalArtifactStore(root),write=store.writeFile.bind(store),persist=store.persist.bind(store);
  if(failImages===true)store.writeFile=async(path,data)=>{if(path.endsWith('.png'))throw Error('image storage failed');return write(path,data);};
  if(failImages==='returned')store.persist=async file=>file.relativePath.endsWith('.png')?{storageStatus:'failed',objectKey:null,verifiedAt:null,storageError:{code:'readback_mismatch',message:'test failure'}}:persist(file);
  const out = await runQueryAttempt({browser,config,store,runId:'run',attemptId:'att',attemptRelativeDir:String(target),
    metadata:{configHash:'c',profileHash:'p',adapterVersion:'test',sourceCommit:null,browserVersion:null,imageDigest:null,egressProfileId:null},
    searchUrlFor:()=>url, viewSettle:{firstBudgetMs:100,laterBudgetMs:100,intervalMs:50},
  },{queryId:'q0001',inputIndex:0,keyword:'q',queryAttemptId:'qa01',deadlineAt:Date.now()+30000,allowTransientThrow:false});
  spy.mockRestore();
  return {...out,imageCalls};
}
it.each([11,'ad','absent'] as const)('omits images for %s but preserves all 15 ranked rows', async (target) => {
  const out = await capture(target);
  expect(out.result.status).toBe('captured'); expect(out.result.listings).toHaveLength(15);
  expect(out.result.screenshots).toHaveLength(0);expect(out.imageCalls).toBe(0);
  expect(out.result.quality).toMatchObject({screenshotCoverageComplete:false,screenshotPolicy:{version:'target-organic-top10/v1',decision:'omitted_by_policy',satisfied:true}});
  expect(out.artifacts.map(a=>a.kind)).toEqual(expect.arrayContaining(['result_json','result_csv','observations_jsonl']));
},40000);
it('captures target natural rank ten and keeps unrelated ranks', async () => {
  const out = await capture(10);
  expect(out.result.status).toBe('captured'); expect(out.result.listings).toHaveLength(15);
  expect(out.result.screenshots.filter(s=>s.kind==='results')).toHaveLength(1);
  expect(out.result.listings[9]!.screenshotIds).toHaveLength(1);
  expect(out.result.quality).toMatchObject({screenshotCoverageComplete:false,screenshotPolicy:{decision:'captured',triggerRank:10,satisfied:true}});
},40000);

it('keeps bounded diagnostics when complete traversal becomes classification partial',async()=>{
 const out=await capture('unknown');
 expect(out.result).toMatchObject({status:'partial',stopReason:'classification_unknown'});
 expect(out.result.screenshots.filter(s=>s.kind==='diagnostic')).toHaveLength(1);
 expect(out.result.quality.screenshotPolicy).toMatchObject({decision:'diagnostic',satisfied:false});
});

it('counts natural rank ten independently of a preceding advertisement',async()=>{
 const out=await capture('ad_before_ten');
 expect(out.result.listings[10]).toMatchObject({displayPosition:11,organicRank:10});
 expect(out.result.quality.screenshotPolicy).toMatchObject({triggerRank:10,decision:'captured',satisfied:true});
});
it('does not accept required image persistence failure as intentional omission',async()=>{
 const out=await capture(1,true);
 expect(out.result.status).toBe('failed');expect(out.result.quality.screenshotPolicy).toMatchObject({decision:'failed',satisfied:false});
 expect(out.artifacts.map(a=>a.kind)).toEqual(expect.arrayContaining(['result_json','result_csv','observations_jsonl']));
});

it('rejects returned upload/readback failure instead of marking policy satisfied',async()=>{
 const out=await capture(1,'returned');
 expect(out.result.quality.screenshotPolicy?.satisfied).toBe(false);
 expect(out.result.status).not.toBe('captured');
 expect(out.result.screenshots.some(s=>s.storageStatus==='failed')).toBe(true);
});
