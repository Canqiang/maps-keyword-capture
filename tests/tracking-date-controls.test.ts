import {createContext,runInContext} from 'node:vm';
import {describe,it,expect} from 'vitest';
import {UI_HTML} from '../src/web/ui.js';
function ui(readOnly=false){
 const elements=new Map<string,any>();const el=(id:string)=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',querySelectorAll:()=>[]});return elements.get(id);};
 class Clock extends Date{constructor(v?:any){super(v??'2026-10-26T02:00:00Z')}}
 const context=createContext({document:{getElementById:el,querySelectorAll:()=>[]},location:{hash:'#store/keke?to=2026-10-22'},window:{addEventListener:()=>{}},URLSearchParams,Date:Clock,Intl,AbortController,setTimeout:()=>0,history:{replaceState:()=>{}}});
 runInContext(UI_HTML.match(/<script>([\s\S]*)<\/script>/)![1]!.replace(/;route\(\);\s*$/,';'),context);
 runInContext(`settings={timezone:'America/New_York',readOnly:${readOnly}};var selected={view:'store',id:'keke',surface:'web',point:'keke-center',keyword:'braised food pickup',from:'2026-10-09',to:'2026-10-22'};bindDateControls(selected);`,context);
 return {context,el,route:()=>new URLSearchParams(runInContext('location.hash',context).split('?')[1])};
}
describe('history date navigation',()=>{
 it('anchors recent 14 days to today in the configured timezone, not an old selected end',()=>{const x=ui();x.el('range').onchange({target:{value:'14'}});expect(x.route().get('to')).toBe('2026-10-25');expect(x.route().get('from')).toBe('2026-10-12');expect(x.route().get('keyword')).toBe('braised food pickup');});
 it('opens latest data without carrying an old end date and keeps surface and point',()=>{const x=ui();x.el('latest-range').onclick();expect(x.route().get('to')).toBe('2026-10-25');expect(x.route().get('from')).toBe('2026-10-12');expect(x.route().get('surface')).toBe('web');expect(x.route().get('point')).toBe('keke-center');});
 it('keeps a deliberate historical range until the user changes it',()=>{const x=ui();expect(x.route().get('to')).toBe('2026-10-22');x.el('from-date').value='2026-09-18';x.el('to-date').value='2026-09-30';x.el('apply-range').onclick();expect(x.route().get('from')).toBe('2026-09-18');expect(x.route().get('to')).toBe('2026-09-30');});
 it('does not move an archived read-only report into dates outside its snapshot',()=>{const x=ui(true);x.el('range').onchange({target:{value:'14'}});expect(x.route().get('to')).toBe('2026-10-22');expect(x.route().get('from')).toBe('2026-10-09');});
});
