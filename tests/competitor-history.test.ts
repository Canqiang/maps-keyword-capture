import { describe, it, expect } from 'vitest';
import { competitorHistory } from '../src/web/competitors.js';
import type { RankObservation } from '../src/domain/model.js';
function row(extra: Partial<RankObservation> = {}): RankObservation {
  return { observationId:'id',surface:'web',storeId:'s',placeId:'ChIJOwn',keyword:'tea',keywordKey:'tea',keywordTier:'core',pointId:'center',point:{latitude:40,longitude:-73,zoom:15,distanceKm:0,ring:'inner'},locationMode:'map_view',observedAt:'2026-11-10T00:00:00Z',localDate:'2026-11-09',scanId:'scan',queryId:'q',
  rank:{status:'not_found',organicRank:null,displayPosition:null,listingsObserved:15,listingStatus:'captured',stopReason:'limit_reached'},
  quality:{rankingReliable:true,sequenceVerified:true,classificationComplete:true,screenshotCoverageComplete:true,identityResolved:true,organicCoverage:15,endOfResults:false,resultSurface:'results_list',geographicRelevance:null,warnings:[]},
  topListings:[{placeId:'ChIJRival',name:'Rival',organicRank:1,displayPosition:1,resultType:'organic',rating:4.5,reviewCount:null,distanceText:null}],
  evidence:{manifestKey:null,resultKey:null,screenshotKeys:[]},source:{profileHash:'p',adapterVersion:'v6'},ingestedAt:'now',...extra};
}
describe('competitor history',()=>{
 it('retains observed rival ranks and marks old truncated listings without invented absence',()=>{
  const result=competitorHistory([row()]);
  expect(result.businesses.find(b=>b.placeId==='ChIJRival')).toMatchObject({placeId:'ChIJRival',name:'Rival'});
  expect(result.rows[0]).toMatchObject({completeListingIndex:false,geography:'unverified'});
  expect(result.rows[0]!.values[0]).toMatchObject({placeId:'ChIJRival',organicRank:1,adDisplayPositions:[]});
 });
 it('separates ads and organic appearances and leaves unknown identities out',()=>{
  const base=row();base.topListings.push({...base.topListings[0]!,resultType:'ad',organicRank:null,displayPosition:2});base.topListings.push({...base.topListings[0]!,placeId:null});
  const result=competitorHistory([base]);expect(result.businesses.filter(b=>b.placeId!=='ChIJOwn')).toHaveLength(1);
  expect(result.rows[0]!.values[0]).toMatchObject({organicRank:1,adDisplayPositions:[2]});
 });
 it('suppresses unreliable numerical ranks and keeps cohort changes separate',()=>{
  const base=row();const invalid=row({observationId:'bad',quality:{...base.quality!,rankingReliable:false}});
  const result=competitorHistory([base,invalid,row({source:{profileHash:'new',adapterVersion:'v6'}})]);
  expect(result.rows[1]!.values[0]!.organicRank).toBeNull();expect(result.rows[1]!.eligible).toBe(false);
  expect(result.rows[0]!.cohortKey).not.toEqual(result.rows[2]!.cohortKey);
 });
 it('only declares complete identity index when every captured listing is retained and identified',()=>{
  const base=row();base.rank.listingsObserved=1;expect(competitorHistory([base]).rows[0]!.completeListingIndex).toBe(true);
  base.topListings[0]!.placeId=null;expect(competitorHistory([base]).rows[0]!.completeListingIndex).toBe(false);
 });
});

import { createCompetitorPresentation } from '../src/web/competitor-view.js';
it('does not label truncated advertisement history as ad-only',()=>{
 const base=row();base.topListings[0]={...base.topListings[0]!,resultType:'ad',organicRank:null};
 const data=competitorHistory([base]);
 expect(createCompetitorPresentation().valueLabel(data.rows[0]!,'ChIJRival')).toBe('已见广告 1 · 自然结果未知');
});
it('preserves own qualified rank outside the old ten-listing index',()=>{
 const base=row();base.rank={...base.rank,status:'ranked',organicRank:13};
 expect(competitorHistory([base]).rows[0]!.values.find(v=>v.placeId==='ChIJOwn')?.organicRank).toBe(13);
});
