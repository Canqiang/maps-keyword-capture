import { describe, expect, it } from 'vitest';
import { planHistoryImport, readHistoryObservations, type HistoryArchive } from '../src/web/history-import.js';
import { observationId, type RankObservation } from '../src/domain/model.js';
import type { StoredStore } from '../src/domain/repository.js';

const store = {storeId:'historic',placeId:'ChIJhistoric',active:true,center:null} as StoredStore;
const row = {observationId:'capture-id',storeId:store.storeId,placeId:store.placeId,surface:'android',pointId:'r+2c-2',observedAt:'2026-10-20T12:00:00Z',scanId:'scan',queryId:'q1',keywordKey:'one',rank:{status:'unreliable'}} as RankObservation;
const source: HistoryArchive={stores:[store],observations:[row]};
describe('append-only historical import plan',()=>{
 it('reads bounded batches through the existing primary key without creating an index',async()=>{
  const incoming=Array.from({length:501},(_,i)=>({...row,observationId:`capture-${i}`}));
  const existing={...incoming[500]!,pointId:'conflicting-point'};
  const batches:number[]=[];
  const collection={find:(filter:Record<string,{$in:string[]}>)=>{
   if(!filter._id)throw Object.assign(new Error('NoQueryExecutionPlans'),{code:291});
   const ids=filter._id.$in;batches.push(ids.length);
   return {toArray:async()=>ids.includes(existing.observationId)?[existing]:[]};
  }} as unknown as Parameters<typeof readHistoryObservations>[0];
  const found=await readHistoryObservations(collection,incoming);
  expect(batches).toEqual([500,2]); // 501 exact IDs plus their shared legacy ID.
  expect(planHistoryImport({stores:[store],observations:incoming},{stores:[store],observations:found}).conflicts).toEqual(['observation identity conflict: capture-500']);
 });
 it('retains exact history identities and null coordinates, adding stores paused',()=>{
  const plan=planHistoryImport(source,{stores:[],observations:[]});
  expect(plan.conflicts).toEqual([]);
  expect(plan.insertStores).toEqual([{...store,active:false}]);
  expect(plan.insertObservations[0]).toBe(row);
  expect(source.stores[0]?.active).toBe(true);
 });
 it('is idempotent and does not replace existing richer metadata or catalog settings',()=>{
  const existing={stores:[{...store,active:true,name:'current catalog'}],observations:[{...row,quality:{warnings:['retained remote metadata']}} as RankObservation]};
  const plan=planHistoryImport(source,existing);
  expect(plan).toMatchObject({insertStores:[],insertObservations:[],preservedObservations:1,preservedPayloadDifferences:1,conflicts:[]});
  expect(existing.observations[0]?.quality?.warnings).toEqual(['retained remote metadata']);
 });
 it('rejects both reused IDs and Place IDs that would split historical identity',()=>{
  expect(planHistoryImport(source,{stores:[{...store,placeId:'ChIJother'}],observations:[]}).conflicts).toHaveLength(1);
  expect(planHistoryImport(source,{stores:[{...store,storeId:'new-slug'}],observations:[]}).conflicts).toHaveLength(1);
  expect(planHistoryImport(source,{stores:[store],observations:[{...row,pointId:'keke-5km'}]}).conflicts).toHaveLength(1);
 });
 it('distinguishes harmless field order from a contradictory recorded coordinate',()=>{
  const point={latitude:40,longitude:-73,distanceKm:0,ring:'inner'} as const;
  const withPoint={...row,point};
  expect(planHistoryImport({stores:[store],observations:[withPoint]},{stores:[store],observations:[{...withPoint,point:{longitude:-73,latitude:40,ring:'inner',distanceKm:0}}]}).preservedPayloadDifferences).toBe(0);
  expect(planHistoryImport({stores:[store],observations:[withPoint]},{stores:[store],observations:[{...withPoint,point:{...point,latitude:41}}]}).conflicts).toHaveLength(1);
 });
});

function legacyPair() {
 const manifestKey='tracking/web/2026-10-20/point/scan_parent/historic/r0c0/001/run_capture/att_one/manifest.json';
 const result='q0001/qa01/result.json',prefix=manifestKey.slice(0,-'manifest.json'.length);
 const archived={...row,surface:'web',keyword:'one',pointId:'r0c0',scanId:'run_capture',queryId:'q0001',locationMode:'map_view',
  point:{latitude:40,longitude:-73,distanceKm:null,ring:null,zoom:15},
  source:{adapterVersion:'maps-feed-card/v6',profileHash:'profile',attemptId:'att_one',queryAttemptId:'qa01'},
  evidence:{manifestKey,resultKey:prefix+result,screenshotKeys:[prefix+'q0001/qa01/shot.png']},
  rank:{status:'ranked',organicRank:4}} as RankObservation;
 archived.observationId=observationId(archived);
 const retained={...archived,observationId:`web|historic|one|r0c0|${archived.observedAt}`,
  point:{latitude:40,longitude:-73,distanceKm:0,ring:'inner'},
  source:{adapterVersion:'maps-feed-card/v6',profileHash:'profile'},
  evidence:{...archived.evidence,resultKey:result}} as RankObservation;
 return {archived,retained};
}
const aliasPlan=(archived:RankObservation[],retained:RankObservation[])=>planHistoryImport({stores:[store],observations:archived},{stores:[store],observations:retained});

describe('legacy source-capture aliases',()=>{
 it('keeps the stored row and unchanged archive, records an explicit receipt, and is idempotent',()=>{
  const {archived,retained}=legacyPair(),before=JSON.stringify({archived,retained});
  const plan=aliasPlan([archived],[retained]);
  expect(plan).toMatchObject({conflicts:[],insertObservations:[],preservedObservations:0});
  expect(plan.aliases).toEqual([expect.objectContaining({archivedId:archived.observationId,retainedId:retained.observationId,manifestKey:archived.evidence.manifestKey,resultKey:archived.evidence.resultKey,payloadDifference:true})]);
  expect(plan.aliases[0]?.archivedPayloadSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(plan.aliases[0]?.retainedPayloadSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify({archived,retained})).toBe(before);
  expect(aliasPlan([archived],[retained]).aliases).toEqual(plan.aliases);
 });
 it('queries the possible legacy row by primary key, not an unindexed semantic scan',async()=>{
  const {archived,retained}=legacyPair();
  const calls:unknown[]=[];
  const collection={find:(filter:Record<string,{$in:string[]}>)=>{calls.push(filter);return {toArray:async()=>filter._id?.$in.includes(retained.observationId)?[retained]:[]};}} as unknown as Parameters<typeof readHistoryObservations>[0];
  expect(await readHistoryObservations(collection,[archived])).toEqual([retained]);
  expect(calls).toEqual([{_id:{$in:[archived.observationId,retained.observationId]}}]);
 });
 it.each(['coordinate','zoom','scan','query','place','profile','adapter','attempt','query-attempt','manifest','result','screenshots','traversal','absolute','missing-evidence','noncanonical-id'])('blocks ambiguous or conflicting %s evidence',variant=>{
  const {archived,retained}=legacyPair();
  if(variant==='coordinate')retained.point.latitude=41;
  if(variant==='zoom')retained.point.zoom=14;
  if(variant==='scan')retained.scanId='run_other';
  if(variant==='query')retained.queryId='q0002';
  if(variant==='place')retained.placeId='ChIJother';
  if(variant==='profile')retained.source.profileHash='other';
  if(variant==='adapter')retained.source.adapterVersion='other';
  if(variant==='attempt')retained.source.attemptId='att_other';
  if(variant==='query-attempt')retained.source.queryAttemptId='qa02';
  if(variant==='manifest')retained.evidence.manifestKey=retained.evidence.manifestKey!.replace('att_one','att_other');
  if(variant==='result')retained.evidence.resultKey='q0001/qa02/result.json';
  if(variant==='screenshots')retained.evidence.screenshotKeys=['tracking/web/other.png'];
  if(variant==='traversal')retained.evidence.resultKey='q0001/qa01/../qa01/result.json';
  if(variant==='absolute')retained.evidence.resultKey='/'+archived.evidence.resultKey;
  if(variant==='missing-evidence')retained.evidence.resultKey=null;
  if(variant==='noncanonical-id')archived.observationId='v2|wrong';
  expect(aliasPlan([archived],[retained]).conflicts,variant).toHaveLength(1);
  expect(aliasPlan([archived],[retained]).insertObservations,variant).toEqual([]);
 });
 it('preserves a different interpretation of the same proven capture instead of rewriting its rank',()=>{
  const {archived,retained}=legacyPair();retained.rank={...retained.rank,organicRank:7};
  const plan=aliasPlan([archived],[retained]);
  expect(plan.conflicts).toEqual([]);expect(plan.aliases[0]?.payloadDifference).toBe(true);
  expect(retained.rank.organicRank).toBe(7);expect(archived.rank.organicRank).toBe(4);
 });
 it('does not use matching but unrelated screenshot keys to prove a capture alias',()=>{
  const {archived,retained}=legacyPair();
  archived.evidence.screenshotKeys=retained.evidence.screenshotKeys=['tracking/web/unrelated/shot.png'];
  expect(aliasPlan([archived],[retained]).conflicts).toHaveLength(1);
 });
 it('blocks two same-moment attempts that could otherwise collapse onto one old ID',()=>{
  const {archived,retained}=legacyPair(),other=structuredClone(archived);
  other.source.queryAttemptId='qa02';other.observationId=observationId(other);
  other.evidence.resultKey=other.evidence.resultKey!.replace('/qa01/','/qa02/');
  other.evidence.screenshotKeys=other.evidence.screenshotKeys.map(k=>k.replace('/qa01/','/qa02/'));
  const plan=aliasPlan([archived,other],[retained]);
  expect(plan.conflicts.length).toBeGreaterThan(0);expect(plan.aliases).toEqual([]);expect(plan.insertObservations).toEqual([]);
  // With no legacy row these are distinct versioned captures, not duplicates.
  expect(aliasPlan([archived,other],[]).insertObservations).toHaveLength(2);
 });
 it('blocks dual stored representations instead of concealing an existing double count',()=>{
  const {archived,retained}=legacyPair();
  expect(aliasPlan([archived],[archived,retained]).conflicts).toHaveLength(1);
 });
 it('fails closed for a legacy Android row without a proved selected-attempt result binding',()=>{
  const {archived,retained}=legacyPair();
  archived.surface=retained.surface='android';archived.observationId=observationId(archived);
  retained.observationId=`android|historic|one|r0c0|${archived.observedAt}`;
  archived.evidence.resultKey=retained.evidence.resultKey=null;
  expect(aliasPlan([archived],[retained]).conflicts).toHaveLength(1);
 });
});
