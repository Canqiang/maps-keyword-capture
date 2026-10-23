import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {parseScreenFrame,anchoredContinuity,reconcileScreenFrames} from '../src/android/screen-reader.js';
const root=new URL('./fixtures/android/bobs-native-overlap-20261023/',import.meta.url);
function pair(){return [34,35].map(n=>parseScreenFrame(JSON.parse(readFileSync(new URL(`frame-0${n}.ocr.json`,root),'utf8')),'braised food flushing',`frame-${n}`,'2026-10-23',readFileSync(new URL(`frame-0${n}.xml`,root),'utf8')));}
describe('native controls plus mixed-script title corroboration',()=>{
 it('joins the same Bobs/Bob’s Noodle header despite uncertain CJK OCR and explicit script variants',()=>{
  const [a,b]=pair();expect(anchoredContinuity(a,b!)).toBe(-417);
  const r=reconcileScreenFrames([a!,b!],20);expect(r.warnings).toEqual(['list_top_unverified']);expect(r.listings).toHaveLength(2);expect(r.listings[1]!.frameIds).toHaveLength(2);
 });
 it.each(['brand','branch','number','english-confidence','word-motion','controls','duplicate-rating','unknown','ad','clipped','confident-cjk-change','cjk-count','confident-different-cjk'])('rejects insufficient or conflicting evidence: %s',variant=>{
  const [a,b]=pair(), x=a!.cards.at(-1)!,y=b!.cards[0]!;
  const change=(from:string,to:string)=>{y.name=y.name!.replace(from,to);y.nameWords!.find(w=>w.text===from)!.text=to;};
  if(variant==='brand')change('Noodle','Kitchen');
  if(variant==='branch')change('Noodle','Noodle Queens');
  if(variant==='number')change('2','3');
  if(variant==='english-confidence')y.nameWords!.find(w=>w.text==='Bob’s')!.confidence=60;
  if(variant==='word-motion')y.nameWords!.find(w=>w.text==='Noodle')!.bounds.left+=10;
  if(variant==='controls')b!.nativeActionAnchors=[];
  if(variant==='duplicate-rating')a!.cards.push(structuredClone(x));
  if(variant==='unknown')y.resultType='unknown';
  if(variant==='ad')y.resultType='ad';
  if(variant==='clipped')y.warnings.push('clipped_header');
  if(variant==='confident-cjk-change')change('哥','姐');
  if(variant==='cjk-count')change('哥','哥哥');
  if(variant==='confident-different-cjk'){for(const c of [x,y])for(const w of c.nameWords!)if(/[一-鿿]/u.test(w.text))w.confidence=95;}
  expect(anchoredContinuity(a,b!)).toBeNull();expect(reconcileScreenFrames([a!,b!],20).sequenceVerified).toBe(false);
 });
});
