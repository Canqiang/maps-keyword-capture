import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {parseScreenFrame,anchoredContinuity,reconcileScreenFrames} from '../src/android/screen-reader.js';
const root=new URL('./fixtures/android/jianghu-overlap-20261023/',import.meta.url);
function pair(){return [23,24].map(n=>parseScreenFrame(JSON.parse(readFileSync(new URL(`frame-0${n}.ocr.json`,root),'utf8')),'braised food flushing',`frame-${n}`,'2026-10-23',readFileSync(new URL(`frame-0${n}.xml`,root),'utf8')));}
describe('anchored short Chinese title uncertainty',()=>{
 it('retains one Jianghu occurrence when one uncertain interior character changes at the same anchored position',()=>{
  const [a,b]=pair();expect(anchoredContinuity(a,b!)).toBe(-219);
  const r=reconcileScreenFrames([a!,b!],20);
  expect(r.listings).toHaveLength(2);expect(r.listings[0]).toMatchObject({name:'江湖 烤 涮 酒 坊',resultType:'organic',frameIds:['frame-23','frame-24']});
  expect(r.warnings).toEqual(['list_top_unverified']);
 });
 it.each(['confident-change','branch','number','motion','rating','reviews','distance','ad','uncertain-ad','duplicate','outside-title','multiple-changes','missing-words'])('refuses insufficient identity evidence: %s',variant=>{
  const [a,b]=pair(),x=a!.cards[0]!,y=b!.cards[0]!;
  const change=(from:string,to:string)=>{y.name=y.name!.replace(from,to);y.nameWords!.find(w=>w.text===from)!.text=to;};
  if(variant==='confident-change')x.nameWords!.find(w=>w.text==='涮')!.confidence=90;
  if(variant==='branch')change('坊','店');
  if(variant==='number')change('坊','2');
  if(variant==='motion')y.nameWords!.find(w=>w.text==='测')!.bounds.left+=12;
  if(variant==='rating')y.rating=4.7;
  if(variant==='reviews')y.reviewCount=274;
  if(variant==='distance')y.distanceText='0.8 mi';
  if(variant==='ad'){y.resultType='ad';y.adLabel='Sponsored';}
  if(variant==='uncertain-ad')y.warnings.push('uncertain_ad_label');
  if(variant==='duplicate')a!.cards.push(structuredClone(x));
  if(variant==='outside-title')y.nameBounds!.top=260;
  if(variant==='multiple-changes'){change('烤','炖');x.nameWords!.find(w=>w.text==='烤')!.confidence=20;}
  if(variant==='missing-words')y.nameWords=[];
  expect(reconcileScreenFrames([a!,b!],20).warnings.some(w=>w.startsWith('anchored_card_'))).toBe(true);
 });
});
