import { describe, expect, it } from 'vitest';
import { createKeywordMetricsModel } from '../src/web/keyword-metrics.js';
import type { HistoryObservation } from '../src/domain/history.js';
const m = createKeywordMetricsModel();
const q = { rankingReliable:true, sequenceVerified:true, classificationComplete:true, screenshotCoverageComplete:true, identityResolved:true, organicCoverage:15, endOfResults:false, resultSurface:'list', geographicRelevance:null, warnings:[] };
function row(pointId:string, rank:number|null, scanId='run-a', extra:Partial<HistoryObservation>={}):HistoryObservation {
  return { observationId:scanId+pointId, surface:'web', storeId:'s', placeId:'place', keyword:'tea', keywordKey:'tea', keywordTier:'core', pointId,
    point:{latitude:40,longitude:-73,distanceKm:0,ring:'inner',zoom:15}, locationMode:'map_view', observedAt:'2026-10-26T06:00:00Z', localDate:'2026-10-26', scanId, queryId:pointId,
    rank:{status:rank===null?'not_found':'ranked',organicRank:rank,displayPosition:rank,listingsObserved:15,listingStatus:'captured',stopReason:'limit_reached'}, quality:{...q}, topListings:[],
    source:{profileHash:'gps',adapterVersion:'v6'}, evidence:{manifestKey:`tracking/web/2026-10-26/point/scan_${scanId}/s/${pointId}/001/${scanId}/att/manifest.json`,resultKey:null,screenshotKeys:[]}, ingestedAt:'2026-10-26T07:00:00Z',eligible:true,metricOrganicRank:rank,cohortKey:'cohort-'+pointId,...extra };
}
const run = (rows:HistoryObservation[], points=['a','b','c'], complete=true) => m.rounds(rows,points,complete);
describe('fixed-point keyword metrics',()=>{
  it('uses Top 3 evidence for SoLV but never converts a top-15 absence into rank 21',()=>{
    const [r]=run([row('a',1),row('b',5),row('c',null)]);
    expect(r).toMatchObject({observed:3,scopePoints:3,solv:1/3,arp:3,atrp:null,solvPoints:3,arpPoints:2,atrpPoints:2});
  });
  it('computes ATRP only after every scoped point has a rank or qualified top-20 absence',()=>{
    const [r]=run([row('a',1),row('b',5),row('c',null,'run-a',{quality:{...q,organicCoverage:20}})]);
    expect(r).toMatchObject({atrp:9,atrpPoints:3});
    expect(run([row('a',null,'run-a',{quality:{...q,endOfResults:true,organicCoverage:2}})],['a'])[0]).toMatchObject({solv:0,arp:null,atrp:21});
  });
  it('does not count displayed ads as organic depth; a known non-top-three rank is still usable',()=>{
    const absent=row('a',null); absent.quality!.organicCoverage=2; absent.rank.listingsObserved=30;
    expect(run([absent],['a'])[0]).toMatchObject({solv:null,arp:null,atrp:null});
    expect(run([row('a',24)],['a'])[0]).toMatchObject({solv:0,arp:null,atrp:21});
  });
  it('keeps channel, keyword, store, scan and place identities separate',()=>{
    const rows=[row('a',1),row('a',2,'run-b'),row('a',3,'run-a',{surface:'android'}),row('a',4,'run-a',{keywordKey:'boba'}),row('a',5,'run-a',{storeId:'other'}),row('a',6,'run-a',{placeId:'other'})];
    expect(run(rows,['a'])).toHaveLength(6);
  });
  it('uses the newest attempt at a point even if it failed, and excludes legacy/grid observations',()=>{
    const failed=row('a',1,'run-a',{observationId:'failed',observedAt:'2026-10-26T06:01:00Z',rank:{...row('a',1).rank,status:'failed'}});
    expect(run([row('a',1),failed],['a'])[0]).toMatchObject({observed:1,solv:null,arp:null,atrp:null});
    expect(run([row('a',1,'legacy',{locationMode:'query_only',evidence:{manifestKey:null,resultKey:null,screenshotKeys:[]}}),row('a',1,'grid',{gridRunId:'grid'})],['a'])).toEqual([]);
  });
  it('withholds metrics for incomplete pagination and rejects mixed profiles within a round',()=>{
    expect(run([row('a',1)],['a'],false)[0]).toMatchObject({solv:null,arp:null,atrp:null});
    const changed=row('b',2,'run-a',{source:{profileHash:'old',adapterVersion:'v6'}});
    expect(run([row('a',1),changed],['a','b'])[0]).toMatchObject({solv:null,arp:null,atrp:null});
  });
  it('shows a missing-point denominator without fabricating ATRP',()=>{
    expect(run([row('a',2)])[0]).toMatchObject({observed:1,scopePoints:3,solv:1,solvPoints:1,arp:2,atrp:null});
  });
  it('joins point batches by their authoritative parent scan, never by batch runId or nearby timestamps',()=>{
    const rows=['a','b','c'].map((id,i)=>row(id,i+1,'batch-'+id,{evidence:{manifestKey:`tracking/web/2026-10-26/point/scan_parent/s/${id}/001/batch-${id}/att/manifest.json`,resultKey:null,screenshotKeys:[]}}));
    expect(run(rows)).toHaveLength(1);expect(run(rows)[0]).toMatchObject({scanId:'scan_parent',solv:1,arp:2,atrp:2,observed:3});
    const other=row('a',9,'batch-d',{evidence:{manifestKey:'tracking/web/2026-10-26/point/scan_other/s/a/001/batch-d/att/manifest.json',resultKey:null,screenshotKeys:[]}});
    expect(run([...rows,other])).toHaveLength(2);
  });
  it('retains an ingestion-shaped query_only failure as a gap and does not resurrect older success',()=>{
    const good=row('a',1),failed=row('a',null,'run-a',{locationMode:'query_only',cohortKey:null,observedAt:'2026-10-26T06:03:00Z',rank:{...good.rank,status:'failed'}});
    expect(run([good,failed],['a'])[0]).toMatchObject({solv:null,arp:null,atrp:null});
    const next={...failed,scanId:'next',evidence:{...failed.evidence,manifestKey:'tracking/web/2026-10-26/point/scan_next/s/a/001/next/att/manifest.json'}};
    expect(run([good,next],['a'])).toHaveLength(2);expect(run([good,next],['a'])[1]?.solv).toBeNull();
  });
  it('keeps qualified-point SoLV and ARP when another point failed without a location receipt',()=>{
    const failed=row('c',null,'run-a',{locationMode:'query_only',cohortKey:null,rank:{...row('c',null).rank,status:'failed'}});
    expect(run([row('a',1),row('b',5),failed])[0]).toMatchObject({observed:3,solv:.5,solvPoints:2,arp:3,arpPoints:2,atrp:null});
  });
  it('does not use unreliable identity, screenshots, geography or location provenance',()=>{
    for(const extra of [{cohortKey:null},{quality:{...q,identityResolved:false}},{quality:{...q,screenshotCoverageComplete:false}},{quality:{...q,geographicRelevance:{status:'outside'}}}]){
      expect(run([row('a',1,'run-a',extra as Partial<HistoryObservation>)],['a'])[0]?.solv).toBeNull();
    }
    expect(run([row('a',null,'run-a',{rank:{...row('a',null).rank,status:'not_evaluated'},quality:{...q,endOfResults:true}})],['a'])[0]?.atrp).toBeNull();
  });
  it('breaks lines at profile/coordinate/denominator changes, unknown rounds and missing slots',()=>{
    const rows=Array.from({length:6},(_,i)=>row('a',i+1,'run-'+i,{observedAt:`2026-10-26T${String(2*i).padStart(2,'0')}:00:00Z`}));
    rows[2]!.cohortKey='new'; rows[3]!.rank.status='failed'; rows[4]!.observedAt='2026-10-27T00:00:00Z'; rows[5]!.observedAt='2026-10-27T04:00:00Z';
    expect(m.segments(run(rows,['a']),'solv').map(x=>x.length)).toEqual([2,1,1,1]);
    expect(m.segments(run([row('a',1),row('a',1,'next',{observedAt:'2026-10-26T08:00:00Z'}),row('b',2,'next',{observedAt:'2026-10-26T08:00:00Z'})]),'solv').map(x=>x.length)).toEqual([1,1]);
  });
});
