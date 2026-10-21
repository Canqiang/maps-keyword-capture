#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { monitorBrowserEnv } from '../monitor/cli-options.js';
import { createStore } from '../storage/factory.js';
import { deliveryStatus } from '../runner/manifest.js';
import { runWebScan, type FrozenCatalog } from './scan.js';
import type { BatchManifest, KeywordResult, ManifestDeliveryReceipt } from '../contracts.js';
import { ingestAndroidManifest, ingestWebBatch, type AndroidManifestLike } from './ingest.js';
import type { RankObservation } from './model.js';
import { MemoryObservationStore, MongoObservationStore, type ObservationStore } from './observation-store.js';
import { balancedShardStores, loadTrackingConfig, parseStore, planScan, shardStores, trackingIngestContext, toAndroidRuns, toWebBatches, withStores, type TrackingConfig, type ScanTier, type Surface } from './tracking-config.js';
import { MongoTrackingRepository } from './repository.js';
import { parseTargetCatalog, reconcileTargetStores } from './target-catalog.js';

const USAGE = [
  'Usage:',
  '  tracking plan   --config tracking.json --surface web|android --tier point|grid [--catalog catalog.json] [--store-id <id>] [--format queries|web-batches|android-runs]',
  '  tracking ingest --config tracking.json --surface web --store-id <id> --batch-dir <dir> [--point-id r0c0] [--manifest-key <key>] [--out file.json | --mongo-uri-env MAPS_TRACKING_MONGO_URI]',
  '  tracking ingest --config tracking.json --surface android --manifest manifest.json [--manifest-key <key>] [--out file.json | --mongo-uri-env MAPS_TRACKING_MONGO_URI]',
  '  tracking scan   --config tracking.json --surface web|android --tier point|grid [--catalog catalog.json --catalog-sha256 <sha256>] [--store-id <id>] [--storage local|azure] [--output-dir ./outputs] [--mongo-uri-env MAPS_TRACKING_MONGO_URI]',
  '  tracking recent --config tracking.json --mongo-uri-env MAPS_TRACKING_MONGO_URI [--store-id <id>] [--limit 20]',
  '  tracking stores --config tracking.json --mongo-uri-env MAPS_TRACKING_MONGO_URI (--list | --import stores.json)',
  '  tracking stores --config tracking.json --mongo-uri-env MAPS_TRACKING_MONGO_URI --import-catalog catalog.json',
  '  Azure ingest additionally requires --manifest-receipt <final-receipt.json>; --manifest-key must match it when supplied.',
  '  scan shards: --shard-index <i> --shard-count <n>, or JOB_COMPLETION_INDEX with --shard-count <n> (Indexed Jobs); optional --shard-strategy hash|balanced (default hash)',
].join('\n');

function parse(args: string[]): { command: string; options: Map<string, string> } {
  const options = new Map<string, string>();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i]!;
    if (options.has(flag)) throw new Error(`${flag} given more than once`);
    if (flag === '--list') { options.set(flag, 'true'); continue; }
    const value = args[++i];
    if (!flag.startsWith('--') || value === undefined || value.startsWith('--')) throw new Error(`invalid option near ${flag}`);
    options.set(flag, value);
  }
  return { command: args[0] ?? '', options };
}
const need = (options: Map<string, string>, flag: string): string => { const v = options.get(flag); if (v === undefined) throw new Error(`${flag} is required`); return v; };

async function openStore(config: TrackingConfig, options: Map<string, string>, env: NodeJS.ProcessEnv): Promise<{ store: ObservationStore; sink: string }> {
  const envName = options.get('--mongo-uri-env');
  if (envName) {
    const uri = env[envName];
    if (!uri) throw new Error(`${envName} is not set`);
    return { store: new MongoObservationStore({ uri, database: config.database.database, collection: config.database.collection }), sink: `mongo ${config.database.database}.${config.database.collection}` };
  }
  return { store: new MemoryObservationStore(), sink: options.get('--out') ?? 'stdout' };
}

function shardIndex(options: Map<string, string>, env: NodeJS.ProcessEnv): number {
  const raw = options.get('--shard-index') ?? env.JOB_COMPLETION_INDEX;
  const value = Number(raw);
  if (raw === undefined || !Number.isInteger(value)) throw new Error('--shard-count needs --shard-index or JOB_COMPLETION_INDEX');
  return value;
}
/** Resolve the catalog independently of scan sharding; history ingestion includes inactive stores. */
async function resolveStores(config: TrackingConfig, options: Map<string, string>, env: NodeJS.ProcessEnv, includeInactive = false): Promise<TrackingConfig> {
  let resolved = config;
  if (options.has('--catalog')) {
    const catalog = parseTargetCatalog(JSON.parse(await readFile(options.get('--catalog')!, 'utf8')));
    return withStores(config, catalog.stores);
  }
  if (config.storeSource.provider === 'mongo') {
    const envName = options.get('--mongo-uri-env');
    const uri = envName ? env[envName] : undefined;
    if (!uri) throw new Error('storeSource mongo needs --mongo-uri-env with a set variable');
    const repo = new MongoTrackingRepository({ uri, database: config.database.database, storesCollection: config.storeSource.collection, observationsCollection: config.database.collection });
    try {
      const stores = await repo.listStores({ includeInactive });
      resolved = withStores(config, stores.map(({ createdAt: _created, updatedAt: _updated, ...store }) => parseStore(store)));
    } finally { await repo.close(); }
  }
  return resolved;
}

/** One read supplies both shard assignment and execution; mutable Mongo stores are bypassed. */
async function frozenScanCatalog(config: TrackingConfig, options: Map<string, string>): Promise<{ config: TrackingConfig; snapshot: FrozenCatalog } | null> {
  const file = options.get('--catalog'), expected = options.get('--catalog-sha256');
  if (!file) {
    if (expected !== undefined) throw new Error('--catalog-sha256 requires --catalog');
    return null;
  }
  if (!expected || !/^[a-f0-9]{64}$/u.test(expected)) throw new Error('scan --catalog requires --catalog-sha256 with the approved exact file hash');
  const bytes = await readFile(file), sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expected) throw new Error('catalog SHA-256 does not match the pinned scan version');
  const catalog = parseTargetCatalog(JSON.parse(bytes.toString('utf8')));
  return { config: withStores(config, catalog.stores), snapshot: { version: catalog.version, sha256, bytes } };
}
function applyShard(config: TrackingConfig, options: Map<string, string>, env: NodeJS.ProcessEnv, selection: { surface: Surface; tier: ScanTier }): TrackingConfig {
  const count = options.get('--shard-count');
  const strategy = options.get('--shard-strategy') ?? 'hash';
  if (strategy !== 'hash' && strategy !== 'balanced') throw new Error('--shard-strategy must be hash or balanced');
  if (options.has('--shard-strategy') && count === undefined) throw new Error('--shard-strategy needs --shard-count');
  if (count === undefined) return config;
  const index = shardIndex(options, env);
  return withStores(config, strategy === 'balanced' ? balancedShardStores(config, selection, index, Number(count)) : shardStores(config.stores, index, Number(count)));
}

/** Manual imports use the same durable-delivery boundary as automatic scans. */
async function ingestReceipt(manifest: { persistenceMode?: unknown; runId: string; attemptId?: string }, bytes: Buffer, options: Map<string, string>): Promise<ManifestDeliveryReceipt | null> {
  if (manifest.persistenceMode === 'local_only') return null;
  if (manifest.persistenceMode !== 'azure_blob') throw new Error('manifest must declare local_only or azure_blob persistenceMode');
  const receipt = JSON.parse(await readFile(need(options, '--manifest-receipt'), 'utf8')) as ManifestDeliveryReceipt;
  if (receipt.storageStatus !== 'verified' || typeof receipt.objectKey !== 'string' || !receipt.objectKey
    || !receipt.verifiedAt || receipt.storageError !== null || receipt.bytes !== bytes.length
    || receipt.sha256 !== createHash('sha256').update(bytes).digest('hex')
    || (manifest.attemptId !== undefined && (receipt.runId !== manifest.runId || receipt.attemptId !== manifest.attemptId))
    || (options.has('--manifest-key') && options.get('--manifest-key') !== receipt.objectKey)) {
    throw new Error('Azure manifest receipt is unverified or does not match this manifest');
  }
  return receipt;
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
      const resolved = applyShard(await resolveStores(config, options, env), options, env, { surface, tier });
      const plan = planScan(resolved, { surface, tier, ...(storeId ? { storeIds: [storeId] } : {}) });
      const format = options.get('--format') ?? 'queries';
      const output = format === 'web-batches' ? toWebBatches(plan) : format === 'android-runs' ? toAndroidRuns(plan, resolved) : plan;
      console.log(JSON.stringify({ surface, tier, count: plan.queries.length, [format]: output }, null, 2));
      return 0;
    }
    if (command === 'ingest') {
      const surface = need(options, '--surface');
      const resolved = await resolveStores(config, options, env, true);
      const context = trackingIngestContext(resolved);
      let observations: RankObservation[];
      if (surface === 'web') {
        const storeId = need(options, '--store-id');
        const store = resolved.stores.find(s => s.storeId === storeId);
        if (!store) throw new Error(`unknown store ${storeId}`);
        const dir = need(options, '--batch-dir');
        const manifestBytes = await readFile(join(dir, 'manifest.json'));
        const manifest = JSON.parse(manifestBytes.toString('utf8')) as BatchManifest;
        const receipt = await ingestReceipt(manifest, manifestBytes, options);
        if (deliveryStatus(manifest, receipt) === 'failed') throw new Error('Azure batch evidence delivery is incomplete; ingestion withheld');
        const results = new Map<string, KeywordResult>();
        for (const entry of manifest.queries) {
          if (!entry.resultFile) continue;
          const filename = resolve(dir, entry.resultFile);
          if (!filename.startsWith(resolve(dir) + sep)) throw new Error('resultFile escapes batch directory');
          let resultBytes: Buffer;
          try { resultBytes = await readFile(filename); }
          catch { continue; /* Missing evidence stays unavailable, never a rank. */ }
          if (manifest.persistenceMode === 'azure_blob') {
            const artifact = manifest.artifacts.find(a => a.kind === 'result_json' && a.queryId === entry.queryId
              && a.queryAttemptId === entry.selectedQueryAttemptId && a.filename === basename(entry.resultFile)
              && entry.artifactIds.includes(a.id));
            if (!artifact || artifact.storageStatus !== 'verified' || artifact.bytes !== resultBytes.length
              || artifact.sha256 !== createHash('sha256').update(resultBytes).digest('hex')) {
              throw new Error(`selected result ${entry.queryId} does not match its verified artifact receipt; ingestion withheld`);
            }
          }
          try { results.set(entry.resultFile, JSON.parse(resultBytes.toString('utf8')) as KeywordResult); }
          catch { /* Invalid JSON stays unavailable. */ }
        }
        observations = ingestWebBatch({ manifest, results, attemptRoot: resolve(dir), store: { storeId: store.storeId, placeId: store.placeId }, ...(options.get('--point-id') ? { pointId: options.get('--point-id')! } : {}), manifestKey: receipt?.objectKey ?? options.get('--manifest-key') ?? null }, context);
      } else if (surface === 'android') {
        const manifestBytes = await readFile(need(options, '--manifest'));
        const manifest = JSON.parse(manifestBytes.toString('utf8')) as AndroidManifestLike & { persistenceMode?: string; artifacts?: Array<{ storageStatus: string }> };
        const receipt = await ingestReceipt(manifest, manifestBytes, options);
        if (manifest.persistenceMode === 'azure_blob' && (!manifest.artifacts || manifest.artifacts.some(a => a.storageStatus !== 'verified'))) throw new Error('Android Azure evidence delivery is incomplete; ingestion withheld');
        observations = ingestAndroidManifest({ manifest, placeIds: new Map(resolved.stores.map(s => [s.storeId, s.placeId])), manifestKey: receipt?.objectKey ?? options.get('--manifest-key') ?? null }, context);
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
      if (surface !== 'web' && surface !== 'android') throw new Error('--surface must be web or android');
      if (tier !== 'point' && tier !== 'grid') throw new Error('--tier must be point or grid');
      const storage = options.get('--storage') ?? 'local';
      if (storage !== 'local' && storage !== 'azure') throw new Error('--storage must be local or azure');
      const frozen = await frozenScanCatalog(config, options);
      const { store } = createStore(storage, options.get('--output-dir') ?? './outputs', env);
      const scanConfig = applyShard(frozen?.config ?? await resolveStores(config, options, env), options, env, { surface, tier });
      const { store: observations, sink } = await openStore(config, options, env);
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      const log = (event: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
      try {
        const storeId = options.get('--store-id');
        log({ stage: 'scan_stores', stores: scanConfig.stores.length, shard: options.get('--shard-count') ? `${shardIndex(options, env)}/${options.get('--shard-count')}` : null });
        const common = { config: scanConfig, tier: tier as ScanTier, store, observations, log, signal: controller.signal, ...(storeId ? { storeIds: [storeId] } : {}), ...(frozen ? { catalogSnapshot: frozen.snapshot } : {}) };
        const summary = surface === 'android'
          ? await (await import('./android-scan.js')).runAndroidScan({ ...common, env })
          : await runWebScan({ ...common,
            launch: () => chromium.launch({ channel: 'chromium', headless: true, chromiumSandbox: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false, env: monitorBrowserEnv(env) }) });
        console.log(JSON.stringify({ event: 'tracking_scan_finished', sink, ...summary }));
        return summary.exitCode;
      } catch (error) {
        // Operational failures are exit 1; 64 stays reserved for invalid input.
        console.error(error instanceof Error ? error.message.replace(/mongodb(\+srv)?:\/\/[^\s]*/gu, 'mongodb://***').slice(0, 300) : 'tracking scan failed');
        return 1;
      } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await observations.close(); }
    }
    if (command === 'stores') {
      if (['--list', '--import', '--import-catalog'].filter(flag => options.has(flag)).length > 1) throw new Error('--list, --import and --import-catalog are mutually exclusive');
      const envName = need(options, '--mongo-uri-env');
      const uri = env[envName];
      if (!uri) throw new Error(`${envName} is not set`);
      const repo = new MongoTrackingRepository({ uri, database: config.database.database, storesCollection: config.storeSource.collection, observationsCollection: config.database.collection });
      try {
        if (options.get('--import-catalog')) {
          const catalog = parseTargetCatalog(JSON.parse(await readFile(options.get('--import-catalog')!, 'utf8')));
          const reconciled = reconcileTargetStores(await repo.listStores({ includeInactive: true }), catalog);
          const saved = [];
          for (const item of reconciled) saved.push((await repo.saveStore(item, new Date(), { fillMissingCenter: true })).storeId);
          console.log(JSON.stringify({ event: 'tracking_catalog_imported', version: catalog.version, imported: saved.length, activeKeywordPairs: reconciled.reduce((n, s) => n + s.keywordTargets!.length, 0), storeIds: saved }));
        } else if (options.get('--import')) {
          const raw = JSON.parse(await readFile(options.get('--import')!, 'utf8')) as unknown;
          const list = Array.isArray(raw) ? raw : (raw as { stores?: unknown[] }).stores ?? [];
          const saved = [];
          for (const item of list) saved.push((await repo.saveStore(item)).storeId);
          console.log(JSON.stringify({ imported: saved.length, storeIds: saved }));
        } else {
          const stores = await repo.listStores({ includeInactive: true });
          console.log(JSON.stringify(stores.map(st => ({ storeId: st.storeId, name: st.name, active: st.active, keywords: st.keywords.core.length + st.keywords.longTail.length })), null, 2));
        }
      } finally { await repo.close(); }
      return 0;
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
    console.error((error instanceof Error ? error.message : String(error)).replace(/mongodb(\+srv)?:\/\/[^\s]*/gu, 'mongodb://***'));
    return 64;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
