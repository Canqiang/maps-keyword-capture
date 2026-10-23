import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {parseScreenFrame,anchoredContinuity,reconcileScreenFrames} from '../src/android/screen-reader.js';
const root=new URL('./fixtures/android/clipped-rating-20261023/',import.meta.url);
function pair(){return [37,38].map(n=>parseScreenFrame(JSON.parse(readFileSync(new URL(`frame-0${n}.ocr.json`,root),'utf8')),'braised food flushing',`frame-${n}`,'2026-10-23',readFileSync(new URL(`frame-0${n}.xml`,root),'utf8')));}
describe('clipped first title with an incoming second merchant',()=>{
 it('requires exact independent quote motion and matching normalized rating, retaining old verified identity',()=>{
  const [a,b]=pair();expect(anchoredContinuity(a,b!)).toBe(-381);
  const r=reconcileScreenFrames([a!,b!],20);expect(r.warnings).toEqual(['list_top_unverified']);expect(r.listings).toHaveLength(2);expect(r.listings[0]!.frameIds).toHaveLength(2);expect(r.listings[0]!.resultType).toBe('organic');
 });
 it.each(['missing-quote','quote-motion','changed-rating','changed-price','changed-distance','duplicate-rating','new-card-was-visible','not-clipped','prior-unknown','uncertain-ad','rating-not-at-top','title-still-visible'])('rejects insufficient evidence: %s',variant=>{
  const [a,b]=pair(),x=a!.cards[0]!,y=b!.cards[0]!,z=b!.cards[1]!;
  if(variant==='missing-quote')b!.anchors=b!.anchors!.filter(v=>!v.text.startsWith('"we were craving'));
  if(variant==='quote-motion'){const v=b!.anchors!.find(v=>v.text.startsWith('"we were craving'))!;v.bounds.top+=30;v.bounds.bottom+=30;}
  if(variant==='changed-rating')y.rating=4.2;
  if(variant==='changed-price')y.priceText='$20–30';
  if(variant==='changed-distance')y.distanceText='0.8 mi';
  if(variant==='duplicate-rating'){z.rating=y.rating;z.reviewCount=y.reviewCount;}
  if(variant==='new-card-was-visible'){z.nameBounds!.top-=180;z.nameBounds!.bottom-=180;}
  if(variant==='not-clipped')y.warnings=[];
  if(variant==='prior-unknown')x.resultType='unknown';
  if(variant==='uncertain-ad')b!.warnings.push('native_ad_evidence_unresolved');
  if(variant==='rating-not-at-top'){y.ratingBounds!.top+=30;y.ratingBounds!.bottom+=30;}
  if(variant==='title-still-visible'){x.nameBounds!.top+=100;x.nameBounds!.bottom+=100;}
  expect(anchoredContinuity(a,b!)).toBeNull();
 });
});
