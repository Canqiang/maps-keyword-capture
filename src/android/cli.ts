#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { ConfigError } from '../config.js';
import { createStore, parseStorageArg } from '../storage/factory.js';
import { loadAndroidConfig } from './config.js';
import { NativeMapsDevice } from './device.js';
import { runAndroidCapture } from './runner.js';

export function parseAndroidArgs(args: string[]) {
  const command=args[0];
  if (!command || !['validate','doctor','capture'].includes(command)) throw new ConfigError('Usage: android <validate|doctor|capture> --config <file> [--storage local|azure]');
  const seen=new Set<string>();
  let configPath: string | undefined;
  for (let i=1;i<args.length;i+=2) {
    const flag=args[i]!;const value=args[i+1];
    if(!['--config','--storage'].includes(flag) || seen.has(flag) || !value || value.startsWith('--')) throw new ConfigError('Unknown, duplicate or incomplete Android CLI option');
    seen.add(flag);if(flag==='--config') configPath=value;
  }
  if(!configPath) throw new ConfigError('--config is required');
  if(command!=='capture' && seen.has('--storage')) throw new ConfigError('--storage is only valid for capture');
  return {command,configPath,storage:parseStorageArg(args)};
}
export async function main(args=process.argv.slice(2)): Promise<number> {
  try {
    const options=parseAndroidArgs(args);
    const config=await loadAndroidConfig(options.configPath);
    if(options.command==='validate') { console.log(JSON.stringify({status:'valid',surface:'google_maps_android_app',tasks:config.tasks.length,stores:new Set(config.tasks.map(t=>t.storeId)).size,liveValidated:false}));return 0; }
    const controller=new AbortController();
    const device=new NativeMapsDevice(config,{signal:controller.signal});
    if(options.command==='doctor') { console.log(JSON.stringify({status:'ready',device:await device.preflight(),note:'Device prerequisites only; Appium session and native search remain untested.'}));return 0; }
    const {store}=createStore(options.storage,config.outputDirectory,process.env);
    const stop=()=>controller.abort();
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    try {
      const result=await runAndroidCapture(config,device,store,{signal:controller.signal});
      const cancelled=result.cancelled || controller.signal.aborted;
      const exitCode=cancelled ? 130 : result.exitCode;
      console.log(JSON.stringify({event:'android_maps_finished',runId:result.manifest.runId,executionStatus:result.manifest.executionStatus,rankingStatus:result.manifest.rankingStatus,ranked:result.manifest.queries.map(q=>({queryId:q.queryId,keyword:q.keyword,locationId:q.location.id,rankingStatus:q.rankingStatus,displayPosition:q.displayPosition,organicRank:q.organicRank,listingStatus:q.listingStatus,listings:q.listings.length})),counts:result.manifest.counts,manifestReceipt:result.receipt,cancelled,exitCode}));
      return exitCode;
    } finally { process.off('SIGINT',stop);process.off('SIGTERM',stop); }
  } catch(error) {
    // Do not echo transport bodies, command stderr, input URLs, or credentials.
    const code=error instanceof ConfigError ? 'invalid_config' : (error as {code?:unknown})?.code;
    console.error(JSON.stringify({event:'android_maps_error',code:typeof code==='string'&&/^[a-z_0-9-]{1,80}$/i.test(code)?code:'android_capture_failed',message:error instanceof ConfigError?error.message:'Check the device prerequisites and local evidence. No live capture success is asserted.'}));
    return error instanceof ConfigError?64:2;
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) process.exitCode=await main();
