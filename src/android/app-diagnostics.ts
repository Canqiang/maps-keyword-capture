import {createHash} from 'node:crypto';

export interface AppDiagnosticCommand {
  name: string; startedAt: string; durationMs: number; outcome: 'ok'|'failed';
  text?: string; originalTextBytes?: number; sha256?: string; truncated?: boolean; errorCode?: string;
}
export interface AppDiagnosticReport {
  schemaVersion: 'android-app-diagnostics/v1'; startedAt: string; finishedAt: string;
  commands: AppDiagnosticCommand[];
}
// Fixed read-only commands. No shell fragments, app restarts, buffer clearing or UI mutation.
const COMMANDS: Array<[string,string[]]> = [
  ['anr_events',['logcat','-b','events','-d','-t','200','am_anr:I','am_crash:I','*:S']],
  ['last_anr',['shell','dumpsys','activity','lastanr']],
  ['maps_exit_info',['shell','dumpsys','activity','exit-info','com.google.android.apps.maps']],
  ['cpu_info',['shell','dumpsys','cpuinfo']],
];
function redact(text:string):string {
  return text.replace(/https?:\/\/[^\s<>"']+/giu,'[REDACTED_URL]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu,'Bearer [REDACTED]')
    .replace(/\b(?:authorization|(?:access[_-]?|refresh[_-]?)?token|password|secret|api[_-]?key|sig)["']?\s*[:=][^\r\n]*/giu,'[REDACTED_CREDENTIAL]');
}
export async function collectAppDiagnostics(read:(args:string[])=>Promise<string>):Promise<AppDiagnosticReport> {
  const report:AppDiagnosticReport={schemaVersion:'android-app-diagnostics/v1',startedAt:new Date().toISOString(),finishedAt:'',commands:[]};
  for(const[name,args]of COMMANDS){
    const start=performance.now();const item:AppDiagnosticCommand={name,startedAt:new Date().toISOString(),durationMs:0,outcome:'failed'};
    try {
      const text=await read([...args]);const safe=Buffer.from(redact(text));
      Object.assign(item,{outcome:'ok',originalTextBytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex'),truncated:safe.length>131072,text:safe.subarray(0,131072).toString('utf8')});
    } catch(error){
      const code=error!==null&&typeof error==='object'&&'code'in error?error.code:undefined;
      if(code==='CANCELLED')throw error;
      item.errorCode=typeof code==='string'&&['QUERY_TIMEOUT','COMMAND_TIMEOUT','ADB_COMMAND_FAILED'].includes(code)?code:'DIAGNOSTIC_READ_FAILED';
    } finally {item.durationMs=Math.max(0,performance.now()-start);}
    report.commands.push(item);
  }
  report.finishedAt=new Date().toISOString();return report;
}
