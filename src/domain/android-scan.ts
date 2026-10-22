import { createHash } from 'node:crypto';
import { parseAndroidConfig } from '../android/config.js';
import type { AndroidCaptureConfig, AndroidDevice } from '../android/contracts.js';
import { NativeMapsDevice } from '../android/device.js';
import { runAndroidCapture, type AndroidCaptureOutput } from '../android/runner.js';
import type { StorageState } from '../contracts.js';
import { newRunId } from '../ids.js';
import { dateFolder } from '../naming.js';
import type { ArtifactStore } from '../storage/types.js';
import { ingestAndroidManifest } from './ingest.js';
import { organicRankForMetrics } from './model.js';
import type { ObservationStore } from './observation-store.js';
import { planScan, toAndroidRuns, trackingIngestContext, type ScanTier, type TrackingConfig } from './tracking-config.js';
import { persistScanCatalog, type FrozenCatalog, type ScanCatalogReceipt } from './scan.js';

export interface AndroidScanDeps {
  config: TrackingConfig; tier: ScanTier; store: ArtifactStore; observations: ObservationStore;
  storeIds?: string[]; signal?: AbortSignal; log?: (event: Record<string, unknown>) => void;
  env?: NodeJS.ProcessEnv; now?: () => Date; ingestRetryDelayMs?: number;
  deviceFactory?: (config: AndroidCaptureConfig) => AndroidDevice;
  batchRunner?: typeof runAndroidCapture;
  catalogSnapshot?: FrozenCatalog;
}
export interface AndroidScanSummary {
  scanId: string; surface: 'android'; tier: ScanTier; prefix: string; startedAt: string; finishedAt: string;
  status: 'completed'|'partial'|'failed'|'blocked'|'cancelled'; exitCode: 0|1|2;
  batches: { planned: number; run: number; failed: number; partial: number; deliveryFailed: number };
  queries: { planned: number; dispatched: number; observed: number; ranked: number; notFound: number; needsReview: number; failed: number; skipped: number };
  observations: { inserted: number; updated: number; notIngested: number };
  manifests: Array<{runId: string; objectKey: string|null; relativePath: string; bytes: number; sha256: string}>;
  summaryReceipt: StorageState|null;
  catalogSnapshot?: ScanCatalogReceipt;
}
function delivered(output: AndroidCaptureOutput, store: ArtifactStore): boolean {
  const receipt = output.receipt;
  const bytes = Buffer.from(JSON.stringify(output.manifest, null, 2));
  // The runner serializes with two-space indentation and publishes its exact terminal receipt.
  if (receipt.bytes !== bytes.length || receipt.sha256 !== createHash('sha256').update(bytes).digest('hex')) return false;
  const valid = (s: StorageState) => store.mode === 'azure_blob'
    ? s.storageStatus === 'verified' && !!s.objectKey && !!s.verifiedAt && s.storageError === null
    : s.storageStatus === 'local_only';
  return valid(receipt) && output.manifest.persistenceMode === store.mode && output.manifest.artifacts.every(valid);
}

/**
 * The capture limits proven on the verification Pod (probes 10-14, 2026-10-22): Top 20, up to 90
 * screenshots / 89 gestures / 10 minutes per query, OCR at scale 3 with a 30 s budget. Scheduled
 * scans use exactly these so a verified listing method is never run with a different profile.
 */
export const VERIFIED_CAPTURE_PROFILE = { maxDisplayedResults: 20, maxScreenshotsPerQuery: 90, maxScrolls: 89, keywordTimeoutMs: 600_000, ocrScale: 3, ocrTimeoutMs: 30_000 } as const;

/** Sequential, bounded device sessions. Review outcomes remain visible; operational faults stop the device. */
export async function runAndroidScan(deps: AndroidScanDeps): Promise<AndroidScanSummary> {
  const env=deps.env??process.env, now=deps.now??(()=>new Date()), log=deps.log??(()=>{});
  const started=now(), scanId=newRunId(started).replace(/^run_/u,'android_scan_');
  const prefix=`tracking/android/${dateFolder(started,deps.config.timezone)}/${deps.tier}/${scanId}`;
  const plan=planScan(deps.config,{surface:'android',tier:deps.tier,...(deps.storeIds?{storeIds:deps.storeIds}:{})});
  const runs=toAndroidRuns(plan,deps.config);
  const context={...trackingIngestContext(deps.config,{includeGridSpec:deps.tier==='grid',includeTargetSnapshot:true}),...(deps.tier==='grid'?{gridRunId:scanId}:{}),now};
  const summary:AndroidScanSummary={scanId,surface:'android',tier:deps.tier,prefix,startedAt:started.toISOString(),finishedAt:started.toISOString(),status:'completed',exitCode:0,
    batches:{planned:runs.length,run:0,failed:0,partial:0,deliveryFailed:0},queries:{planned:plan.queries.length,dispatched:0,observed:0,ranked:0,notFound:0,needsReview:0,failed:0,skipped:0},observations:{inserted:0,updated:0,notIngested:0},manifests:[],summaryReceipt:null};
  log({stage:'android_scan_start',scanId,queries:plan.queries.length,batches:runs.length});
  if(deps.catalogSnapshot){
    try {summary.catalogSnapshot=await persistScanCatalog(deps.catalogSnapshot,deps.config,deps.store,prefix);}
    catch {summary.status='failed';log({stage:'android_scan_catalog_failed',scanId});}
  }
  for(const plannedTasks of runs){
    if(summary.status==='failed')break;
    if(deps.signal?.aborted){summary.status='cancelled';break;}
    const tasks=summary.catalogSnapshot?plannedTasks.map(task=>({...task,sourceReference:`${task.sourceReference}; catalog sha256:${summary.catalogSnapshot!.sha256}`})):plannedTasks;
    const capture=parseAndroidConfig({schemaVersion:'android-maps-input/v1',serial:env.MAPS_ANDROID_SERIAL??'emulator-5554',adbPath:env.MAPS_ANDROID_ADB_PATH??'/runtime/sdk/platform-tools/adb',appiumUrl:env.MAPS_ANDROID_APPIUM_URL??'http://127.0.0.1:4723',timezone:deps.config.timezone,outputDirectory:deps.store.rootDirectory,...VERIFIED_CAPTURE_PROFILE,tasks});
    const device=deps.deviceFactory?.(capture)??new NativeMapsDevice(capture,{...(deps.signal?{signal:deps.signal}:{})});
    summary.queries.dispatched+=tasks.length;
    let output:AndroidCaptureOutput;
    try {output=await (deps.batchRunner??runAndroidCapture)(capture,device,deps.store,{...(deps.signal?{signal:deps.signal}:{})});}
    catch {summary.batches.failed++;summary.queries.failed+=tasks.length;summary.status=deps.signal?.aborted?'cancelled':'failed';log({stage:'android_batch_exception',scanId});break;}
    summary.batches.run++;
    if(!delivered(output,deps.store)){summary.batches.deliveryFailed++;summary.observations.notIngested++;summary.status='failed';log({stage:'android_delivery_failed',scanId,runId:output.manifest.runId});break;}
    summary.manifests.push({runId:output.manifest.runId,objectKey:output.receipt.objectKey,relativePath:output.receipt.relativePath,bytes:output.receipt.bytes,sha256:output.receipt.sha256});
    const observations=ingestAndroidManifest({manifest:output.manifest,placeIds:new Map(deps.config.stores.map(s=>[s.storeId,s.placeId])),manifestKey:output.receipt.objectKey},context);
    let inserted=false;
    for(let attempt=1;attempt<=2&&!inserted;attempt++){
      try {const result=await deps.observations.upsert(observations);summary.observations.inserted+=result.inserted;summary.observations.updated+=result.updated;inserted=true;}
      catch {log({stage:'android_ingest_retry',scanId,runId:output.manifest.runId,attempt});if(attempt===1)await new Promise(resolve=>setTimeout(resolve,deps.ingestRetryDelayMs??15000));}
    }
    if(!inserted)summary.observations.notIngested++;
    summary.queries.observed+=observations.length;
    summary.queries.needsReview+=output.manifest.counts.needsReview;
    summary.queries.failed+=output.manifest.counts.failed;
    summary.queries.skipped+=output.manifest.counts.skipped;
    for(const observation of observations){const rank=organicRankForMetrics(observation);if(typeof rank==='number')summary.queries.ranked++;else if(rank===null)summary.queries.notFound++;}
    if(output.exitCode!==0)summary.batches.partial++;
    log({stage:inserted?'android_batch_ingested':'android_batch_not_ingested',scanId,runId:output.manifest.runId,counts:output.manifest.counts,manifestReceipt:output.receipt,...(summary.catalogSnapshot?{catalogSha256:summary.catalogSnapshot.sha256}:{})});
    if(output.cancelled||deps.signal?.aborted){summary.status='cancelled';break;}
    if(output.manifest.queries.some(q=>q.stopReason==='screen_blocked'||q.stopReason==='screen_consent')){summary.status='blocked';break;}
    if(output.manifest.errors.length||output.manifest.counts.failed||output.manifest.counts.skipped){summary.status='failed';summary.batches.failed++;break;}
  }
  summary.queries.skipped+=summary.queries.planned-summary.queries.dispatched;
  if(summary.status==='completed'&&(summary.batches.partial||summary.observations.notIngested))summary.status='partial';
  summary.exitCode=summary.status==='completed'?0:summary.status==='partial'?2:1;
  summary.finishedAt=now().toISOString();
  try {
    summary.summaryReceipt=await deps.store.persist(await deps.store.writeFile(`${prefix}/scan.json`,JSON.stringify(summary,null,2)));
    if(deps.store.mode==='azure_blob'?summary.summaryReceipt.storageStatus!=='verified':summary.summaryReceipt.storageStatus!=='local_only')throw new Error('summary delivery unverified');
  } catch {summary.status='failed';summary.exitCode=1;log({stage:'android_scan_summary_failed',scanId});}
  log({stage:'android_scan_finished',...summary});return summary;
}
