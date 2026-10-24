import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {analyzeScreen} from '../src/android/ui.js';
import {NativeMapsDevice} from '../src/android/device.js';
import {parseAndroidConfig} from '../src/android/config.js';
const xml=readFileSync(new URL('./fixtures/android/maps-anr-20261024/dialog.xml',import.meta.url),'utf8');
const config=()=>parseAndroidConfig({schemaVersion:'android-maps-input/v1',serial:'emulator-5554',outputDirectory:'/tmp/app-diagnostics-tests',tasks:[{storeId:'onlybear',storeName:'OnlyBear',keyword:'bubble tea garden city',sourceReference:'test',location:{id:'center',label:'center',latitude:40,longitude:-73,source:'test'}}]});
describe('Maps ANR diagnostic boundary',()=>{
 it('classifies the original system ANR modal before ranking evidence',()=>{expect(analyzeScreen(xml,'bubble tea garden city').kind).toBe('app_not_responding');});
 it.each([
  xml.replaceAll('package="android"','package="com.google.android.apps.maps"'),
  xml.replace("Maps isn't responding","Chrome isn't responding"),
  xml.replace('android:id/aerr_wait','android:id/ordinary_wait'),
  xml.replace('android:id/aerr_close','android:id/ordinary_close'),
 ])('does not infer ANR from merchant text or another app',source=>{expect(analyzeScreen(source,'bubble tea garden city').kind).not.toBe('app_not_responding');});
 it('reads bounded system evidence on the configured local device, redacts tokens, and records partial failure',async()=>{
  const calls:string[][]=[];const device=new NativeMapsDevice(config(),{adb:async(_file,args)=>{calls.push(args);if(args.includes('exit-info'))throw Error('secret private failure');return{stdout:Buffer.from('ANR com.google.android.apps.maps Authorization: Bearer PRIVATE_TOKEN\ntoken=private-value\nhttps://example.test/path?sig=SECRET\n'+'x'.repeat(150000)),stderr:Buffer.alloc(0)};}});
  expect(typeof (device as any).appDiagnostics).toBe('function');const report=await (device as any).appDiagnostics();
  expect(device.commandDiagnostics().recent.every(c=>c.stage==='app.diagnostics')).toBe(true);expect(device.commandDiagnostics().recent[0]?.command).toBe('adb:logcat');expect(report.schemaVersion).toBe('android-app-diagnostics/v1');expect(report.commands).toHaveLength(4);expect(report.commands.filter((x:any)=>x.outcome==='failed')).toHaveLength(1);
  for(const call of calls)expect(call.slice(0,6)).toEqual(['-H','127.0.0.1','-P','5037','-s','emulator-5554']);
  expect(calls.every(c=>c.includes('dumpsys')||c.includes('logcat'))).toBe(true);expect(JSON.stringify(report)).not.toMatch(/private-value|sig=SECRET|secret private failure|PRIVATE_TOKEN/);
  for(const c of report.commands.filter((x:any)=>x.outcome==='ok')){expect(c.text.length).toBeLessThanOrEqual(131072);expect(c.truncated).toBe(true);expect(c.sha256).toMatch(/^[a-f0-9]{64}$/);}
 });
 it('retains timeout outcomes without retrying a diagnostic command',async()=>{
  let calls=0;const device=new NativeMapsDevice(config(),{commandTimeoutMs:15,adb:async(_f,_a,{signal})=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('stalled')),{once:true}));}});
  expect(typeof (device as any).appDiagnostics).toBe('function');const report=await (device as any).appDiagnostics();expect(calls).toBe(4);expect(report.commands.every((x:any)=>x.outcome==='failed'&&x.errorCode==='COMMAND_TIMEOUT')).toBe(true);
 });
 it('does not issue diagnostics after cancellation',async()=>{const controller=new AbortController();controller.abort();let calls=0;const device=new NativeMapsDevice(config(),{signal:controller.signal,adb:async()=>{calls++;return{stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)}}});expect(typeof (device as any).appDiagnostics).toBe('function');await expect((device as any).appDiagnostics()).rejects.toMatchObject({code:'CANCELLED'});expect(calls).toBe(0);});
});
