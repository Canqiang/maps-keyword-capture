import {describe,it,expect} from 'vitest';
import {CommandJournal, commandLabel, diagnosticsJson} from '../src/android/command-diagnostics.js';
describe('bounded command diagnostics',()=>{
 it('retains bounded recent history and early failures without arbitrary strings',()=>{
  const j=new CommandJournal();
  j.record({stage:'search.submit',command:'mobile:performEditorAction',durationMs:12,outcome:'failed',httpStatus:404,w3cError:'stale element reference'});
  for(let i=0;i<1000;i++)j.record({stage:'snapshot',command:'GET source',durationMs:1,outcome:'ok'});
  const r=j.snapshot();expect(r.total).toBe(1001);expect(r.recent).toHaveLength(512);expect(r.droppedRecent).toBe(489);expect(r.failures[0].w3cError).toBe('stale element reference');
  j.record({stage:'private-token',command:'secret-url?sig=secret',durationMs:NaN,outcome:'failed',w3cError:'Bearer private-token',message:'private-token'} as any);
  expect(diagnosticsJson(j.snapshot())).not.toContain('private-token');expect(diagnosticsJson(j.snapshot())).not.toContain('secret');
 });
 it('retains the observed 276-command location phase across the started and located checkpoints',()=>{
  const j=new CommandJournal();
  for(let n=0;n<29;n++)j.record({stage:'start',command:'GET source',durationMs:1,outcome:'ok'});
  const started=JSON.parse(diagnosticsJson(j.snapshot()));
  for(let n=0;n<276;n++)j.record({stage:'location',command:'GET source',durationMs:1,outcome:'ok'});
  const located=JSON.parse(diagnosticsJson(j.snapshot()));
  const union=new Set([...started.recent,...located.recent].map(e=>e.sequence));
  expect([...union].sort((a,b)=>a-b)).toEqual(Array.from({length:305},(_,i)=>i+1));
 });
 it('labels commands without native element IDs, session IDs or mobile arguments',()=>{
  expect(commandLabel('GET','/session/private/element/private/text')).toBe('GET element/text');
  expect(commandLabel('POST','/session/private/execute/sync',{script:'mobile: performEditorAction',args:[{text:'secret'}]})).toBe('mobile:performEditorAction');
  expect(commandLabel('GET','/unknown?sig=secret')).toBe('other');
  for(const route of ['attribute/clickable','attribute/content-desc','elements']) expect(commandLabel('GET','/session/private/element/private/'+route)).toBe('GET element/'+route);
  expect(commandLabel('POST','/session/private/appium/settings')).toBe('POST appium/settings');
 });
});
