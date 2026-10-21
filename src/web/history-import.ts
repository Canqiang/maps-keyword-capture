#!/usr/bin/env node
/** Append an audited archive to tracking history. Default is a read-only database plan. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { MongoClient, type Collection, type Document } from 'mongodb';
import { observationId, type RankObservation } from '../domain/model.js';
import type { StoredStore } from '../domain/repository.js';
import { loadSnapshot } from './snapshot.js';

const identityFields = ['observationId', 'surface', 'storeId', 'placeId', 'keywordKey', 'pointId', 'locationMode', 'observedAt', 'scanId', 'queryId'] as const;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([key, item]) => key !== '_id' && item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
export interface HistoryArchive { stores: StoredStore[]; observations: RankObservation[] }
export interface HistoryAlias {
  archivedId: string; retainedId: string; manifestKey: string; resultKey: string;
  archivedPayloadSha256: string; retainedPayloadSha256: string; payloadDifference: boolean;
}
/** The exact pre-v2 algorithm; never infer an alias from only a timestamp or rank. */
function legacyObservationId(row: RankObservation): string {
  return `${row.surface}|${row.storeId}|${row.keywordKey}|${row.pointId}|${row.observedAt}`;
}
function literalKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.+\-/%一-鿿]+$/u.test(value)) return false;
  try {
    return [value, decodeURIComponent(value)].every(key => !key.includes('\\') && key.split('/').every(part => part !== '' && part !== '.' && part !== '..'));
  } catch { return false; }
}
function manifestKey(row: RankObservation): string | null {
  const key = row.evidence?.manifestKey;
  return literalKey(key) && /^(?:tracking|android-maps|maps-keyword-capture|\d{4}-\d{2}-\d{2})\//u.test(key) && key.endsWith('/manifest.json') ? key : null;
}
function selectedWebResultKey(row: RankObservation, manifest: string): string | null {
  const key = row.evidence?.resultKey, prefix = manifest.slice(0, -'manifest.json'.length);
  if (!literalKey(key)) return null;
  // Legacy Web ingest retained query-relative resultFile; new ingest retains
  // the full object key. Only this exact manifest-relative conversion is safe.
  const relative = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  const parts = relative.split('/'), path = prefix.split('/').filter(Boolean);
  if (parts.length !== 3 || parts[0] !== row.queryId || !/^qa\d+$/u.test(parts[1]!) || !parts[2]!.endsWith('.json')
    || path.at(-2) !== row.scanId || !/^att_[A-Za-z0-9_-]+$/u.test(path.at(-1) ?? '')
    || (row.source.attemptId != null && row.source.attemptId !== path.at(-1))
    || (row.source.queryAttemptId != null && row.source.queryAttemptId !== parts[1])) return null;
  return prefix + relative;
}
function captureAlias(archived: RankObservation, retained: RankObservation): HistoryAlias | null {
  if (archived.surface !== 'web' || archived.observationId !== observationId(archived)
    || !archived.source?.attemptId || !archived.source.queryAttemptId
    || identityFields.some(field => field !== 'observationId' && archived[field] !== retained[field])) return null;
  for (const field of ['latitude', 'longitude'] as const) {
    if (!Number.isFinite(archived.point?.[field]) || !Number.isFinite(retained.point?.[field]) || archived.point[field] !== retained.point[field]) return null;
  }
  if (archived.point.zoom != null && retained.point.zoom != null && archived.point.zoom !== retained.point.zoom) return null;
  for (const field of ['profileHash', 'adapterVersion'] as const) {
    if (!archived.source[field] || archived.source[field] !== retained.source?.[field]) return null;
  }
  for (const field of ['attemptId', 'queryAttemptId'] as const) {
    if (retained.source?.[field] != null && retained.source[field] !== archived.source[field]) return null;
  }
  const manifest = manifestKey(archived);
  if (!manifest || manifest !== manifestKey(retained)) return null;
  const result = selectedWebResultKey(archived, manifest);
  if (!result || result !== selectedWebResultKey(retained, manifest)) return null;
  const selectedDirectory = result.slice(0, result.lastIndexOf('/') + 1);
  const images = archived.evidence.screenshotKeys, oldImages = retained.evidence.screenshotKeys;
  const validImage = (key: string) => literalKey(key) && key.startsWith(selectedDirectory) && key.endsWith('.png');
  if (!images.length || images.some(key => !validImage(key)) || oldImages.some(key => !validImage(key))
    || canonical([...new Set(images)].sort()) !== canonical([...new Set(oldImages)].sort())) return null;
  const archivedPayload = canonical(archived), retainedPayload = canonical(retained);
  return { archivedId: archived.observationId, retainedId: retained.observationId, manifestKey: manifest, resultKey: result,
    archivedPayloadSha256: createHash('sha256').update(archivedPayload).digest('hex'), retainedPayloadSha256: createHash('sha256').update(retainedPayload).digest('hex'),
    payloadDifference: archivedPayload !== retainedPayload };
}
export async function readHistoryObservations(collection: Pick<Collection, 'find'>, source: RankObservation[]): Promise<RankObservation[]> {
  const rows: RankObservation[] = [];
  const ids = [...new Set(source.flatMap(row => [row.observationId, legacyObservationId(row)]))];
  for (let i = 0; i < ids.length; i += 500) {
    // MongoObservationStore persists observationId as the indexed _id. Some hosted
    // Mongo services reject scans of the deliberately unindexed duplicate field.
    rows.push(...await collection.find({ _id: { $in: ids.slice(i, i + 500) } } as Document, { projection: { _id: 0 } }).toArray() as unknown as RankObservation[]);
  }
  return rows;
}
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
  const candidates = new Map<string, number>();
  for (const row of source.observations) candidates.set(legacyObservationId(row), (candidates.get(legacyObservationId(row)) ?? 0) + 1);
  const aliases: HistoryAlias[] = [];
  let preservedObservations = 0, preservedPayloadDifferences = 0;
  for (const row of source.observations) {
    const old = existingRows.get(row.observationId);
    const legacyId = legacyObservationId(row), legacy = legacyId === row.observationId ? undefined : existingRows.get(legacyId);
    if (legacy && (old || candidates.get(legacyId) !== 1)) {
      conflicts.push(`ambiguous legacy observation alias: ${row.observationId}`); continue;
    }
    if (legacy) {
      const alias = captureAlias(row, legacy);
      if (!alias) conflicts.push(`unverified legacy observation alias: ${row.observationId}`);
      else aliases.push(alias);
      continue;
    }
    if (!old) insertObservations.push(row);
    else if (identityFields.some(field => old[field] !== row[field]) || (['latitude', 'longitude'] as const).some(field => typeof old.point?.[field] === 'number' && typeof row.point?.[field] === 'number' && old.point[field] !== row.point[field])) conflicts.push(`observation identity conflict: ${row.observationId}`);
    else { preservedObservations++; if (canonical(old) !== canonical(row)) preservedPayloadDifferences++; }
  }
  return { conflicts, insertStores, insertObservations, preservedObservations, preservedPayloadDifferences, aliases };
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
      const rows = await readHistoryObservations(observations, source.observations);
      return { stores: await stores.find({}, { projection: { _id: 0 } }).toArray() as unknown as StoredStore[], observations: rows };
    };
    const existing = await readExisting(), plan = planHistoryImport(source, existing);
    if (plan.conflicts.length) {
      process.stdout.write(JSON.stringify({ mode: 'blocked', snapshotSha256, conflicts: plan.conflicts }) + '\n');
      process.exitCode = 2; return;
    }
    const counts = { sourceStores: source.stores.length, sourceObservations: source.observations.length, appendStores: plan.insertStores.length, appendObservations: plan.insertObservations.length, preserveExistingObservations: plan.preservedObservations, preserveExistingPayloadDifferences: plan.preservedPayloadDifferences, preserveAliasedObservations: plan.aliases.length, indexedScreenshots: raw.evidence.length };
    if (!apply) {
      process.stdout.write(JSON.stringify({ mode: 'read-only-plan', database, storesCollection, snapshotSha256, counts, aliases: plan.aliases, storesToAppendPaused: plan.insertStores.map(s => s.storeId), imageAvailabilityVerified: false }) + '\n');
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
    if (verified.conflicts.length || verified.insertStores.length || verified.insertObservations.length
      || verified.preservedObservations + verified.aliases.length !== source.observations.length
      || canonical(verified.aliases) !== canonical(plan.aliases)) throw new Error('history import readback did not match all source identities and retained aliases');
    process.stdout.write(JSON.stringify({ mode: 'applied-append-only', database, storesCollection, snapshotSha256, counts, aliases: verified.aliases,
      readback: { stores: source.stores.length, sourceObservationsCovered: verified.preservedObservations + verified.aliases.length,
        exactArchivedIdsStored: verified.preservedObservations, retainedLegacyCaptures: verified.aliases.length, missing: 0, identityConflicts: 0 }, imageAvailabilityVerified: false }) + '\n');
  } finally { await client.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  // Driver diagnostics can contain connection strings; callers receive a sanitized failure.
  process.stderr.write('History import failed; no existing records were replaced. Read back the append state before retrying.\n');
  process.exitCode = 1;
});
