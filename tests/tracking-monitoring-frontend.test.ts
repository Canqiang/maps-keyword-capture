import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createFrontendModel } from '../src/web/frontend-model.js';
import { UI_HTML } from '../src/web/ui.js';

const m=createFrontendModel();
const points=[0,3,5].map(k=>({id:'keke-'+(k===0?'center':k+'km'),label:k===0?'中心':k+'km',latitude:40+k/100,longitude:-73,distanceKm:k,direction:'北',sourceReference:'approved report'}));
const store={keywords:{core:['old word'],longTail:['retired word']},fixedPoints:points,monitoringCatalog:{version:'v1',source:{documentDate:'2026-10-16'}},keywordTargets:[{keyword:'卤味 near me',sourceSearchVolumeText:'报告 100',pointTargets:points.map(p=>({pointId:p.id,targetRank:p.distanceKm===5?10:3,targetText:'Top3/10',historicalBaselineDisplay:'NR20'}))}]};
const script=UI_HTML.match(/<script>([\s\S]*)<\/script>/)![1]!;
function declaration(prefix:string){return script.split('\n').find(l=>l.startsWith(prefix))!;}
describe('approved fixed-point monitoring presentation',()=>{
 it('uses exact approved target keywords while leaving the historical keyword pool untouched',()=>{
  expect(m.activeKeywords(store)).toEqual(['卤味 near me']);
  expect(store.keywords.core).toEqual(['old word']);
  expect(m.activeKeywords({keywords:store.keywords})).toEqual(['old word','retired word']);
  expect(m.targetFor(store,'卤味 near me','keke-5km')?.targetRank).toBe(10);
  expect(m.targetFor(store,'old word','r0c0')).toBeNull();
 });
 it('keeps uncollected fixed points selectable without manufacturing observed coordinates or counts',()=>{
  const observed=[{pointId:'r0c0',point:{latitude:null,longitude:null,distanceKm:null},observations:42}];
  const choices=m.pointChoices(observed,points);
  expect(choices.map(p=>p.pointId)).toEqual(['keke-center','keke-3km','keke-5km','r0c0']);
  expect(choices[0]).toMatchObject({observations:0,planned:true,label:'中心'});
  expect(observed).toHaveLength(1);
 });
 it('defaults to the new center even when only old grid history exists, preserving explicit old selections',async()=>{
  const observed=[{pointId:'r0c0',observedTo:'2026-10-20T12:00:00Z'}];
  const run=(route:Record<string,unknown>)=>runInNewContext(declaration('async function loadStore(')+';loadStore(route,1)',{route,revision:1,api:async(path:string)=>path.includes('/points')?{points:observed}:store,dateOf:(s:string)=>s.slice(0,10),shift:()=> '2026-10-08',M:m});
  const implicit={id:'keke',point:'r0c0',pointExplicit:false,from:'',to:''};
  const result=await run(implicit);
  expect(implicit.point).toBe('keke-center');
  expect(result.points).toEqual(observed);
  const explicit={...implicit,point:'r0c0',pointExplicit:true};
  await run(explicit);expect(explicit.point).toBe('r0c0');
 });
 it('labels planned locations and historical report baselines separately from live observations',()=>{
  const html=runInNewContext(declaration('function monitoringPanel(')+';monitoringPanel(store,{surface:"android"},[])',{store,E:m.escape,when:()=>'',href:()=> '#history'});
  expect(html).toContain('固定采样点 · 3 个');
  expect(html).toContain('尚无采集');
  expect(html).toContain('报告基线：NR20');
  expect(html).toContain('Top 10');
  expect(html).toContain('卤味 near me');
  expect(html).not.toContain('retired word');
  expect(html).toContain('旧网格历史继续单独保留');
 });
});
