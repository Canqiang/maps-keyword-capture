import { beforeEach, describe, expect, it, vi } from 'vitest';
const fake=vi.hoisted(()=>({updateOne:vi.fn(),deleteOne:vi.fn(),replaceOne:vi.fn(),findOne:vi.fn(),close:vi.fn(),collections:[] as string[]}));
vi.mock('mongodb',()=>({MongoClient:class {db(){return {collection:(name:string)=>{fake.collections.push(name);return fake}}}close(){return fake.close()}}}));
import { MongoVolumeStore } from '../src/volume/store.js';
describe('volume Mongo write isolation and lease',()=>{
 beforeEach(()=>{vi.clearAllMocks();fake.collections=[];fake.updateOne.mockResolvedValue({acknowledged:true});fake.replaceOne.mockResolvedValue({acknowledged:true});});
 it('refuses overlapping work when the active lock causes a duplicate key',async()=>{
  const s=new MongoVolumeStore('mongodb://unused','test');fake.updateOne.mockRejectedValueOnce({code:11000});expect(await s.acquire('second',new Date('2026-11-12T00:00:00Z'))).toBe(false);
  expect(fake.updateOne.mock.calls[0]![0]).toEqual({_id:'weekly',expiresAt:{$lte:new Date('2026-11-12T00:00:00Z')}});
  await s.release('second');expect(fake.deleteOne).toHaveBeenCalledWith({_id:'weekly',runId:'second'});
 });
 it('writes only volume history then current, and never publishes current if history persistence fails',async()=>{
  const s=new MongoVolumeStore('mongodb://unused','test'),data={storeId:'keke',runId:'r',checkedAt:'2026-11-12',rows:[]};
  fake.replaceOne.mockRejectedValueOnce(new Error('write failed'));await expect(s.save(data)).rejects.toThrow('write failed');expect(fake.collections).toEqual(['search-volume-history-v1']);
  fake.collections=[];await s.save(data);expect(fake.collections).toEqual(['search-volume-history-v1','search-volume-current-v1']);
 });
 it('does not treat transport/storage failures as a held lock',async()=>{
  fake.updateOne.mockRejectedValueOnce(new Error('unreachable'));await expect(new MongoVolumeStore('mongodb://unused','test').acquire('r',new Date())).rejects.toThrow('unreachable');
 });
});
