#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { generateGrid, type GridPoint } from '../grid/grid.js';
import { monitorBrowserEnv } from '../monitor/cli-options.js';
import { createStore } from '../storage/factory.js';
import { runWebScan } from './scan.js';
import type { BatchManifest, KeywordResult } from '../contracts.js';
import { ingestAndroidManifest, ingestWebBatch, type AndroidManifestLike } from './ingest.js';
import { keywordKey, type RankObservation } from './model.js';
import { MemoryObservationStore, MongoObservationStore, type ObservationStore } from './observation-store.js';
import { centerPoint, loadTrackingConfig, planScan, storeGridSpec, toAndroidRuns, toWebBatches, type TrackingConfig } from './tracking-config.js';

const USAGE = [
  'Usage:',
  '  tracking plan   --config tracking.json --surface web|android --tier point|grid [--store-id <id>] [--format queries|web-batches|android-runs]',
  '  tracking ingest --config tracking.json --surface web --store-id <id> --batch-dir <dir> [--point-id r0c0] [--manifest-key <key>] [--out file.json | --mongo-uri-env MAPS_TRACKING_MONGO_URI]',
  '  tracking ingest --config tracking.json --surface android --manifest manifest.json [--manifest-key <key>] [--out file.json | --mongo-uri-env MAPS_TRACKING_MONGO_URI]',
  '  tracking scan   --config tracking.json --surface web --tier point|grid [--store-id <id>] [--storage local|azure] [--output-dir ./outputs] [--mongo-uri-env MAPS_TRACKING_MONGO_URI]',
  '  tracking recent --config tracking.json --mongo-uri-env MAPS_TRACKING_MONGO_URI [--store-id <id>] [--limit 20]',
].join('\n');

function parse(args: string[]): { command: string; options: Map<string, string> } {
  const options = new Map<string, string>();
  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i]!, value = args[i + 1];
    if (!flag.startsWith('--') || value === undefined || value.startsWith('--')) throw new Error(`invalid option near ${flag}`);
    if (options.has(flag)) throw new Error(`${flag} given more than once`);
    options.set(flag, value);
  }
  return { command: args[0] ?? '', options };
}
const need = (options: Map<string, string>, flag: string): string => { const v = options.get(flag); if (v === undefined) throw new Error(`${flag} is required`); return v; };

/** Every planned point of every store, so ingestion can attach distance and ring to an observation. */
function allPoints(config: TrackingConfig): Map<string, GridPoint> {
  const points = new Map<string, GridPoint>();
  for (const store of config.stores) {
    points.set('r0c0', centerPoint(store));
    for (const point of generateGrid(storeGridSpec(config, store))) points.set(point.id, point);
  }
  return points;
}
function keywordTiers(config: TrackingConfig): Map<string, 'core' | 'longTail'> {
  const tiers = new Map<string, 'core' | 'longTail'>();
  for (const store of config.stores) {
    for (const k of store.keywords.core) tiers.set(keywordKey(k), 'core');
    for (const k of store.keywords.longTail) tiers.set(keywordKey(k), 'longTail');
  }
  return tiers;
}
async function openStore(config: TrackingConfig, options: Map<string, string>, env: NodeJS.ProcessEnv): Promise<{ store: ObservationStore; sink: string }> {
  const envName = options.get('--mongo-uri-env');
  if (envName) {
    const uri = env[envName];
    if (!uri) throw new Error(`${envName} is not set`);
    return { store: new MongoObservationStore({ uri, database: config.database.database, collection: config.database.collection }), sink: `mongo ${config.database.database}.${config.database.collection}` };
  }
  return { store: new MemoryObservationStore(), sink: options.get('--out') ?? 'stdout' };
}

export async function main(args = process.argv.slice(2), env = process.env): Promise<number> {
  try {
    const { command, options } = parse(args);
    const config = await loadTrackingConfig(need(options, '--config'));
    if (command === 'plan') {
      const surface = need(options, '--surface'), tier = need(options, '--tier');
      if (surface !== 'web' && surface !== 'android') throw new Error('--surface must be web or android');
      if (tier !== 'point' && tier !== 'grid') throw new Error('--tier must be point or grid');
      const storeId = options.get('--store-id');
      const plan = planScan(config, { surface, tier, ...(storeId ? { storeIds: [storeId] } : {}) });
      const format = options.get('--format') ?? 'queries';
      const output = format === 'web-batches' ? toWebBatches(plan) : format === 'android-runs' ? toAndroidRuns(plan, config) : plan;
      console.log(JSON.stringify({ surface, tier, count: plan.queries.length, [format]: output }, null, 2));
      return 0;
    }
    if (command === 'ingest') {
      const surface = need(options, '--surface');
      const context = { timezone: config.timezone, points: allPoints(config), keywordTiers: keywordTiers(config) };
      let observations: RankObservation[];
      if (surface === 'web') {
        const storeId = need(options, '--store-id');
        const store = config.stores.find(s => s.storeId === storeId);
        if (!store) throw new Error(`unknown store ${storeId}`);
        const dir = need(options, '--batch-dir');
        const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as BatchManifest;
        const results = new Map<string, KeywordResult>();
        for (const entry of manifest.queries) {
          if (!entry.resultFile) continue;
          const candidates = (await readdir(dir, { recursive: true })).filter(name => name.endsWith(entry.resultFile!) || entry.resultFile!.endsWith(name));
          if (candidates[0]) results.set(entry.resultFile, JSON.parse(await readFile(join(dir, candidates[0]), 'utf8')) as KeywordResult);
        }
        observations = ingestWebBatch({ manifest, results, store: { storeId: store.storeId, placeId: store.placeId }, ...(options.get('--point-id') ? { pointId: options.get('--point-id')! } : {}), manifestKey: options.get('--manifest-key') ?? null }, context);
      } else if (surface === 'android') {
        const manifest = JSON.parse(await readFile(need(options, '--manifest'), 'utf8')) as AndroidManifestLike;
        observations = ingestAndroidManifest({ manifest, placeIds: new Map(config.stores.map(s => [s.storeId, s.placeId])), manifestKey: options.get('--manifest-key') ?? null }, context);
      } else throw new Error('--surface must be web or android');
      const { store, sink } = await openStore(config, options, env);
      try {
        const result = await store.upsert(observations);
        if (store instanceof MemoryObservationStore && options.get('--out')) await (await import('node:fs/promises')).writeFile(options.get('--out')!, JSON.stringify(observations, null, 2));
        else if (store instanceof MemoryObservationStore) console.log(JSON.stringify(observations, null, 2));
        console.error(JSON.stringify({ event: 'tracking_ingested', surface, sink, observations: observations.length, ...result }));
      } finally { await store.close(); }
      return 0;
    }
    if (command === 'scan') {
      const surface = need(options, '--surface'), tier = need(options, '--tier');
      if (surface !== 'web') throw new Error('scan supports --surface web only; Android scans run through the Android collector');
      if (tier !== 'point' && tier !== 'grid') throw new Error('--tier must be point or grid');
      const storage = options.get('--storage') ?? 'local';
      if (storage !== 'local' && storage !== 'azure') throw new Error('--storage must be local or azure');
      const { store } = createStore(storage, options.get('--output-dir') ?? './outputs', env);
      const { store: observations, sink } = await openStore(config, options, env);
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      const log = (event: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
      try {
        const storeId = options.get('--store-id');
        const summary = await runWebScan({ config, tier, store, observations, log, signal: controller.signal, ...(storeId ? { storeIds: [storeId] } : {}),
          launch: () => chromium.launch({ channel: 'chromium', headless: true, chromiumSandbox: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false, env: monitorBrowserEnv(env) }) });
        console.log(JSON.stringify({ event: 'tracking_scan_finished', sink, ...summary }));
        return summary.exitCode;
      } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await observations.close(); }
    }
    if (command === 'recent') {
      const { store, sink } = await openStore(config, options, env);
      if (!(store instanceof MongoObservationStore)) throw new Error('recent needs --mongo-uri-env');
      try {
        const limit = Number(options.get('--limit') ?? '20');
        const rows = await store.recent({ ...(options.get('--store-id') ? { storeId: options.get('--store-id')! } : {}), limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 20 });
        console.log(JSON.stringify({ sink, count: rows.length, rows: rows.map(r => ({ observedAt: r.observedAt, surface: r.surface, storeId: r.storeId, keyword: r.keyword, pointId: r.pointId, status: r.rank.status, displayPosition: r.rank.displayPosition, organicRank: r.rank.organicRank, listings: r.rank.listingsObserved, scanId: r.scanId })) }, null, 2));
      } finally { await store.close(); }
      return 0;
    }
    throw new Error(USAGE);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 64;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
