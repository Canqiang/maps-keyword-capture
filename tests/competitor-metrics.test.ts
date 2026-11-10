import { expect, it } from 'vitest';
import { createCompetitorMetricsModel } from '../src/web/competitor-metrics.js';
import type { competitorHistory } from '../src/web/competitors.js';
type Row=ReturnType<typeof competitorHistory>['rows'][number];
const model=createCompetitorMetricsModel();
function row(pointId:string,rank:number|null,extra:Partial<Row>={}):Row{return {
 observationId:pointId,observedAt:'2026-11-10T00:00:00Z',localDate:'2026-11-09',pointId,parentScanId:'scan_one',scopeKey:'store/web/tea',profile:'gps',metricEligible:true,organicCoverage:15,endOfResults:false,cohortKey:pointId,geography:'unverified',eligible:true,completeListingIndex:true,indexedListings:15,listingsObserved:15,
 values:rank===null?[]:[{placeId:'ChIJRival',organicRank:rank,adDisplayPositions:[]}],...extra};}
it('computes competitor SoLV and ARP from scoped points but withholds unsupported ATRP',()=>{
 const [r]=model.rounds([row('a',1),row('b',5),row('c',null)],['a','b','c'],['ChIJRival']);
 expect(r!.values[0]).toMatchObject({arp:3,atrp:null,points:{solv:3,arp:2,atrp:2}});
 expect(r!.values[0]!.solv).toBeCloseTo(100/3);
});
it('requires full scope and organic depth for ATRP, never treats ads as rank',()=>{
 const a=row('a',null,{organicCoverage:20,values:[{placeId:'ChIJRival',organicRank:null,adDisplayPositions:[1]}]});
 expect(model.rounds([a],['a'],['ChIJRival'])[0]!.values[0]).toMatchObject({solv:0,arp:null,atrp:21});
 expect(model.rounds([row('a',2)],['a','b'],['ChIJRival'])[0]!.values[0]!.atrp).toBeNull();
});
it('does not invent absence for truncated historical competitor indexes',()=>{
 const [r]=model.rounds([row('a',null,{completeListingIndex:false})],['a'],['ChIJRival']);
 expect(r!.values[0]).toMatchObject({solv:null,arp:null,atrp:null});
});
it('binds rounds to parent receipts, refuses mixed profiles and incomplete pages',()=>{
 const unknown=model.rounds([row('a',1,{parentScanId:null})],['a'],['ChIJRival']);
 expect(unknown[0]).toMatchObject({reason:'无法确认所属采集轮次',values:[{solv:null,arp:null,atrp:null}]});
 expect(model.rounds([row('a',1),row('b',2,{parentScanId:'scan_two'})],['a','b'],['ChIJRival'])).toHaveLength(2);
 expect(model.rounds([row('a',1),row('b',2,{profile:'old'})],['a','b'],['ChIJRival'])[0]!.values[0]!.solv).toBeNull();
 expect(model.rounds([row('a',1)],['a'],['ChIJRival'],false)[0]!.values[0]!.solv).toBeNull();
});

it('keeps a later unknown receipt as a gap instead of reverting to earlier success',()=>{
 const rounds=model.rounds([row('a',1),row('a',2,{observationId:'later',parentScanId:null,observedAt:'2026-11-10T01:00:00Z'})],['a'],['ChIJRival']);
 expect(rounds).toHaveLength(2);expect(rounds.at(-1)!.values[0]!.solv).toBeNull();
 expect(rounds.at(-1)!.reason).toBe('无法确认所属采集轮次');
});
it('uses latest failed attempt and encodes scope/quality changes in metric cohorts',()=>{
 const first=row('a',1),failed=row('a',null,{observationId:'bad',observedAt:'2026-11-10T00:01:00Z',eligible:false,metricEligible:false});
 expect(model.rounds([first,failed],['a'],['ChIJRival'])[0]!.values[0]!.solv).toBeNull();
 const full=model.rounds([first,row('b',2)],['a','b'],['ChIJRival'])[0]!;
 const partial=model.rounds([first],['a','b'],['ChIJRival'])[0]!;
 expect(full.values[0]!.cohorts.solv).not.toBe(partial.values[0]!.cohorts.solv);
});
