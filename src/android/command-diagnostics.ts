/** Bounded, allowlisted metadata only. Never retain request/response bodies or server messages. */
const stages = new Set(['setup','preflight','start','location','search','search.prepare-ime','search.submit','search.results','search.expand','search.restore-ime','snapshot','scroll','close']);
const paths = ['session','appium/settings','source','screenshot','elements','element/elements','element/click','element/clear','element/value','element/text','element/rect','element/displayed','actions',...['focused','enabled','clickable','content-desc','package','resource-id','className','scrollable'].map(x=>`element/attribute/${x}`)];
const mobiles = ['getCurrentPackage','performEditorAction','dragGesture'];
const adbLabels = ['shell am','shell settings','shell input','shell ime','shell dumpsys','shell getprop','shell wm','emu geo','get-state','devices','other'];
const commands = new Set([...paths.flatMap(p=>['GET','POST','DELETE'].map(m=>`${m} ${p}`)),...mobiles.map(x=>`mobile:${x}`),...adbLabels.map(x=>`adb:${x}`)]);
const w3c = new Set(['stale element reference','no such element','invalid session id','unknown error','invalid argument','unknown command','unsupported operation','timeout','script timeout','element not interactable','invalid element state','session not created']);
const errors = new Set(['APPIUM_PROTOCOL_ERROR','ADB_COMMAND_FAILED','QUERY_TIMEOUT','COMMAND_TIMEOUT','CANCELLED']);
const reasons = new Set(['http_error','w3c_error','missing_value','missing_body','oversized_body','invalid_json','transport_error']);
export interface CommandEventInput {stage:string;command:string;durationMs:number;outcome:'ok'|'failed';httpStatus?:number;w3cError?:string;errorCode?:string;reason?:string;responseType?:string}
export interface CommandEvent extends CommandEventInput {sequence:number;at:string}
export interface CommandReport {schemaVersion:'android-command-log/v1';total:number;droppedRecent:number;droppedFailures:number;recent:CommandEvent[];failures:CommandEvent[]}
const integer=(v:number,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max?v:0;
function clean(e:CommandEvent):CommandEvent {
 return {sequence:integer(e.sequence),at:typeof e.at==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(e.at)?e.at:'',stage:stages.has(e.stage)?e.stage:'setup',command:commands.has(e.command)?e.command:'other',durationMs:Number.isFinite(e.durationMs)&&e.durationMs>=0?Math.round(e.durationMs):0,outcome:e.outcome==='ok'?'ok':'failed',
 ...(Number.isInteger(e.httpStatus)&&e.httpStatus! >= 100 && e.httpStatus! <= 599?{httpStatus:e.httpStatus}:{}),
 ...(['null','array','string','boolean','number','object','undefined'].includes(e.responseType??'')?{responseType:e.responseType}:{}),
 ...(e.w3cError?{w3cError:w3c.has(e.w3cError)?e.w3cError:'other'}:{}),...(e.errorCode?{errorCode:errors.has(e.errorCode)?e.errorCode:'other'}:{}),...(e.reason?{reason:reasons.has(e.reason)?e.reason:'transport_error'}:{})};
}
export function commandLabel(method:string,path:string,body?:unknown):string {
 const b=body as {script?:unknown}|undefined;
 if(path.endsWith('/execute/sync')&&typeof b?.script==='string'){
  const name=b.script.replace(/^mobile: /u,'');return mobiles.includes(name)?`mobile:${name}`:'other';
 }
 const route=path.replace(/^\/session\/[^/]+/u,'').replace(/^\/element\/[^/]+/u,'/element').replace(/^\//u,'');
 const label=`${method} ${route||'session'}`;return commands.has(label)?label:'other';
}
export function adbLabel(args:string[]):string {
 const label=adbLabels.find(x=>x!=='other'&&args.slice(0,x.split(' ').length).join(' ')===x);return `adb:${label??'other'}`;
}
// The observed location phase spans276 commands between checkpoints. Keep a
// bounded512-event window; longer phases still report dropped counts explicitly.
const RECENT_LIMIT=512;
export class CommandJournal {
 private recent:CommandEvent[]=[];private failures:CommandEvent[]=[];private total=0;private failureCount=0;
 record(input:CommandEventInput):void {
  const e=clean({...input,sequence:++this.total,at:new Date().toISOString()});
  this.recent.push(e);if(this.recent.length>RECENT_LIMIT)this.recent.shift();
  if(e.outcome==='failed'){this.failureCount++;if(this.failures.length<32)this.failures.push(e);}
 }
 snapshot():CommandReport {return {schemaVersion:'android-command-log/v1',total:this.total,droppedRecent:Math.max(0,this.total-this.recent.length),droppedFailures:Math.max(0,this.failureCount-this.failures.length),recent:this.recent.map(e=>({...e})),failures:this.failures.map(e=>({...e}))};}
}
/** Project fields again at the artifact boundary, including for injected device implementations. */
export function diagnosticsJson(report:CommandReport):string {
 return JSON.stringify({schemaVersion:'android-command-log/v1',total:integer(report.total),droppedRecent:integer(report.droppedRecent),droppedFailures:integer(report.droppedFailures),recent:report.recent.slice(-RECENT_LIMIT).map(clean),failures:report.failures.slice(0,32).map(clean)},null,2);
}
