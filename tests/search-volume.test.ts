import { describe, expect, it } from 'vitest';
import { planVolumes, parseVolumeResponse, mergeVolume, callVolumeTool, retryVolumePlan } from '../src/volume/sync.js';
const region={name:'New York,New York,United States',code:1023191};
const store=(id='keke')=>({storeId:id,active:true,keywords:{core:['old daily'],longTail:[]},keywordTargets:[{keyword:'restaurant',bestVariant:true},{keyword:'卤味'}]});
const task={location:region,language:'en' as const,keywords:['restaurant','missing']};
const hub=(items:unknown[])=>({success:true,is_error:false,call_id:'c1',content:[{type:'text',text:JSON.stringify({status_code:20000,items})}]});
describe('independent search volume sync',()=>{
 it('deduplicates shared regional queries, includes daily and best words, separates language and skips inactive stores',()=>{
  const plan=planVolumes([store(),store('other'),{...store('off'),active:false}],{keke:region,other:region});
  expect(plan.tasks).toHaveLength(2);
  expect(plan.tasks.find(t=>t.language==='en')?.keywords).toEqual(['best restaurant','old daily','restaurant']);
  expect(plan.tasks.find(t=>t.language==='zh_CN')?.keywords).toEqual(['卤味']);
  expect(plan.stores).toHaveLength(2);
 });
 it('never silently defaults an unconfigured store to US',()=>{
  const p=planVolumes([store(),store('other')],{other:region});expect(p.skipped).toEqual(['keke']);expect(p.stores.map(s=>s.storeId)).toEqual(['other']);
 });
 it('preserves zero and missing separately; stores monthly history and actual period',()=>{
  const rows=parseVolumeResponse(hub([{keyword:'restaurant',location_code:1023191,search_volume:0,monthly_searches:{'2026-09':0,'2026-08':10}},{keyword:'missing',location_code:1023191}]),task,'2026-11-12T00:00:00Z');
  expect(rows[0]).toMatchObject({value:0,status:'available',dataThrough:'2026-09',locationName:region.name});
  expect(rows[1]).toMatchObject({value:null,status:'no_data'});
 });
 it.each([
  {success:false}, hub([{keyword:'restaurant',location_code:2840,search_volume:10}]),
  hub([{keyword:'restaurant',location_code:1023191,search_volume:-1}]),
  hub([{keyword:'restaurant',location_code:1023191,search_volume:10},{keyword:'RESTAURANT',location_code:1023191,search_volume:20}]),
  hub([{keyword:'restaurant',location_code:1023191,search_volume:10,monthly_searches:{'2026-99':10}}]),
 ])('rejects errors, wrong geography, malformed metrics and ambiguous matches',data=>{
  expect(()=>parseVolumeResponse(data,task,'2026-11-12T00:00:00Z')).toThrow();
 });
 it('keeps last good value on failed/no-data refresh only for the same region and language',()=>{
  const old=parseVolumeResponse(hub([{keyword:'restaurant',location_code:1023191,search_volume:10},{keyword:'missing',location_code:1023191}]),task,'2026-11-01T00:00:00Z')[0]!;
  const missing=parseVolumeResponse(hub(task.keywords.map(keyword=>({keyword,location_code:1023191}))),task,'2026-11-12T00:00:00Z')[0]!;
  expect(mergeVolume(old,missing)).toMatchObject({value:10,syncedAt:'2026-11-01T00:00:00Z',lastAttemptStatus:'no_data',attemptedAt:'2026-11-12T00:00:00Z'});
  expect(mergeVolume(old,{...missing,locationCode:2})).toMatchObject({value:null});
 });
 it('calls only the core-ai MCP bridge with a bounded timeout and no automatic paid retry',async()=>{
  const requests:{url:string;body:any;auth:string|null}[]=[];
  const fetcher:typeof fetch=async(input,init)=>{requests.push({url:String(input),body:JSON.parse(String(init?.body)),auth:new Headers(init?.headers).get('authorization')});return new Response(JSON.stringify(hub([])),{status:200});};
  await callVolumeTool('https://core.example','secret',task,fetcher);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe('https://core.example/api/mcp-hub/tools/dataforseo/kw_data_google_ads_search_volume/call');
  expect(JSON.parse(requests[0]!.body.arguments)).toEqual({keywords:task.keywords,location_name:region.name,language_code:'en'});
  expect(requests[0]!.body.timeout_seconds).toBe(180);
 });
});

it('retries errors and changed language only, preserving recent checked outcomes and provenance',()=>{
 const plan=planVolumes([store()],{keke:region});
 const old=parseVolumeResponse(hub([{keyword:'restaurant',location_code:1023191,search_volume:10},{keyword:'old daily',location_code:1023191},{keyword:'best restaurant',location_code:1023191}]),{...task,keywords:['restaurant','old daily','best restaurant']},'2026-11-12T00:00:00Z');
 const next=retryVolumePlan(plan,[{runId:'original',rows:old}],new Date('2026-11-12T00:30:00Z'));
 expect(next.tasks).toHaveLength(1);expect(next.tasks[0]!.language).toBe('zh_CN');
 expect(next.reused).toHaveLength(3);expect(next.reused[0]!.sourceRunId).toBe('original');
 expect(next.reused[0]!.row.syncedAt).toBe('2026-11-12T00:00:00Z');
 expect(retryVolumePlan(plan,[{runId:'old',rows:old}],new Date('2026-11-14T00:00:00Z')).reused).toEqual([]);
 expect(retryVolumePlan(plan,[{runId:'future',rows:old}],new Date('2026-11-11T00:00:00Z')).reused).toEqual([]);
 expect(retryVolumePlan(plan,[{runId:'failed',rows:old.map(r=>({...r,lastAttemptStatus:'error' as const}))}],new Date('2026-11-12T00:30:00Z')).reused).toEqual([]);
});
it('rejects the live invalid language error instead of turning it into no-data',()=>{
 expect(()=>parseVolumeResponse({success:true,is_error:false,content:[{type:'text',text:"Error: API Error: Invalid Field: 'language_code'. (Code: 40501)"}]},task,'2026-11-12T00:00:00Z')).toThrow();
});

it('uses at most 10 words per call because the connected MCP caps returned items',()=>{
 const p=planVolumes([{...store(),keywords:{core:Array.from({length:31},(_,i)=>'word '+i),longTail:[]},keywordTargets:[]}],{keke:region});
 expect(p.tasks.map(t=>t.keywords.length)).toEqual([10,10,10,1]);
});
it('rejects truncated responses and never interprets missing items as no-data',()=>{
 expect(()=>parseVolumeResponse(hub([{keyword:'restaurant',location_code:1023191,search_volume:10}]),task,'2026-11-12T00:00:00Z')).toThrow('coverage');
 const rows=parseVolumeResponse(hub(task.keywords.map(keyword=>({keyword,location_code:1023191}))),task,'2026-11-12T00:00:00Z');
 expect(rows.every(r=>r.providerItemReturned===true&&r.status==='no_data')).toBe(true);
 expect(retryVolumePlan(planVolumes([store()],{keke:region}),[{runId:'legacy',rows:rows.map(r=>({...r,providerItemReturned:undefined}))}],new Date('2026-11-12T01:00:00Z')).reused).toEqual([]);
});
it('does not start a paid request without enough remaining runtime to finish it',async()=>{
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;return new Response('{}');};
 await expect(callVolumeTool('https://core.example','secret',task,fetcher,Date.now()+1000)).rejects.toThrow('runtime budget');
 expect(calls).toBe(0);
});
it('splits only unresolved recovery queries into single-word calls when explicitly requested',()=>{
 const p=planVolumes([{...store(),keywords:{core:['a','b','c'],longTail:[]},keywordTargets:[]}],{keke:region});
 const rows=parseVolumeResponse(hub([{keyword:'a',location_code:1023191,search_volume:10}]),{...task,keywords:['a']},'2026-11-12T00:00:00Z');
 const r=retryVolumePlan(p,[{runId:'previous',rows}],new Date('2026-11-12T01:00:00Z'),true);
 expect(r.tasks.map(t=>t.keywords)).toEqual([['b'],['c']]);expect(r.reused).toHaveLength(1);
});
