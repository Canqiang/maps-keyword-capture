import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { balancedShardStores, parseTrackingConfig, planScan, withStores } from '../src/domain/tracking-config.js';
import { parseTargetCatalog } from '../src/domain/target-catalog.js';
const root=new URL('../deploy/tracking-targets/',import.meta.url);
const read=(file:string)=>readFileSync(new URL(file,root),'utf8');
const catalogBytes=readFileSync(new URL('liya-90-v1.json',root));
const settings=parseTrackingConfig(JSON.parse(read('tracking.json')));
const androidSettings=parseTrackingConfig(JSON.parse(read('android-tracking.json')));
const catalog=parseTargetCatalog(JSON.parse(catalogBytes.toString('utf8')));
const docs=['web','android'].map(surface=>({surface,cron:parse(read(surface+'-cronjob.yaml'))}));
const option=(args:string[],name:string)=>args[args.indexOf(name)+1];

describe('isolated nine-store scheduler candidates',()=>{
 it.each(docs)('$surface runs the store configuration with balanced shards and keeps the legacy scheduler untouched',({surface,cron})=>{
  const job=cron.spec.jobTemplate.spec,pod=job.template.spec,main=pod.containers[0];
  expect(main.env).toContainEqual({name:'JOB_UID',valueFrom:{fieldRef:{fieldPath:"metadata.labels['batch.kubernetes.io/controller-uid']"}}});
  expect(main.env.find((e:any)=>e.name==='TRACKING_SCAN_GROUP')?.value).toBe(`${cron.metadata.namespace}/${cron.metadata.name}`);
  expect(cron.metadata).toMatchObject({name:surface==='web'?'maps-targets-web-2h':'maps-targets-android-daily',namespace:surface==='web'?'uat':'android-maps-pilot'});
  // Web every two hours; Android stays suspended on its prior daily template pending full capacity acceptance.
  expect(cron.spec).toMatchObject({schedule:surface==='web'?'15 */2 * * *':'0 21 * * *',timeZone:'America/New_York',concurrencyPolicy:'Forbid'});
  // Android: the namespace quota admits two emulator Pods (android-quota.yaml).
  expect(job).toMatchObject({completionMode:'Indexed',completions:surface==='web'?3:2,parallelism:surface==='web'?3:2,backoffLimitPerIndex:0,activeDeadlineSeconds:surface==='web'?6600:64800});
  // Both read stores from Mongo (what the settings page saves); no report catalog is pinned.
  expect(main.args).not.toContain('--catalog');expect(main.args).not.toContain('--catalog-sha256');
  expect((surface==='web'?settings:androidSettings).storeSource).toEqual({provider:'mongo',collection:'monitor-target-stores-v1'});
  if(surface==='web')expect(settings.surfaces.web.mapSearchMode).toBe('located_ui');
  else expect(androidSettings.surfaces.web.mapSearchMode).toBeUndefined();
  if(surface==='android')expect(androidSettings.surfaces.android.point).toMatchObject({everyHours:24,bestVariants:false});
  expect(option(main.args,'--surface')).toBe(surface);expect(option(main.args,'--shard-count')).toBe(String(job.completions));
  expect(option(main.args,'--shard-strategy')).toBe('balanced');expect(option(main.args,'--tier')).toBe('point');
  expect(pod.volumes.find((v:any)=>v.name==='config').configMap.name).toBe(surface==='web'?'maps-targets-web-located-beb1467':'maps-tracking-android-config');
  expect(pod).toMatchObject({automountServiceAccountToken:false,restartPolicy:'Never',terminationGracePeriodSeconds:300});
  expect(main.securityContext).toMatchObject({allowPrivilegeEscalation:false,readOnlyRootFilesystem:true});
  expect(main.securityContext.runAsNonRoot??pod.securityContext?.runAsNonRoot).toBe(true);
  const config=withStores(surface==='web'?settings:androidSettings,catalog.stores);
  const queries=Array.from({length:job.completions},(_,index)=>index).flatMap(index=>planScan(withStores(config,balancedShardStores(config,{surface:surface as 'web'|'android',tier:'point'},index,job.completions)),{surface:surface as 'web'|'android',tier:'point'}).queries);
  expect(queries).toHaveLength(270);expect(new Set(queries.map(q=>`${q.storeId}/${q.point.id}/${q.keyword}`)).size).toBe(270);
 });
 it('starts native services without credentials and keeps the collector away from KVM/userdata',()=>{
  const pod=docs[1]!.cron.spec.jobTemplate.spec.template.spec;
  const runtime=pod.initContainers.find((c:any)=>c.name==='android-runtime'),main=pod.containers[0],prepare=pod.initContainers[0];
  expect(runtime).toMatchObject({restartPolicy:'Always',command:['python3','/app/deploy/android/linux/tracking_sidecar.py'],securityContext:{privileged:true},resources:{requests:{cpu:'1500m',memory:'5Gi'},limits:{cpu:'2',memory:'6Gi'}}});
  expect(runtime.startupProbe.exec.command.join(' ')).toContain('/tmp/android-ready');
  // Worker 1 waits 180 s, then boot (510 s) and Appium (240 s) must fit inside the probe window.
  const job=docs[1]!.cron.spec.jobTemplate.spec;
  expect(runtime.startupProbe.periodSeconds*runtime.startupProbe.failureThreshold).toBeGreaterThan(180*(job.parallelism-1)+510+240);
  expect(JSON.stringify(runtime)).not.toMatch(/secretKeyRef|envFrom|MONGO_URI|SAS_URL/);
  expect(JSON.stringify(prepare)).not.toMatch(/secretKeyRef|envFrom|mountPath.*runtime/);
  expect(pod.securityContext?.fsGroup).toBeUndefined();expect(pod.hostNetwork).not.toBe(true);
  expect(pod.nodeSelector).toEqual({envpool:'crawler'});
  expect(pod.tolerations).toContainEqual({key:'maps-capture',operator:'Equal',value:'android',effect:'NoSchedule'});
  expect(main.securityContext).toMatchObject({privileged:false,runAsNonRoot:true,runAsUser:1001,capabilities:{drop:['ALL']}});
  expect(main.volumeMounts.find((v:any)=>v.name==='runtime')).toEqual({name:'runtime',mountPath:'/runtime/sdk',subPath:'sdk',readOnly:true});
  expect(main.volumeMounts.some((v:any)=>v.name==='kvm')).toBe(false);
  expect(main.env.find((e:any)=>e.name==='MAPS_ANDROID_ADB_PATH').value).toBe('/runtime/sdk/platform-tools/adb');
  expect(main.env.filter((e:any)=>e.valueFrom?.secretKeyRef).map((e:any)=>e.valueFrom.secretKeyRef.name).sort()).toEqual(['maps-targets-source','maps-targets-storage']);
  expect(runtime.env.find((e:any)=>e.name==='JOB_COMPLETION_INDEX').valueFrom.fieldRef.fieldPath).toContain('job-completion-index');
  expect(pod.volumes.find((v:any)=>v.name==='runtime').persistentVolumeClaim.claimName).toBe('android-runtime');
  const docker=readFileSync(new URL('../deploy/android/Dockerfile',import.meta.url),'utf8');
  expect(docker).toContain('COPY deploy/android ./deploy/android');
  expect(readFileSync(new URL('../deploy/android/linux/screen_ocr.py',import.meta.url),'utf8')).toContain('tesseract');
 });
 it('admits exactly the two emulator Pods the CronJob runs',()=>{
  const quota=parse(read('android-quota.yaml')),job=docs[1]!.cron.spec.jobTemplate.spec;
  expect(quota.metadata).toMatchObject({name:'single-emulator',namespace:'android-maps-pilot'});
  expect(Number(quota.spec.hard.pods)).toBe(job.parallelism);
  const pod=job.template.spec,cpu=(v:string)=>v.endsWith('m')?Number(v.slice(0,-1))/1000:Number(v);
  const requested=[...pod.initContainers,...pod.containers].filter((c:any)=>c.restartPolicy==='Always'||pod.containers.includes(c)).reduce((sum:number,c:any)=>sum+cpu(c.resources.requests.cpu),0);
  expect(requested*job.parallelism).toBeLessThanOrEqual(cpu(quota.spec.hard['requests.cpu']));
 });
 it('keeps all image references obviously unrendered until a verified remote build is selected',()=>{
  for(const {cron} of docs){
   const pod=cron.spec.jobTemplate.spec.template.spec;
   for(const c of [...(pod.initContainers??[]),...pod.containers])expect(c.image).toMatch(/@sha256:REPLACE_DIGEST_(WEB|ANDROID)$/);
  }
 });
});
