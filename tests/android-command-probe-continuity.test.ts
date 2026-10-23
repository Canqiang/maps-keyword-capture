import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {anchoredContinuity,parseScreenFrame,reconcileScreenFrames,type ScreenFrame} from '../src/android/screen-reader.js';
const root=new URL('./fixtures/android/command-probe-20261023/',import.meta.url);
const read=(n:number,ext:string)=>readFileSync(new URL(`keke-${n}.${ext}`,root),'utf8');
const frames=()=>[31,32].map(n=>parseScreenFrame(JSON.parse(read(n,'ocr.json')),'braised food flushing',`q0001:frame-${n}`,`t${n}`,read(n,'xml')));
const quote=(f:ScreenFrame)=>f.anchors!.find(x=>x.text.includes('tastes great'))!;
const rating=(f:ScreenFrame)=>f.anchors!.find(x=>x.text.includes('(75)'))!;
describe('KEKE command-probe real frames31/32',()=>{
 it('joins the trailing merchant by independent snippet/rating motion despite OCR name drift',()=>{
  const [a,b]=frames() as [ScreenFrame,ScreenFrame];a.topStateVerified=true; // isolated pair, not a real list-top assertion
  expect(a.cards.map(x=>x.name)).toEqual(['江湖 烤 涮 酒 坊','Braised Canaan 迦 南 地 涉 味']);
  expect(b.cards[0]!.name).toBe('Braised Canaan Wma steal');
  expect(anchoredContinuity(a,b)).toBeCloseTo(-312,0);
  const out=reconcileScreenFrames([a,b],20);
  expect(out).toMatchObject({sequenceVerified:true,rankingReliable:true,organicCount:2});
  expect(out.listings).toHaveLength(2);expect(out.listings[1]!.frameIds).toHaveLength(2);
  expect(out.listings[1]!.name).toBe(a.cards[1]!.name); // keep an observed higher-confidence name, never invent the Chinese spelling
 });
 it.each(['missing snippet','changed words','changed number','short quote','motion conflict','duplicate quote','duplicate rating','wrong viewport','wrong query','different reviews','different distance','different category','ad conflict','unknown classification','ambiguous card','clipped card','quote below card','invalid bounds','changed line height','invalid name bounds'])('refuses unsupported continuity: %s',kind=>{
  const [a,b]=frames() as [ScreenFrame,ScreenFrame];
  if(kind==='missing snippet')b.anchors=b.anchors!.filter(x=>x!==quote(b));
  if(kind==='changed words')quote(b).text=quote(b).text.replace('affordable','expensive');
  if(kind==='changed number')rating(b).text=rating(b).text.replace('$10-20','$10-30');
  if(kind==='short quote'){quote(a).text='"good food"';quote(b).text='“good food”';}
  if(kind==='motion conflict')quote(b).bounds.top+=30;
  if(kind==='duplicate quote')b.anchors!.push(structuredClone(quote(b)));
  if(kind==='duplicate rating')b.anchors!.push(structuredClone(rating(b)));
  if(kind==='wrong viewport')b.nativeListBounds!.top+=25;
  if(kind==='wrong query')b.queryVisible=false;
  if(kind==='different reviews')b.cards[0]!.reviewCount=76;
  if(kind==='different distance')b.cards[0]!.distanceText='1.5 mi';
  if(kind==='different category')b.cards[0]!.category='barbecue';
  if(kind==='ad conflict'){b.cards[0]!.resultType='ad';b.cards[0]!.adLabel='Sponsored';}
  if(kind==='unknown classification')b.cards[0]!.resultType='unknown';
  if(kind==='ambiguous card')a.cards.unshift(structuredClone(a.cards[1]!));
  if(kind==='clipped card')b.cards[0]!.warnings.push('card_header_clipped');
  if(kind==='quote below card'){quote(a).bounds.top+=400;quote(a).bounds.bottom+=400;quote(b).bounds.top+=400;quote(b).bounds.bottom+=400;}
  if(kind==='invalid bounds')quote(b).bounds.left=NaN;
  if(kind==='changed line height')quote(b).bounds.bottom+=50;
  if(kind==='invalid name bounds')b.cards[0]!.nameBounds!.top=NaN;
  expect(anchoredContinuity(a,b)).toBeNull();
 });
 it('does not override two contradictory exact anchors',()=>{
  const [a,b]=frames() as [ScreenFrame,ScreenFrame];
  for(const [i,delta] of [[0,-100],[1,-200]]){
   const bounds={left:50,right:400,top:700+i!*40,bottom:725+i!*40};
   a.anchors!.push({text:`independent exact ${i}`,bounds});b.anchors!.push({text:`independent exact ${i}`,bounds:{...bounds,top:bounds.top+delta!,bottom:bounds.bottom+delta!}});
  }
  expect(anchoredContinuity(a,b)).toBeNull();
 });
});

describe('whole selected command-probe replay',()=>{
 it('preserves the twelve ordered occurrences across all thirty retained selected frames',()=>{
  const fs=JSON.parse(readFileSync(new URL('selected-frames.json',root),'utf8')) as ScreenFrame[];
  expect(fs).toHaveLength(30);
  const out=reconcileScreenFrames(fs,20);
  expect(out).toMatchObject({sequenceVerified:true,rankingReliable:true,organicCount:12,unknownCount:0});
  expect(out.listings).toHaveLength(12);
  expect(out.listings.at(-1)!.frameIds).toContain('q0001:frame-032');
  expect(out.listings[0]).toMatchObject({name:'可 可 小 鹵 KEKE BRAISED DELI',organicRank:1});
  expect(fs.at(-1)!.endOfResults).toBe(false); // repaired evidence prefix is not complete-list acceptance
 });
 it('cannot turn an ad conflict into a reliable joined ranking',()=>{
  const [a,b]=frames() as [ScreenFrame,ScreenFrame];a.topStateVerified=true;b.cards[0]!.resultType='ad';b.cards[0]!.adLabel='Sponsored';
  expect(reconcileScreenFrames([a,b],20).rankingReliable).toBe(false);
 });
 it('rejects even a single contradictory exact anchor',()=>{
  const [a,b]=frames() as [ScreenFrame,ScreenFrame];
  a.anchors!.push({text:'independent exact line',bounds:{left:50,right:400,top:700,bottom:725}});
  b.anchors!.push({text:'independent exact line',bounds:{left:50,right:400,top:600,bottom:625}});
  expect(anchoredContinuity(a,b)).toBeNull();
 });
});
