import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {recognizeScreen} from '../src/android/screen-reader.js';
it('returns primary OCR and bounded error evidence when optional crop OCR exceeds its budget',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ocr-deadline-')),old=process.env.PATH;
 try{
  // CI installs Pillow for the system Python used by the runtime contracts.
  if(process.platform==='linux')await symlink('/usr/bin/python3',join(dir,'python3'));
  await writeFile(join(dir,'tesseract'),`#!/usr/bin/env python3
import sys,time
if '--version' in sys.argv: print('tesseract test')
elif '--list-langs' in sys.argv: print('eng\\nchi_sim\\nchi_tra')
else:
 if sys.argv[sys.argv.index('--psm')+1] != '4': time.sleep(8)
 print('level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext')
 print('5\\t1\\t1\\t1\\t1\\t1\\t120\\t1560\\t900\\t90\\t90\\t4.19% (18) - Chinese')
`,{mode:0o700});
  process.env.PATH=dir+':'+old;
  const o=await recognizeScreen({png:readFileSync(new URL('./fixtures/android/rating-reread-20261023/keke-36.png',import.meta.url)),timeoutMs:3000,languages:'eng',scale:3});
  expect(o.lines[0]!.text).toBe('4.19% (18) - Chinese');
  expect(o.ratingRereads?.[0]?.error).toBe('TimeoutExpired');
 }finally{process.env.PATH=old;await rm(dir,{recursive:true,force:true});}
});

it.each(['timeout','cancelled','exit','success','invalid-json'])('persists bounded OCR process diagnostics for %s',async(mode)=>{
 const dir=await mkdtemp(join(tmpdir(),'ocr-process-')),old=process.env.PATH;
 try{
  // Fake Python process exercises the real Node subprocess and wall timer.
  await writeFile(join(dir,'python3'),`#!/bin/sh
cat >/dev/null
printf '%s\\n' '{"schemaVersion":"android-ocr-stage/v1","stage":"full_screen","event":"start"}' >&2
${['timeout','cancelled'].includes(mode)?'exec sleep 10':mode==='exit'?"echo 'private-token-do-not-retain' >&2; exit 7":mode==='invalid-json'?"echo not-json":"echo '{\"schemaVersion\":\"android-screen-ocr/v1\",\"lines\":[]}'"}
`,{mode:0o700});process.env.PATH=dir+':'+old;
 const reports:any[]=[];const controller=new AbortController();const abort=mode==='cancelled'?setTimeout(()=>controller.abort(),1500):undefined;const call=recognizeScreen({png:Buffer.from('test'),timeoutMs:mode==='timeout'?1500:5000,languages:'eng',signal:controller.signal,onDiagnostics:async d=>{reports.push(d)}});
 if(mode==='success')await call;else await expect(call).rejects.toBeDefined();clearTimeout(abort);
 expect(reports).toHaveLength(1);const d=reports[0];
 expect(d).toMatchObject({schemaVersion:'android-ocr-process/v1',outcome:mode==='success'?'ok':'failed',timedOut:mode==='timeout',exitCode:mode==='exit'?7:['timeout','cancelled'].includes(mode)?null:0,lastStage:'full_screen'});
 expect(d.durationMs).toBeGreaterThanOrEqual(0);expect(d.stages).toHaveLength(1);
 expect(JSON.stringify(d)).not.toContain('private-token');
 if(mode==='timeout')expect(d.signal).toBe('SIGKILL');
 if(mode==='cancelled')expect(d).toMatchObject({cancelled:true,failureReason:'cancelled',timedOut:false});
 if(mode==='invalid-json')expect(d.failureReason).toBe('invalid_json');
 }finally{process.env.PATH=old;await rm(dir,{recursive:true,force:true});}
});

it.each([0,7])('cleans real descendants on primary exit %i without calling it a timeout',async code=>{
 const dir=await mkdtemp(join(tmpdir(),'ocr-descendant-')),old=process.env.PATH;let pid:number|undefined;
 try{
  await writeFile(join(dir,'python3'),`#!/bin/sh
cat >/dev/null
sleep 30 &
echo $! > '${join(dir,'child.pid')}'
echo '{"schemaVersion":"android-screen-ocr/v1","lines":[]}'
exit ${code}
`,{mode:0o700});process.env.PATH=dir+':'+old;const reports:any[]=[];
  const call=recognizeScreen({png:Buffer.from('test'),timeoutMs:2000,languages:'eng',onDiagnostics:async d=>{reports.push(d)}});
  if(code===0)await call;else await expect(call).rejects.toBeDefined();
  pid=Number(readFileSync(join(dir,'child.pid'),'utf8'));
  expect(reports[0]).toMatchObject({exitCode:code,timedOut:false,failureReason:code===0?null:'process_exit'});
  for(let n=0;n<20;n++){try{process.kill(pid,0);await new Promise(r=>setTimeout(r,25));}catch{pid=undefined;break}}
  expect(pid).toBeUndefined();
 }finally{if(pid){try{process.kill(pid,'SIGKILL')}catch{}}process.env.PATH=old;await rm(dir,{recursive:true,force:true});}
});
it('does not turn recovered optional timeout into a later fatal request timeout',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ocr-fatal-stage-')),old=process.env.PATH;
 try{
  await writeFile(join(dir,'python3'),`#!/bin/sh
cat >/dev/null
printf '%s\\n' '{"schemaVersion":"android-ocr-stage/v1","stage":"rating_psm7","event":"end","errorClass":"TimeoutExpired","timedOut":true}' '{"schemaVersion":"android-ocr-stage/v1","stage":"request","event":"end","errorClass":"ValueError","timedOut":false}' >&2
exit 1
`,{mode:0o700});process.env.PATH=dir+':'+old;const reports:any[]=[];
  await expect(recognizeScreen({png:Buffer.from('test'),timeoutMs:5000,languages:'eng',onDiagnostics:async d=>{reports.push(d)}})).rejects.toBeDefined();
  expect(reports[0]).toMatchObject({exitCode:1,timedOut:false,failureReason:'process_exit',lastStage:'request'});
 }finally{process.env.PATH=old;await rm(dir,{recursive:true,force:true});}
});
it.each(['signal','request-timeout'])('distinguishes optional timeouts from terminal %s',async mode=>{
 const dir=await mkdtemp(join(tmpdir(),'ocr-terminal-')),old=process.env.PATH;
 try{
  await writeFile(join(dir,'python3'),`#!/bin/sh
cat >/dev/null
printf '%s\\n' '{"schemaVersion":"android-ocr-stage/v1","stage":"rating_psm7","event":"end","errorClass":"TimeoutExpired","timedOut":true}' >&2
${mode==='signal'?'kill -KILL $$':`printf '%s\\n' '{"schemaVersion":"android-ocr-stage/v1","stage":"request","event":"end","errorClass":"TimeoutExpired","timedOut":true}' >&2; exit 1`}
`,{mode:0o700});process.env.PATH=dir+':'+old;const reports:any[]=[];
  await expect(recognizeScreen({png:Buffer.from('test'),timeoutMs:5000,languages:'eng',onDiagnostics:async d=>{reports.push(d)}})).rejects.toBeDefined();
  expect(reports[0]).toMatchObject({exitCode:mode==='signal'?null:1,signal:mode==='signal'?'SIGKILL':null,timedOut:mode==='request-timeout',failureReason:mode==='signal'?'process_exit':'timeout'});
 }finally{process.env.PATH=old;await rm(dir,{recursive:true,force:true});}
});
