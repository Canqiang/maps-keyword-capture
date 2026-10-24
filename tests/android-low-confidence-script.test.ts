import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {anchoredContinuity,parseScreenFrame,reconcileScreenFrames,type ScreenFrame} from '../src/android/screen-reader.js';
const root=new URL('./fixtures/android/low-confidence-script-20261024/',import.meta.url);
const frames=()=>[1,2].map(n=>parseScreenFrame(JSON.parse(readFileSync(new URL(`keke-${n}.ocr.json`,root),'utf8')),'braised food flushing',`f${n}`,'t',readFileSync(new URL(`keke-${n}.xml`,root),'utf8'))) as [ScreenFrame,ScreenFrame];
const rename=(f:ScreenFrame,index:number,text:string,confidence?:number)=>{
 const c=f.cards[0]!,w=c.nameWords![index]!;w.text=text;if(confidence!==undefined)w.confidence=confidence;
 c.name=c.nameWords!.map(w=>w.text).join(' ');
};
describe('v32 low-confidence script drift with native control motion',()=>{
 it('joins the exact original first overlap without rolling the panel back',()=>{
  const [a,b]=frames();
  expect(anchoredContinuity(a,b)).toBe(-305);
  const r=reconcileScreenFrames([a,b],20);
  expect(r).toMatchObject({sequenceVerified:true,rankingReliable:true,organicCount:2,unknownCount:0});
  expect(r.listings[1]!.frameIds).toEqual(['f1','f2']);
 });
 it.each(['confident branch','number','roman suffix','word movement','prefix movement','prefix confidence','missing controls','review mismatch','distance mismatch','ad conflict','duplicate rating','foreign query'])('rejects %s',kind=>{
  const [a,b]=frames();const c=b.cards[0]!;
  if(kind==='confident branch')rename(b,3,'Branch',95);
  if(kind==='number')rename(b,3,'Branch2',0);
  if(kind==='roman suffix')rename(b,5,'III',0);
  if(kind==='word movement'){c.nameWords![3]!.bounds.left+=8;c.nameWords![3]!.bounds.right+=8;}
  if(kind==='prefix movement'){c.nameWords![0]!.bounds.left+=8;c.nameWords![0]!.bounds.right+=8;}
  if(kind==='prefix confidence')c.nameWords![0]!.confidence=30;
  if(kind==='missing controls')b.nativeActionAnchors=[];
  if(kind==='review mismatch')c.reviewCount=547;
  if(kind==='distance mismatch')c.distanceText='0.8 mi';
  if(kind==='ad conflict'){c.resultType='ad';c.adLabel='Sponsored';}
  if(kind==='duplicate rating')b.cards.push(structuredClone(c));
  if(kind==='foreign query')b.queryVisible=false;
  expect(anchoredContinuity(a,b)).toBeNull();
 });
 it.each(['#III','#IV'])('does not drop punctuated Roman branch %s',text=>{
  const [a,b]=frames();const c=a.cards[1]!;c.nameWords![3]!.text=text;c.name=c.nameWords!.map(w=>w.text).join(' ');
  expect(anchoredContinuity(a,b)).toBeNull();
 });
});
