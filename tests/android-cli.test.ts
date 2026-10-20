import {expect,it} from 'vitest';
import {parseAndroidArgs} from '../src/android/cli.js';
it('validates bounded standalone commands without accepting silent fallback',()=>{
 expect(parseAndroidArgs(['capture','--config','input.json','--storage','azure']).storage).toBe('azure');
 for(const args of [[],['capture'],['capture','--config','x','--storage=azure'],['doctor','--config','x','--storage','azure'],['capture','--config','x','--config','y'],['capture','--config','x','--wrong','y']]) expect(()=>parseAndroidArgs(args)).toThrow();
});
