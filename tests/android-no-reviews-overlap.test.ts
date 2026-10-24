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

const separatorRoot=new URL('./fixtures/android/no-review-separators-20261024/',import.meta.url);
const separatorFrame=(n:number)=>parseScreenFrame(JSON.parse(readFileSync(new URL(`keke-${n}.ocr.json`,separatorRoot),'utf8')),'braised food flushing',`f${n}`,'time',readFileSync(new URL(`keke-${n}.xml`,separatorRoot),'utf8'));
describe('actual v31 clipped no-review separator variation',()=>{
 it('joins the same zero-review occurrence despite dot versus hyphen separators',()=>{
  const a=separatorFrame(44),b=separatorFrame(45);a.topStateVerified=true;
  expect(a.cards[0]!.ratingLineText).not.toBe(b.cards[0]!.ratingLineText);
  const r=reconcileScreenFrames([a,b],20);expect(r).toMatchObject({rankingReliable:true,sequenceVerified:true,unknownCount:0,organicCount:2});
  expect(r.listings.map(l=>l.name)).toEqual(['Ji You Braised Food','JiBeiChuan Noodles(Flushing)']);expect(r.listings[0]).toMatchObject({rating:null,reviewCount:0,organicRank:1,frameIds:['f44','f45']});
 });
 it.each(['decimal changed','decimal punctuation','extra token','no anchor','ad conflict'])('does not repair content or evidence mismatch: %s',kind=>{
  const a=separatorFrame(44),b=separatorFrame(45);a.topStateVerified=true;
  if(kind==='decimal changed')b.cards[0]!.ratingLineText=b.cards[0]!.ratingLineText.replace('0.6','0.8');
  if(kind==='decimal punctuation')b.cards[0]!.ratingLineText=b.cards[0]!.ratingLineText.replace('0.6','0-6');
  if(kind==='extra token')b.cards[0]!.ratingLineText+=' - Sponsored';
  if(kind==='no anchor'){a.cards.pop();b.cards.pop();a.anchors=[];b.anchors=[];}
  if(kind==='ad conflict')a.cards[0]!.resultType='ad';
  expect(reconcileScreenFrames([a,b],20).rankingReliable).toBe(false);
 });
});
