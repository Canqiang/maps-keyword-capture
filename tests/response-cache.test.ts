import {it,expect} from 'vitest';
import {createResponseCache} from '../src/web/response-cache.js';
it('reuses bounded JSON within TTL, isolates mutations and supports explicit refresh',()=>{
 let t=0;const cache=createResponseCache(24,100,()=>t);cache.set('a',{n:1});const hit=cache.get('a') as {n:number};hit.n=9;expect(cache.get('a')).toEqual({n:1});
 cache.set('b',{n:2});expect(cache.get('a')).toBeUndefined();t=100;expect(cache.get('b')).toBeUndefined();cache.set('c',{n:3});cache.clear();expect(cache.get('c')).toBeUndefined();
});
