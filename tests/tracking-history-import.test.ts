import { describe, expect, it } from 'vitest';
import { planHistoryImport, type HistoryArchive } from '../src/web/history-import.js';
import type { RankObservation } from '../src/domain/model.js';
import type { StoredStore } from '../src/domain/repository.js';

const store = {storeId:'historic',placeId:'ChIJhistoric',active:true,center:null} as StoredStore;
const row = {observationId:'capture-id',storeId:store.storeId,placeId:store.placeId,surface:'android',pointId:'r+2c-2',observedAt:'2026-10-20T12:00:00Z',scanId:'scan',queryId:'q1',keywordKey:'one',rank:{status:'unreliable'}} as RankObservation;
const source: HistoryArchive={stores:[store],observations:[row]};
describe('append-only historical import plan',()=>{
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
