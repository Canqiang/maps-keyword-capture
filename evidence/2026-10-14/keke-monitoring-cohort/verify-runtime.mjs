import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '/app/node_modules/playwright/index.mjs';
import { parseMonitorConfig } from '/app/dist/monitor/config.js';
import { parseConfig } from '/app/dist/config.js';
import { selectStoreKeywords } from '/app/dist/monitor/selection.js';
import { KeywordApiSource, selectKeywords } from '/app/dist/monitor/source.js';
import { MongoStoreRegistrySource } from '/app/dist/monitor/registry.js';
import { createMonitorShutdown, monitorBrowserEnv } from '/app/dist/monitor/cli-options.js';
import { runBatch } from '/app/dist/runner/batch-runner.js';
import { createStore } from '/app/dist/storage/factory.js';
import { deliveryStatus } from '/app/dist/runner/manifest.js';
const controller=new AbortController();
const shutdown=createMonitorShutdown(controller,()=>process.stdout.write(JSON.stringify({runtimeValidationFailed:true,reason:'shutdown_grace_exceeded'})+'\n',()=>process.exit(1)));
for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,()=>shutdown(signal));
const log = data => process.stdout.write(JSON.stringify(data)+'\n');
async function main() {
  const config=parseMonitorConfig(JSON.parse(await readFile('/config/monitor.json','utf8')));
  const original=parseMonitorConfig(JSON.parse(await readFile('/probe/monitor-before.json','utf8')));
  const {monitoringKeywordSets,...rest}=config;
  assert.deepEqual(rest,original);
  assert.equal(monitoringKeywordSets.length,1);
  const cohort=monitoringKeywordSets[0];
  assert.equal(cohort.placeId,'ChIJRTD3Ws5hwokRES78IFU7zW0');
  assert.equal(cohort.merchantId,'29742a52-d824-469b-a395-52084345b7ad');
  const registry=await new MongoStoreRegistrySource({uri:process.env.KEYWORD_MONGO_URI,config:config.storeDiscovery,aliases:config.stores}).read(controller.signal);
  assert.equal(registry.counts.quarantined??0,0);
  assert(registry.stores.some(s=>s.placeId===cohort.placeId));
  assert(!registry.stores.some(s=>s.placeId==='ChIJqVId_y1ZwokRjPCG1MQuKmg'));
  const source=new KeywordApiSource({baseUrl:config.sourceBaseUrl,timeoutMs:config.sourceTimeoutMs,...(process.env.KEYWORD_API_TOKEN?{token:process.env.KEYWORD_API_TOKEN}:{})});
  const selections=[];
  for(const s of registry.stores){
    const record=await source.read(s,controller.signal);
    const selection=selectStoreKeywords(record,s,config);
    const previous=selectKeywords(record.keywords,config.maxKeywordsPerStore);
    if(s.placeId===cohort.placeId){
      assert.deepEqual(selection.keywords.map(k=>k.keyword),cohort.keywords.map(k=>k.keyword));
      assert.equal(selection.keywords.length,40);
      assert.deepEqual(selection.monitoringCohort.groups,{core:32,exploration:6,brand:2});
      assert.equal(selection.keywords.filter(k=>previous.keywords.some(p=>p.keyword===k.keyword)).length,6);
    }else{
      const {selectionPolicy,...same}=selection;
      assert.deepEqual(same,previous);
    }
    selections.push({storeId:s.storeId,placeId:s.placeId,sourceCount:record.keywords.length,sourceResponseHash:record.sourceResponseHash,selected:selection.keywords,monitoringCohort:selection.monitoringCohort??null});
  }
  log({selectionValidation:true,passed:true,at:new Date().toISOString(),runtimeCommit:process.env.GIT_COMMIT,imageDigest:process.env.IMAGE_DIGEST,registryCounts:registry.counts,selections});
  const smokeConfig=parseConfig(JSON.parse(await readFile('/probe/smoke-config.json','utf8'))).config;
  assert(smokeConfig.keywords.every(k=>cohort.keywords.some(c=>c.keyword===k)));
  const {store}=createStore('azure',smokeConfig.outputDirectory,process.env);
  const out=await runBatch({config:smokeConfig,store,log,signal:controller.signal,launch:()=>chromium.launch({channel:'chromium',headless:true,chromiumSandbox:true,handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false,env:monitorBrowserEnv(process.env)})});
  const counts={};for(const q of out.manifest.queries)counts[q.status]=(counts[q.status]??0)+1;
  // Complete non-ranking count is determined by the same manifest contract as the CLI.
  const {isCompleteNonRankingObservation}=await import('/app/dist/runner/manifest.js');
  counts.nonRanking=out.manifest.queries.filter(q=>isCompleteNonRankingObservation(out.manifest,q)).length;
  log({summary:true,runId:out.manifest.runId,attemptId:out.manifest.attemptId,status:out.manifest.status,executionStatus:out.manifest.executionStatus,counts,manifestReceipt:out.manifestReceipt,remotePersistence:deliveryStatus(out.manifest,out.manifestReceipt),exitCode:out.exitCode});
  return out.exitCode;
}
main().then(code=>process.stdout.write('',()=>process.exit(code)),()=>process.stdout.write(JSON.stringify({runtimeValidationFailed:true})+'\n',()=>process.exit(1)));
