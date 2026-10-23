import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {parseScreenFrame,reconcileScreenFrames} from '../src/android/screen-reader.js';
const root=new URL('./fixtures/android/sheet-recovery-20261023/',import.meta.url);
const frame=(n:number)=>parseScreenFrame(JSON.parse(readFileSync(new URL(`keke-${n}.ocr.json`,root),'utf8')),'braised food flushing',`f${n}`,'time',readFileSync(new URL(`keke-${n}.xml`,root),'utf8'));
describe('explicit no-review card at clipped sheet top',()=>{
 it('keeps Ji You as one observed occurrence with null rating and zero reviews, corroborated by the next rated card',()=>{
  const a=frame(45),b=frame(46);a.topStateVerified=true;
  const r=reconcileScreenFrames([a,b],20);
  expect(r).toMatchObject({rankingReliable:true,sequenceVerified:true,organicCount:2,unknownCount:0});
  expect(r.listings).toHaveLength(2);expect(r.listings[0]).toMatchObject({name:'Ji You Braised Food',rating:null,reviewCount:0,organicRank:1,frameIds:['f45','f46']});
 });
 it.each(['not explicit','review mismatch','category changed','distance changed','next card changed','no next card','unknown next card','unrated next card','ambiguous no reviews','ad conflict','extra warning','missing geometry'])('refuses unsupported unrated overlap: %s',kind=>{
  const a=frame(45),b=frame(46);a.topStateVerified=true;
  if(kind==='not explicit')b.cards[0]!.ratingLineText='Rating unavailable - Restaurant . 0.6 mi';
  if(kind==='review mismatch')b.cards[0]!.reviewCount=null;
  if(kind==='category changed')b.cards[0]!.category='barbecue';
  if(kind==='distance changed')b.cards[0]!.distanceMeters=1200;
  if(kind==='next card changed')b.cards[1]!.name='Another merchant';
  if(kind==='no next card'){a.cards.pop();b.cards.pop();a.anchors=[];b.anchors=[];}
  if(kind==='unknown next card')b.cards[1]!.resultType='unknown';
  if(kind==='unrated next card'){a.cards[1]!.rating=null;b.cards[1]!.rating=null;}
  if(kind==='ambiguous no reviews'){a.cards.unshift(structuredClone(a.cards[0]!));}
  if(kind==='ad conflict'){a.cards[0]!.resultType='ad';a.cards[0]!.adLabel='Sponsored';}
  if(kind==='extra warning')b.cards[0]!.warnings.push('uncertain_ad_label');
  if(kind==='missing geometry')delete b.cards[0]!.ratingBounds;
  expect(reconcileScreenFrames([a,b],20).rankingReliable).toBe(false);
 });
});
