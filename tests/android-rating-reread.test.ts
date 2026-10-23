import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {parseScreenFrame,reconcileScreenFrames} from '../src/android/screen-reader.js';
const root=new URL('./fixtures/android/rating-reread-20261023/',import.meta.url);
const read=(name:string)=>readFileSync(new URL(name,root),'utf8');
const original=()=>JSON.parse(read('keke-36.ocr.json'));
const reread=()=>JSON.parse(read('keke-36.reread.json'));
const parse=(o:any,xml=read('keke-36.xml'))=>parseScreenFrame(o,'braised food flushing','f36','t36',xml || undefined);
describe('independent same-PNG rating reread',()=>{
 it('recovers observed 4.1/18 without guessing a digit from the malformed primary token',()=>{
  const o=reread(),before=structuredClone(o);
  expect(parse(original()).cards).toHaveLength(0);
  const f=parse(o);expect(f.cards).toHaveLength(1);
  expect(f.cards[0]).toMatchObject({name:'Longjiang Pork Feet Rice',rating:4.1,reviewCount:18,resultType:'organic'});
  const previous=parseScreenFrame(JSON.parse(read('keke-35.ocr.json')),'braised food flushing','f35','t35',read('keke-35.xml'));
  previous.topStateVerified=true; // isolated pair, not live first-page acceptance
  const result=reconcileScreenFrames([previous,f],20);
  expect(result.sequenceVerified).toBe(true);expect(result.listings.filter(x=>x.name==='Longjiang Pork Feet Rice')).toHaveLength(1);
  expect(o).toEqual(before);
 });
 it.each(['no passes','single pass','same mode','rating conflict','count changed','tail changed','low confidence','outside crop','wrong crop','duplicate index','multiple lines','invalid rating','no native','wrong query','null pass','failed reread','wrong scale'])('rejects unproven reread: %s',kind=>{
  const o=reread(),r=o.ratingRereads[0],a=r.passes[0].lines[0],b=r.passes[1].lines[0];let xml=read('keke-36.xml');
  if(kind==='null pass')r.passes[0]=null;
  if(kind==='failed reread')r.error='TimeoutExpired';
  if(kind==='wrong scale')r.scale=1;
  if(kind==='no passes')r.passes=[];
  if(kind==='single pass')r.passes.pop();
  if(kind==='same mode')r.passes[1].psm=7;
  if(kind==='rating conflict')b.text=b.text.replace('4.1','4.2');
  if(kind==='count changed')for(const l of [a,b])l.text=l.text.replace('(18)','(19)');
  if(kind==='tail changed')for(const l of [a,b])l.text=l.text.replace('$10-20','$10-30');
  if(kind==='low confidence')b.confidence=39;
  if(kind==='outside crop')b.bounds.left=-1;
  if(kind==='wrong crop')r.crop.top+=100;
  if(kind==='duplicate index')o.ratingRereads.push(structuredClone(r));
  if(kind==='multiple lines')r.passes[1].lines.push(structuredClone(b));
  if(kind==='invalid rating')for(const l of [a,b])l.text=l.text.replace('4.1','4.19');
  if(kind==='no native')xml='';
  if(kind==='wrong query')xml=xml.replaceAll('braised food flushing','another query');
  expect(parse(o,xml).cards).toHaveLength(0);
 });
 it('does not replace an already valid primary rating even when two rereads agree',()=>{
  const o=reread();o.lines[o.ratingRereads[0].lineIndex].text='4.2% (18) - $10-20 - Chinese';
  expect(parse(o).cards[0]!.rating).toBe(4.2);
 });
});
