import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createFrontendModel } from '../src/web/frontend-model.js';
import { createHandler } from '../src/web/server.js';
import { MemoryTrackingRepository } from '../src/domain/repository.js';
import { parseTrackingConfig } from '../src/domain/tracking-config.js';
import { emptyVolume } from '../src/volume/sync.js';
const m=createFrontendModel();
const row=emptyVolume('restaurant',{location:{name:'New York,New York,United States',code:1023191},language:'en',keywords:[]},'2026-11-12T02:00:00Z','no_data');
describe('search volume presentation and API isolation',()=>{
 it('shows origin, region, period, synchronization time and zero without claiming Maps volume',()=>{
  const v=m.searchVolume({...row,value:0,status:'available',dataThrough:'2026-10'},'90 次/月 Old area');
  const html=m.volumeHtml(v);
  expect(html).toContain('0');expect(html).toContain('DataForSEO');expect(html).toContain('New York');expect(html).toContain('2026-10');expect(html).toContain('2026-11-12');expect(html).not.toContain('90');
 });
 it('distinguishes no data, failed update retaining a good value, and old report fallback',()=>{
  expect(m.volumeHtml(m.searchVolume(row))).toContain('暂无数据');
  expect(m.volumeHtml(m.searchVolume({...row,value:20,status:'available',lastAttemptStatus:'error'}))).toContain('更新失败');
  expect(m.volumeHtml(m.searchVolume(undefined,'90 次/月 Old area'))).toContain('报告快照');
  expect(m.volumeHtml(m.searchVolume())).toContain('未同步');
 });
 it('escapes provider/region text',()=>{
  expect(m.volumeHtml(m.searchVolume({...row,locationName:'<script>alert(1)</script>'}))).not.toContain('<script>');
 });
 it('keeps store/rank APIs available when the independent volume collection is unavailable',async()=>{
  const raw=JSON.parse(await readFile(new URL('../docs/tracking-config.example.json',import.meta.url),'utf8'));
  const repo=new MemoryTrackingRepository();await repo.saveStore(raw.stores[0]);
  const server=createServer(createHandler({config:parseTrackingConfig(raw),repo,volumes:{get:async()=>{throw new Error('unavailable')},close:async()=>{}}}));
  server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/stores/${raw.stores[0].storeId}`);expect(response.status).toBe(200);const data=await response.json();expect(data.storeId).toBe(raw.stores[0].storeId);expect(data.searchVolumeUnavailable).toBe(true);}finally{await new Promise<void>(r=>server.close(()=>r()))}
 });
});
