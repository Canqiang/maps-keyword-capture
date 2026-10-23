import {readFileSync} from 'node:fs';
import {inspectNativeResultActions} from '../src/android/ui.js';
import {describe,it,expect} from 'vitest';
import {parseScreenFrame,reconcileScreenFrames,anchoredContinuity} from '../src/android/screen-reader.js';
const root=new URL('./fixtures/android/sheet-recovery-20261023/',import.meta.url);
function frame(n:number){return parseScreenFrame(JSON.parse(readFileSync(new URL(`keke-${n}.ocr.json`,root),'utf8')),'braised food flushing',`f${n}`,'time',readFileSync(new URL(`keke-${n}.xml`,root),'utf8'));}
describe('native action motion corroborates screenshot card continuity',()=>{
 it('joins original Nong Geng Ji OCR drift from frames 1–2 using retained controls and the matching rating row',()=>{
  const a=frame(1),b=frame(2),r=reconcileScreenFrames([a,b],20);
  expect(anchoredContinuity(a,b)).toBe(-308);
  expect(r.sequenceVerified).toBe(true);expect(r.rankingReliable).toBe(true);expect(r.listings).toHaveLength(2);
  expect(r.listings[1]).toMatchObject({rating:4.6,reviewCount:547,displayPosition:2,organicRank:2});
 });
 it('excludes disabled or overlay native controls even when their geometry matches',()=>{
  const xml=readFileSync(new URL('keke-1.xml',root),'utf8');
  const original=inspectNativeResultActions(xml,'braised food flushing');expect(original.length).toBeGreaterThanOrEqual(2);
  const disabled=xml.replace(/<[^>]+clickable="true"[^>]*>/g,tag=>tag.replace('enabled="true"','enabled="false"'));
  expect(inspectNativeResultActions(disabled,'braised food flushing')).toEqual([]);
  const overlays=original.map(x=>`<node package="com.google.android.apps.maps" class="android.widget.Button" text="${x.text}" clickable="true" enabled="true" bounds="[${x.bounds.left},${x.bounds.top}][${x.bounds.right},${x.bounds.bottom}]"/>`).join('');
  expect(inspectNativeResultActions(xml.replace('</hierarchy>',overlays+'</hierarchy>'),'braised food flushing')).toEqual(original);
 });
 it.each([null,'invalid',[null],[{text:'Nong',confidence:90}],[{text:'Nong',confidence:90,bounds:null}]])('malformed optional word evidence preserves primary parsing: %j',words=>{
  const o=JSON.parse(readFileSync(new URL('keke-1.ocr.json',root),'utf8'));
  o.lines.find((l:any)=>l.text.startsWith('Nong')).words=words;
  const f=parseScreenFrame(o,'braised food flushing','bad','time',readFileSync(new URL('keke-1.xml',root),'utf8'));
  expect(f.cards).toHaveLength(2);expect(f.cards[1]!.rating).toBe(4.6);expect(f.cards[1]!.nameWords).toBeUndefined();
  expect(anchoredContinuity(f,frame(2))).toBeNull();
 });
 it('does not join the collapsed top sheet across a changed viewport',()=>{
  expect(anchoredContinuity(frame(1),frame(3))).toBeNull();
 });
 it.each(['conflicting OCR','no controls','one control','conflicting motion','duplicate controls','changed name','branch suffix','branch extension','confident garble','garble position','missing word evidence','changed category','clipped header','changed rating','duplicate rating','ad mismatch','unknown','query absent'])('rejects insufficient motion proof: %s',kind=>{
  const a=frame(1),b=frame(2);
  if(kind==='conflicting OCR'){a.anchors=[{text:'some unique corroborating text',bounds:{left:40,right:600,top:700,bottom:730}}];b.anchors=[{text:'some unique corroborating text',bounds:{left:40,right:600,top:600,bottom:630}}];}
  if(kind==='no controls')b.nativeActionAnchors=[];
  if(kind==='one control')b.nativeActionAnchors=b.nativeActionAnchors!.slice(0,1);
  if(kind==='conflicting motion'){b.nativeActionAnchors![0]!.bounds.top+=30;b.nativeActionAnchors![0]!.bounds.bottom+=30;}
  if(kind==='duplicate controls')b.nativeActionAnchors!.push(...structuredClone(b.nativeActionAnchors!));
  if(kind==='branch suffix'||kind==='branch extension'){
    const replace=(c:any,tail:string)=>{c.nameWords=c.nameWords.slice(0,3);c.nameWords.push({text:tail,confidence:95,bounds:{left:270,right:375,top:c.nameBounds.top+3,bottom:c.nameBounds.bottom-3}});c.name=c.nameWords.map((w:any)=>w.text).join(' ');};
    replace(a.cards[1],kind==='branch suffix'?'Flushing':'');replace(b.cards[0],kind==='branch suffix'?'Manhattan':'II');
    if(kind==='branch extension'){a.cards[1]!.nameWords!.pop();a.cards[1]!.name='Nong Geng Ji';}
  }
  if(kind==='confident garble')b.cards[0]!.nameWords![3]!.confidence=80;
  if(kind==='garble position')b.cards[0]!.nameWords![3]!.bounds.left+=20;
  if(kind==='missing word evidence')delete b.cards[0]!.nameWords;
  if(kind==='changed name')b.cards[0]!.name='Entirely Other Merchant';
  if(kind==='changed category')b.cards[0]!.category='Barbecue';
  if(kind==='clipped header')b.cards[0]!.warnings.push('card_header_clipped');
  if(kind==='changed rating')b.cards[0]!.rating=3.1;
  if(kind==='duplicate rating')b.cards.push(structuredClone(b.cards[0]!));
  if(kind==='ad mismatch')b.cards[0]!.resultType='ad';
  if(kind==='unknown')b.cards[0]!.resultType='unknown';
  if(kind==='query absent')b.queryVisible=false;
  expect(anchoredContinuity(a,b)).toBeNull();
 });
});
