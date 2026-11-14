#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { loadTrackingConfig } from '../domain/tracking-config.js';
import { MongoVolumeStore } from './store.js';
import { planVolumes, retryVolumePlan, callVolumeTool, parseVolumeResponse, emptyVolume, mergeVolume, volumeIdentity, type VolumeRegion, type VolumeRow, type VolumeStore } from './sync.js';

async function main() {
  const requestDeadline = Date.now() + 90 * 60_000;
  const config = await loadTrackingConfig(process.env.TRACKING_CONFIG!);
  const uri = process.env.MAPS_TRACKING_MONGO_URI;
  if (!uri || !process.env.VOLUME_REGIONS_FILE) throw new Error('Missing volume sync configuration');
  const regions = JSON.parse(await readFile(process.env.VOLUME_REGIONS_FILE, 'utf8')) as Record<string, VolumeRegion>;
  const source = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000, socketTimeoutMS: 30_000, appName: 'maps-volume-source-readonly' });
  const volumes = new MongoVolumeStore(uri, config.database.database);
  const runId = randomUUID(), checkedAt = new Date().toISOString(); let locked = false;
  try {
    const stores = await source.db(config.database.database).collection<VolumeStore>(config.storeSource.collection).find({}).sort({ _id: 1 }).limit(501).toArray();
    if (stores.length > 500) throw new Error('Store limit exceeded');
    const plan = planVolumes(stores, regions);
    const log = (data: Record<string, unknown>) => process.stdout.write(JSON.stringify({ at: new Date().toISOString(), runId, ...data }) + '\n');
    log({ stage: 'plan', skipped: plan.skipped, stores: plan.stores.length, tasks: plan.tasks.length, distinctQueries: plan.tasks.reduce((n,t)=>n+t.keywords.length,0), storeQueries: plan.stores.reduce((n,s)=>n+s.queries.length,0), groups: plan.tasks.map(t=>({location:t.location,language:t.language,queries:t.keywords.length})) });
    if (process.argv.includes('--plan')) return;
    if (!process.env.CORE_AI_SERVER || !process.env.CORE_AI_API_KEY) throw new Error('Missing core-ai MCP credentials');
    locked = await volumes.acquire(runId, new Date());
    if (!locked) throw new Error('Another search-volume sync holds the lock');
    if (process.argv.includes('--single-recovery') && !process.argv.includes('--retry-recent')) throw new Error('Single recovery requires retry-recent');
    const snapshots = process.argv.includes('--retry-recent') ? await Promise.all(plan.stores.map(s=>volumes.get(s.storeId))) : [];
    const recovery = retryVolumePlan(plan, snapshots.filter((s): s is NonNullable<typeof s> => s !== null), new Date(), process.argv.includes('--single-recovery'));
    if (recovery.tasks.length > 60) throw new Error('Paid task budget exceeded (60 batches/run)');
    await volumes.saveRun(runId, { checkedAt, status: 'running', plan, requestedTasks: recovery.tasks, reused: recovery.reused });
    log({ stage: 'requests', batches: recovery.tasks.length, reusedQueries: recovery.reused.length });
    const results = new Map<string, VolumeRow>(recovery.reused.map(x=>[volumeIdentity(x.row), x.row])); let failures = plan.skipped.length;
    for (const [index, task] of recovery.tasks.entries()) {
      let rows: VolumeRow[]; let phase = 'request'; let response: unknown; let responseAt = new Date().toISOString();
      try {
        response = await callVolumeTool(process.env.CORE_AI_SERVER, process.env.CORE_AI_API_KEY, task, fetch, requestDeadline);
        responseAt = new Date().toISOString();
        phase = 'response_contract';
        rows = parseVolumeResponse(response, task, responseAt);
      } catch (error) {
        if (error instanceof Error && error.message === 'Search-volume runtime budget exhausted') phase = 'time_budget';
        const http = error instanceof Error ? /^core-ai MCP HTTP (\d{3})$/u.exec(error.message)?.[1] : undefined;
        await volumes.saveRun(runId, { [`errors.${index}`]: { phase, ...(http ? { httpStatus: Number(http) } : {}) } });
        failures++; rows = task.keywords.map(k => emptyVolume(k, task, new Date().toISOString(), 'error'));
        log({ stage: 'batch_error', batch: index, phase, reason: 'MCP request or response validation failed; no paid retry' });
      }
      if (rows.every(r=>r.status!=='error')) await volumes.saveRun(runId, { [`responses.${index}`]: response, [`responseTimes.${index}`]: responseAt });
      for (const row of rows) results.set(volumeIdentity(row), row);
      log({ stage: 'batch', batch: index, available: rows.filter(r=>r.status==='available').length, noData: rows.filter(r=>r.status==='no_data').length, errors: rows.filter(r=>r.status==='error').length });
    }
    for (const store of plan.stores) {
      const previous = await volumes.get(store.storeId);
      const rows = store.queries.map(q => {
        const current = results.get(volumeIdentity(q)); if (!current) throw new Error('Unresolved selected keyword');
        return mergeVolume(previous?.rows.find(r=>volumeIdentity(r)===volumeIdentity(q)), { ...current, keyword: q.keyword });
      });
      await volumes.save({ storeId: store.storeId, runId, checkedAt, rows });
    }
    const summary = { stage: 'complete', status: failures ? 'partial' : 'completed', skipped: plan.skipped, stores: plan.stores.length, distinctQueries: results.size, available: [...results.values()].filter(r=>r.status==='available').length, noData: [...results.values()].filter(r=>r.status==='no_data').length, failures, finishedAt: new Date().toISOString() };
    await volumes.saveRun(runId, summary); log(summary); if (failures) process.exitCode = 2;
  } catch (error) {
    if (locked) await volumes.saveRun(runId, { status: 'failed', finishedAt: new Date().toISOString(), errorCategory: 'configuration_or_storage_failure' }).catch(()=>{});
    throw error;
  } finally { if (locked) await volumes.release(runId); await Promise.all([source.close(), volumes.close()]); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { process.stderr.write('Search-volume sync failed; inspect run status and configuration. Credentials are not logged.\n'); process.exitCode = 1; });
