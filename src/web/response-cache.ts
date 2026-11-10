/** Tab-local, bounded JSON reuse; never caches credentials, images or errors. */
export function createResponseCache(maxBytes = 12 * 1024 * 1024, ttlMs = 30_000, now = () => Date.now()) {
  const entries = new Map<string, {json:string;expires:number}>(); let bytes=0;
  return {
    get(key: string): unknown | undefined {
      const entry=entries.get(key); if(!entry)return undefined;
      entries.delete(key); bytes-=entry.json.length*2;
      if(entry.expires<=now())return undefined;
      entries.set(key,entry);bytes+=entry.json.length*2;return JSON.parse(entry.json);
    },
    set(key: string, value: unknown) {
      const old=entries.get(key);if(old){bytes-=old.json.length*2;entries.delete(key);}
      const json=JSON.stringify(value),size=json.length*2;if(size>maxBytes)return;
      while(entries.size&&bytes+size>maxBytes){const oldest=entries.keys().next().value!;bytes-=entries.get(oldest)!.json.length*2;entries.delete(oldest);}
      entries.set(key,{json,expires:now()+ttlMs});bytes+=size;
    },
    clear(){entries.clear();bytes=0;},
  };
}
