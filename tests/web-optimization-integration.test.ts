import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHandler } from '../src/web/server.js';
import { createBasicAuth } from '../src/web/auth.js';
import { parseTrackingConfig } from '../src/domain/tracking-config.js';
import { MemoryTrackingRepository } from '../src/domain/repository.js';
import type { RankObservation } from '../src/domain/model.js';
const config=parseTrackingConfig(JSON.parse(await readFile(new URL('../docs/tracking-config.example.json',import.meta.url),'utf8')));
const store={...config.stores[0]!,fixedPoints:[{id:'fixed-center',label:'中心',latitude:config.stores[0]!.center.latitude,longitude:config.stores[0]!.center.longitude,distanceKm:0,direction:'center',sourceReference:'local-test'}]};
const rows:RankObservation[]=Array.from({length:4},(_,i)=>({observationId:'obs'+i,surface:'web',storeId:store.storeId,placeId:store.placeId,keyword:'tea',keywordKey:'tea',keywordTier:'core',pointId:'fixed-center',point:{...store.center,distanceKm:0,ring:'inner',zoom:15},locationMode:'map_view',observedAt:'2026-11-10T'+String(6+i*2).padStart(2,'0')+':00:00Z',localDate:'2026-11-10',scanId:'scan'+i,queryId:'q',rank:{status:'ranked',organicRank:4-i,displayPosition:4-i,listingsObserved:2,listingStatus:'captured',stopReason:'end_of_results'},quality:{rankingReliable:true,sequenceVerified:true,classificationComplete:true,screenshotCoverageComplete:true,identityResolved:true,organicCoverage:2,endOfResults:true,resultSurface:'results_list',geographicRelevance:null,warnings:[]},topListings:[{placeId:store.placeId,name:store.name,organicRank:4-i,displayPosition:4-i,resultType:'organic',rating:4.7,reviewCount:null,distanceText:null},{placeId:'ChIJRival',name:'Nearby Tea',organicRank:2+i,displayPosition:2+i,resultType:'organic',rating:4.8,reviewCount:100,distanceText:null}],evidence:{manifestKey:'tracking/web/2026-11-10/point/scan_parent'+i+'/store/fixed-center/001/scan'+i+'/att/manifest.json',resultKey:null,screenshotKeys:[]},source:{profileHash:'p',adapterVersion:'v6'},ingestedAt:'2026-11-10T16:00:00Z'}));
let server:Server,browser:Browser,base:string,reads=0;const hits:string[]=[];
const auth=createBasicAuth('test','local-only')!;
const headers={authorization:'Basic '+Buffer.from('test:local-only').toString('base64')};
beforeAll(async()=>{
 const repo=new MemoryTrackingRepository(rows);await repo.saveStore(store);
 server=createServer((req,res)=>{hits.push(req.url||'');void createHandlerOnce(req,res);});
 const createHandlerOnce=createHandler({config,repo,auth,readOnly:true,evidence:{get:async()=>{reads++;return Buffer.from('test-image');}}});
 server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
 browser=await chromium.launch({channel:'chromium',headless:true});
});
afterAll(async()=>{await browser?.close();if(server)await new Promise<void>(r=>server.close(()=>r()));});
it('authenticates conditional image requests and sends 304 without re-reading Azure',async()=>{
 const url=base+'/api/evidence?key=tracking/web/shot.png';
 const first=await fetch(url,{headers});expect(first.status).toBe(200);expect(first.headers.get('cache-control')).toBe('private, no-cache');
 const etag=first.headers.get('etag')!;await first.arrayBuffer();
 const second=await fetch(url,{headers:{...headers,'if-none-match':etag}});expect(second.status).toBe(304);expect(await second.text()).toBe('');expect(reads).toBe(1);
 const denied=await fetch(url,{headers:{'if-none-match':etag}});expect(denied.status).toBe(401);expect(reads).toBe(1);
});
it('serves bounded competitor pages with cursor scope and no image payload',async()=>{
 const path=base+'/api/stores/'+store.storeId+'/competitors?surface=web&point=fixed-center&keyword=tea&from=2026-11-10&to=2026-11-10&limit=2';
 const first=await(await fetch(path,{headers})).json();expect(first.rows).toHaveLength(2);expect(first.complete).toBe(false);expect(JSON.stringify(first)).not.toContain('screenshotKeys');
 const second=await(await fetch(path+'&cursor='+first.nextCursor,{headers})).json();expect(second.rows).toHaveLength(2);expect(second.complete).toBe(true);
 expect((await fetch(path.replace('keyword=tea','keyword=coffee')+'&cursor='+first.nextCursor,{headers})).status).toBe(400);
});
it('renders and switches competitor selections, reuses data and loads no images for trends',async()=>{
 const context=await browser.newContext({httpCredentials:{username:'test',password:'local-only'},viewport:{width:1440,height:1000}});
 await context.addCookies([{name:auth.cookieName,value:auth.issueSession(),url:base}]);
 const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/#competitors/'+store.storeId+'?surface=web&point=fixed-center&keyword=tea&from=2026-11-10&to=2026-11-10&metric=rank&scope=one');
 await page.waitForSelector('#competitor-chart circle',{timeout:5000}).catch(async e=>{throw Error(JSON.stringify({errors,body:await page.locator('body').innerText(),hits})+' '+e.message);});
 expect(await page.locator('#competitor-data').innerText()).toContain('Nearby Tea');expect(await page.locator('#competitor-chart circle').count()).toBe(8);
 const before=hits.filter(x=>x.includes('/competitors?')).length;
 await page.locator('#competitor-data details summary').click();
 await page.locator('[data-competitor="ChIJRival"]').uncheck();expect(await page.locator('#competitor-chart circle').count()).toBe(4);
 expect(hits.filter(x=>x.includes('/competitors?')).length).toBe(before);
 const beforeStore=hits.filter(x=>x===('/api/stores/'+store.storeId)).length;
 await page.evaluate(()=>{location.hash=location.hash+'&extra=1';});await page.waitForSelector('#competitor-chart circle');
 expect(hits.filter(x=>x===('/api/stores/'+store.storeId)).length).toBe(beforeStore);
 expect(await page.locator('#app img').count()).toBe(0);expect(errors).toEqual([]);
 await page.setViewportSize({width:390,height:844});expect(await page.locator('#competitor-apply').isVisible()).toBe(true);
 await context.close();
});

it('switches SoLV, ARP, ATRP, daily rounds and bars without refetching or loading screenshots',async()=>{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addCookies([{name:auth.cookieName,value:auth.issueSession(),url:base}]);
 const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/#competitors/'+store.storeId+'?surface=web&point=fixed-center&keyword=tea&from=2026-11-10&to=2026-11-10');
 await page.waitForSelector('#competitor-chart circle');
 expect(await page.locator('#competitor-data').innerText()).toContain('固定点样本');
 const count=hits.filter(x=>x.includes('/competitors?')).length;
 await page.locator('[data-metric="arp"]').click();expect(await page.locator('#competitor-chart svg').getAttribute('aria-label')).toContain('ARP');
 await page.locator('[data-metric="atrp"]').click();expect(await page.locator('#competitor-chart circle').count()).toBe(8);
 await page.locator('[data-range="daily"]').click();expect(await page.locator('#competitor-chart circle').count()).toBe(2);
 await page.locator('[data-graph="bar"]').click();expect(await page.locator('#competitor-chart rect').count()).toBe(2);
 await page.locator('[data-range="all"]').click();await page.locator('[data-graph="line"]').click();await page.locator('[data-metric="solv"]').click();
 expect(hits.filter(x=>x.includes('/competitors?')).length).toBe(count);expect(await page.locator('#app img').count()).toBe(0);expect(errors).toEqual([]);
 const output=process.env.MAPS_UI_REVIEW_DIR;
 if(output){await mkdir(output,{recursive:true});await page.locator('#competitor-data h2').evaluate(el=>{el.textContent='竞品变化趋势 · 模拟数据预览';});await page.locator('#competitor-data').screenshot({path:output+'/competitors-desktop.png'});}
 await page.setViewportSize({width:390,height:844});expect(await page.locator('[data-metric="solv"]').isVisible()).toBe(true);
 if(output)await page.screenshot({path:output+'/competitors-mobile.png',fullPage:true});
 await context.close();
});

it('switches an aggregate view with a legacy URL point to an actually loaded fixed point',async()=>{
 const context=await browser.newContext();await context.addCookies([{name:auth.cookieName,value:auth.issueSession(),url:base}]);
 const page=await context.newPage();
 await page.goto(base+'/#competitors/'+store.storeId+'?surface=web&point=legacy-unloaded&scope=all&keyword=tea&from=2026-11-10&to=2026-11-10');
 await page.waitForSelector('#competitor-chart circle');await page.locator('[data-metric="rank"]').click();
 expect(await page.locator('#competitor-chart circle').count()).toBe(8);
 expect(await page.locator('#competitor-data').innerText()).toContain('当前只显示 fixed-center');
 await context.close();
});
