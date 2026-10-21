#!/usr/bin/env node
/** Append an audited archive to tracking history. Default is a read-only database plan. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { MongoClient, type Document } from 'mongodb';
import type { RankObservation } from '../domain/model.js';
import type { StoredStore } from '../domain/repository.js';
import { loadSnapshot } from './snapshot.js';

const identityFields = ['observationId', 'surface', 'storeId', 'placeId', 'keywordKey', 'pointId', 'locationMode', 'observedAt', 'scanId', 'queryId'] as const;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([key, item]) => key !== '_id' && item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
export interface HistoryArchive { stores: StoredStore[]; observations: RankObservation[] }
export function planHistoryImport(source: HistoryArchive, existing: HistoryArchive) {
  const conflicts: string[] = [], insertStores: StoredStore[] = [], insertObservations: RankObservation[] = [];
  const byStore = new Map(existing.stores.map(s => [s.storeId, s]));
  const byPlace = new Map(existing.stores.map(s => [s.placeId, s]));
  for (const store of source.stores) {
    const sameId = byStore.get(store.storeId), samePlace = byPlace.get(store.placeId);
    if (sameId && sameId.placeId !== store.placeId) conflicts.push(`store identity conflict: ${store.storeId}`);
    else if (samePlace && samePlace.storeId !== store.storeId) conflicts.push(`Place ID already uses a different store ID: ${store.storeId}`);
    else if (!sameId) insertStores.push({ ...store, active: false });
  }
  const existingRows = new Map(existing.observations.map(o => [o.observationId, o]));
  let preservedObservations = 0, preservedPayloadDifferences = 0;
  for (const row of source.observations) {
    const old = existingRows.get(row.observationId);
    if (!old) insertObservations.push(row);
    else if (identityFields.some(field => old[field] !== row[field]) || (['latitude', 'longitude'] as const).some(field => typeof old.point?.[field] === 'number' && typeof row.point?.[field] === 'number' && old.point[field] !== row.point[field])) conflicts.push(`observation identity conflict: ${row.observationId}`);
    else { preservedObservations++; if (canonical(old) !== canonical(row)) preservedPayloadDifferences++; }
  }
  return { conflicts, insertStores, insertObservations, preservedObservations, preservedPayloadDifferences };
}

async function main() {
  const args = process.argv.slice(2), options = new Map<string, string>();
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    const name = args[i]!;
    if (name === '--apply') { apply = true; continue; }
    if (!['--snapshot', '--database', '--mongo-uri-env', '--stores-collection'].includes(name) || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Usage: history-import --snapshot archive.json --database maps-rank-tracking --mongo-uri-env MAPS_TRACKING_MONGO_URI [--stores-collection monitor-target-stores-v1] [--apply]');
    if (options.has(name)) throw new Error('duplicate argument');
    options.set(name, args[++i]!);
  }
  const file = options.get('--snapshot'), database = options.get('--database'), env = options.get('--mongo-uri-env');
  const storesCollection = options.get('--stores-collection') ?? 'stores';
  if (!file || !database || !env || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/u.test(database) || !process.env[env]) throw new Error('snapshot, database and a configured URI environment variable are required');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/u.test(storesCollection) || storesCollection === 'observations') throw new Error('invalid stores collection');
  const bytes = await readFile(file), raw = JSON.parse(bytes.toString('utf8'));
  const checked = await loadSnapshot(file);
  // Validation is separate from preservation: keep raw Android card metadata and provenance.
  const source: HistoryArchive = { stores: await checked.repo.listStores({ includeInactive: true }), observations: raw.observations };
  const snapshotSha256 = createHash('sha256').update(bytes).digest('hex');
  const client = new MongoClient(process.env[env]!, { appName: 'maps-tracking-history-import', serverSelectionTimeoutMS: 15_000 });
  try {
    await client.connect();
    const db = client.db(database), stores = db.collection(storesCollection), observations = db.collection('observations');
    const readExisting = async (): Promise<HistoryArchive> => {
      const rows: RankObservation[] = [];
      for (let i = 0; i < source.observations.length; i += 500) {
        const ids = source.observations.slice(i, i + 500).map(o => o.observationId);
        rows.push(...await observations.find({ observationId: { $in: ids } }, { projection: { _id: 0 } }).toArray() as unknown as RankObservation[]);
      }
      return { stores: await stores.find({}, { projection: { _id: 0 } }).toArray() as unknown as StoredStore[], observations: rows };
    };
    const existing = await readExisting(), plan = planHistoryImport(source, existing);
    if (plan.conflicts.length) {
      process.stdout.write(JSON.stringify({ mode: 'blocked', snapshotSha256, conflicts: plan.conflicts }) + '\n');
      process.exitCode = 2; return;
    }
    const counts = { sourceStores: source.stores.length, sourceObservations: source.observations.length, appendStores: plan.insertStores.length, appendObservations: plan.insertObservations.length, preserveExistingObservations: plan.preservedObservations, preserveExistingPayloadDifferences: plan.preservedPayloadDifferences, indexedScreenshots: raw.evidence.length };
    if (!apply) {
      process.stdout.write(JSON.stringify({ mode: 'read-only-plan', database, storesCollection, snapshotSha256, counts, storesToAppendPaused: plan.insertStores.map(s => s.storeId), imageAvailabilityVerified: false }) + '\n');
      return;
    }
    // Match the repository's identity guard before the new collection gets its first rows.
    await stores.createIndex({ placeId: 1 }, { name: 'placeId', unique: true });
    // $setOnInsert never replaces an existing record. Extra identity conditions fail closed on races.
    for (const store of plan.insertStores) {
      await stores.updateOne({ _id: store.storeId, placeId: store.placeId } as unknown as Document, { $setOnInsert: store }, { upsert: true });
    }
    for (let i = 0; i < plan.insertObservations.length; i += 250) {
      const batch = plan.insertObservations.slice(i, i + 250);
      await observations.bulkWrite(batch.map(row => ({ updateOne: {
        filter: { _id: row.observationId, ...Object.fromEntries(identityFields.map(field => [field, row[field]])) } as unknown as Document,
        update: { $setOnInsert: row }, upsert: true,
      } })), { ordered: true });
    }
    const readback = await readExisting(), verified = planHistoryImport(source, readback);
    if (verified.conflicts.length || verified.insertStores.length || verified.insertObservations.length) throw new Error('history import readback did not match all source identities');
    process.stdout.write(JSON.stringify({ mode: 'applied-append-only', database, storesCollection, snapshotSha256, counts, readback: { stores: source.stores.length, observations: verified.preservedObservations, missing: 0, identityConflicts: 0 }, imageAvailabilityVerified: false }) + '\n');
  } finally { await client.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  // Driver diagnostics can contain connection strings; callers receive a sanitized failure.
  process.stderr.write('History import failed; no existing records were replaced. Read back the append state before retrying.\n');
  process.exitCode = 1;
});
