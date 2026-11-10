import { it, expect } from 'vitest';
import { EvidenceCache } from '../src/web/evidence-cache.js';
it('coalesces reads, validates content and bounds bytes with LRU eviction',async()=>{
 let n=0; const cache=new EvidenceCache({get:async(key)=>{n++;return Buffer.from(key);}},6,1000);
 const [a,b]=await Promise.all([cache.get('aaa'),cache.get('aaa')]);expect(n).toBe(1);expect(a.etag).toBe(b.etag);
 await cache.get('bbb');await cache.get('ccc');await cache.get('aaa');expect(n).toBe(4);expect(cache.bytes).toBeLessThanOrEqual(6);
});
it('does not retain failures or oversized images',async()=>{
 let n=0;const cache=new EvidenceCache({get:async()=>{n++;if(n===1)throw Error('lost');return Buffer.alloc(10);}},5);
 await expect(cache.get('k')).rejects.toThrow('lost');await cache.get('k');await cache.get('k');expect(n).toBe(3);expect(cache.bytes).toBe(0);
});
it('re-reads expired objects',async()=>{
 let time=0,n=0;const cache=new EvidenceCache({get:async()=>Buffer.from(String(++n))},10,100,()=>time);
 const first=await cache.get('k');time=101;expect((await cache.get('k')).etag).not.toBe(first.etag);
});
