import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DAILY_MANIFEST_KEY, dateRange, ingestDailyMonitor, recentBeijingDates, type BlobSource } from '../src/domain/daily-ingest.js';
import { MemoryObservationStore } from '../src/domain/observation-store.js';
import { observationCohortKey } from '../src/domain/model.js';
import { parseTrackingConfig } from '../src/domain/tracking-config.js';

const config = parseTrackingConfig({
  schemaVersion: 'tracking-config/v1', timezone: 'America/New_York',
  stores: [
    { storeId: 'keke-flushing', name: 'Keke', placeId: 'ChIJkeke', aliases: ['Keke'], center: { latitude: 40.7658211, longitude: -73.8315243 }, keywords: { core: ['chinese food flushing'], longTail: ['duck neck'] } },
    { storeId: 'massage-float', name: 'Massage', placeId: 'ChIJmassage', active: false, aliases: ['Massage'], center: { latitude: 40.7, longitude: -73.9 }, keywords: { core: ['massage'] } },
  ],
  surfaces: { web: { point: { everyHours: 2, keywords: 'all' }, grid: { enabled: false } }, android: { point: { everyHours: 2, keywords: 'core' }, grid: { enabled: false } } },
  database: { provider: 'mongo', database: 'maps-rank-tracking' },
});
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** One daily-monitor batch in the container layout `<date>/<store>/<daily run>/batches/<batch>/<run>/<attempt>/`. */
function batch(blobs: Map<string, Buffer>, options: { date: string; storeId: string; run: string; keywords: Array<{ keyword: string; rank?: number | null; status?: 'captured' | 'failed' | 'blocked'; resultMissing?: boolean; corrupt?: boolean }>; placeId?: string; startedAt?: string }) {
  const prefix = `${options.date}/${options.storeId}/run_daily_${options.date.replaceAll('-', '')}/batches/b01-abc/${options.run}/att_x/`;
  const queries: unknown[] = [], artifacts: unknown[] = [];
  for (const [i, k] of options.keywords.entries()) {
    const queryId = `q${String(i + 1).padStart(4, '0')}`, status = k.status ?? 'captured';
    const startedAt = options.startedAt ?? `${options.date}T00:${String(10 + i).padStart(2, '0')}:00.000+08:00`;
    if (status === 'failed') { queries.push({ queryId, keyword: k.keyword, status, stopReason: 'error', selectedQueryAttemptId: null, attempts: [], resultFile: null, artifactIds: [], persistenceStatus: 'not_requested' }); continue; }
    const file = `${queryId}/qa01/${queryId}.json`;
    const listings = status === 'blocked' ? [] : [{ displayPosition: 1, organicRank: 1, resultType: 'organic', adLabel: null, name: 'Other', mapsUrl: null, placeId: 'ChIJother', rating: 4, reviewCount: 1 },
      ...(k.rank ? [{ displayPosition: k.rank, organicRank: k.rank, resultType: 'organic', adLabel: null, name: 'Keke', mapsUrl: null, placeId: options.placeId ?? 'ChIJkeke', rating: 4.6, reviewCount: 9 }] : [])];
    const result = { schemaVersion: '1', runId: options.run, attemptId: 'att_x', queryId, queryAttemptId: 'qa01', keyword: k.keyword, startedAt, finishedAt: startedAt, status, stopReason: status === 'blocked' ? 'captcha' : 'limit_reached',
      error: null, metadata: { configHash: 'c', profileHash: 'p', adapterVersion: 'maps-feed-card/v6' }, context: { locale: 'en-US', browserTimezoneId: 'America/New_York', locationMode: 'query_only', configuredMapView: null, observedMapView: null },
      sequenceVerified: true, quality: { verifiedPrefixLength: listings.length, classificationComplete: true, screenshotCoverageComplete: true, resultSurface: 'results_list', warnings: [] }, listings,
      screenshots: [{ filename: `${queryId}__01.png`, objectKey: `${prefix}${queryId}/qa01/${queryId}__01.png` }] };
    const bytes = Buffer.from(JSON.stringify(result));
    const key = `${prefix}${file}`;
    if (!k.resultMissing) blobs.set(key, k.corrupt ? Buffer.from('{"runId":"tampered"}') : bytes);
    queries.push({ queryId, keyword: k.keyword, status, stopReason: status === 'blocked' ? 'captcha' : 'limit_reached', selectedQueryAttemptId: 'qa01', attempts: [{ queryAttemptId: 'qa01', startedAt }], resultFile: file, artifactIds: [`a-${queryId}`], persistenceStatus: 'verified' });
    artifacts.push({ id: `a-${queryId}`, kind: 'result_json', queryId, queryAttemptId: 'qa01', filename: `${queryId}.json`, objectKey: key, storageStatus: 'verified', bytes: bytes.length, sha256: sha(bytes), verifiedAt: startedAt, storageError: null });
  }
  const manifest = { schemaVersion: '1', runId: options.run, attemptId: 'att_x', startedAt: `${options.date}T00:10:00.000+08:00`, finishedAt: `${options.date}T00:30:00.000+08:00`, persistenceMode: 'azure_blob', metadata: { adapterVersion: 'maps-feed-card/v6', profileHash: 'p' }, queries, artifacts };
  blobs.set(`${prefix}manifest.json`, Buffer.from(JSON.stringify(manifest)));
  blobs.set(`${prefix}manifest.progress.json`, Buffer.from('{}'));
  blobs.set(`${options.date}/${options.storeId}/run_daily_${options.date.replaceAll('-', '')}/keyword-selection.json`, Buffer.from('{}'));
  return `${prefix}manifest.json`;
}
function source(blobs: Map<string, Buffer>): BlobSource & { reads: string[] } {
  const reads: string[] = [];
  return { reads, async list(prefix) { return [...blobs.keys()].filter(k => k.startsWith(prefix)); }, async get(key) { reads.push(key); const b = blobs.get(key); if (!b) throw new Error('missing ' + key); return b; } };
}

describe('daily monitor ingestion', () => {
  it('recognises only batch manifests in the daily layout', () => {
    expect(DAILY_MANIFEST_KEY.test('2026-10-21/keke-flushing/run_20261020T160007Z_a36a21/batches/b01-5b6ded813afc/run_20261020T160008Z_576744/att_ddabb6a7/manifest.json')).toBe(true);
    for (const key of ['2026-10-21/keke-flushing/run_x/keyword-selection.json', '2026-10-21/keke-flushing/run_x/batches/b01/run_y/att_z/manifest.progress.json', 'tracking/web/2026-10-21/point/scan_x/manifest.json', '2026-10-21/daily/run_x/store-registry.json']) {
      expect(DAILY_MANIFEST_KEY.test(key), key).toBe(false);
    }
    expect(dateRange('2026-10-15', '2026-10-17')).toEqual(['2026-10-15', '2026-10-16', '2026-10-17']);
    expect(() => dateRange('2026-10-17', '2026-10-15')).toThrow();
    expect(recentBeijingDates(new Date('2026-10-20T20:30:00Z'))).toEqual(['2026-10-20', '2026-10-21']);
  });
  it('appends observations for every verified batch, derives identity and evidence keys like the scans, and never replaces stored rows', async () => {
    const blobs = new Map<string, Buffer>();
    const key = batch(blobs, { date: '2026-10-16', storeId: 'keke-flushing', run: 'run_20261015T160100Z_aaaaaa', keywords: [{ keyword: 'chinese food flushing', rank: 3 }, { keyword: 'duck neck', rank: null }, { keyword: 'closed', status: 'failed' }, { keyword: 'walled', status: 'blocked' }] });
    batch(blobs, { date: '2026-10-16', storeId: 'massage-float', run: 'run_20261015T161000Z_bbbbbb', keywords: [{ keyword: 'massage', rank: 1, }], placeId: 'ChIJmassage' });
    batch(blobs, { date: '2026-10-16', storeId: 'unknown-store', run: 'run_20261015T162000Z_cccccc', keywords: [{ keyword: 'x', rank: 1 }] });
    const store = new MemoryObservationStore();
    const existing = { observationId: 'v2|web|keke-flushing|run_20261015T160100Z_aaaaaa|att_x|q0001|qa01', rank: { status: 'ranked', organicRank: 9 }, ingestedAt: 'earlier' } as never;
    await store.upsert([existing]);
    const events: Record<string, unknown>[] = [];
    const summary = await ingestDailyMonitor(config, source(blobs), store, { dates: ['2026-10-16'], log: e => events.push(e), now: () => new Date('2026-10-21T05:00:00Z') });
    expect(summary.manifests).toEqual({ found: 3, ingested: 2, skippedUnknownStore: 1, skippedIncompleteDelivery: 0, skippedInvalid: 0 });
    expect(summary.observations).toEqual({ prepared: 5, inserted: 4, existing: 1 });
    expect(summary.perDate['2026-10-16']).toEqual({ manifests: 3, inserted: 4, existing: 1 });
    expect(summary.queries).toEqual({ total: 5, withResult: 4, withoutResult: 1 });
    expect(store.documents.get('v2|web|keke-flushing|run_20261015T160100Z_aaaaaa|att_x|q0001|qa01')).toMatchObject({ ingestedAt: 'earlier', rank: { organicRank: 9 } });
    const duck = store.documents.get('v2|web|keke-flushing|run_20261015T160100Z_aaaaaa|att_x|q0002|qa01')!;
    expect(duck).toMatchObject({ surface: 'web', storeId: 'keke-flushing', placeId: 'ChIJkeke', keyword: 'duck neck', keywordTier: 'longTail', pointId: 'r0c0', locationMode: 'query_only', scanId: 'run_20261015T160100Z_aaaaaa',
      observedAt: '2026-10-15T16:11:00.000Z', localDate: '2026-10-15', rank: { status: 'not_found', organicRank: null, listingsObserved: 1 }, quality: { rankingReliable: true },
      evidence: { manifestKey: key, resultKey: key.replace('manifest.json', 'q0002/qa01/q0002.json'), screenshotKeys: [key.replace('manifest.json', 'q0002/qa01/q0002__01.png')] }, source: { attemptId: 'att_x', queryAttemptId: 'qa01', adapterVersion: 'maps-feed-card/v6' } });
    expect(store.documents.get('v2|web|keke-flushing|run_20261015T160100Z_aaaaaa|att_x|q0003|')).toMatchObject({ rank: { status: 'failed' } });
    expect(store.documents.get('v2|web|keke-flushing|run_20261015T160100Z_aaaaaa|att_x|q0004|qa01')).toMatchObject({ rank: { status: 'blocked' } });
    expect(store.documents.get('v2|web|massage-float|run_20261015T161000Z_bbbbbb|att_x|q0001|qa01')).toMatchObject({ rank: { status: 'ranked', organicRank: 1 } });
    expect(events.some(e => e.stage === 'daily_ingest_unknown_store')).toBe(true);
    // Re-running the same date is a no-op.
    const again = await ingestDailyMonitor(config, source(blobs), store, { dates: ['2026-10-16'] });
    expect(again.observations).toEqual({ prepared: 5, inserted: 0, existing: 5 });
  });
  it('keeps every same-keyword intraday observation and its own evidence without rewriting the earlier import', async () => {
    const blobs = new Map<string, Buffer>(), store = new MemoryObservationStore();
    const firstKey = batch(blobs, { date: '2026-11-13', storeId: 'keke-flushing', run: 'run_firstslot', startedAt: '2026-11-13T00:10:00+08:00', keywords: [{ keyword: 'chinese food flushing', rank: 5 }] });
    const first = await ingestDailyMonitor(config, source(blobs), store, { dates: ['2026-11-13'], now: () => new Date('2026-11-13T01:30:00+08:00') });
    expect(first.observations).toEqual({ prepared: 1, inserted: 1, existing: 0 });
    const firstObservation = structuredClone([...store.documents.values()][0]!);
    const secondKey = batch(blobs, { date: '2026-11-13', storeId: 'keke-flushing', run: 'run_secondslot', startedAt: '2026-11-13T02:10:00+08:00', keywords: [{ keyword: 'chinese food flushing', rank: 2 }] });
    const second = await ingestDailyMonitor(config, source(blobs), store, { dates: ['2026-11-13'], now: () => new Date('2026-11-13T03:30:00+08:00') });
    expect(second.observations).toEqual({ prepared: 2, inserted: 1, existing: 1 });
    expect(store.documents.get(firstObservation.observationId)).toEqual(firstObservation);
    const rows = [...store.documents.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    expect(rows.map(o => o.observedAt)).toEqual(['2026-11-12T16:10:00.000Z', '2026-11-12T18:10:00.000Z']);
    expect(rows.map(o => o.localDate)).toEqual(['2026-11-12', '2026-11-12']);
    expect(rows.map(o => o.rank.organicRank)).toEqual([5, 2]);
    expect(rows.map(o => o.evidence.manifestKey)).toEqual([firstKey, secondKey]);
    expect(new Set(rows.map(o => o.evidence.resultKey)).size).toBe(2);
    expect(new Set(rows.map(o => o.evidence.screenshotKeys[0])).size).toBe(2);
    for (const row of rows) {
      expect(row).toMatchObject({ pointId: 'r0c0', locationMode: 'query_only', keyword: 'chinese food flushing' });
      // Legacy imports may carry configured center coordinates; query_only still forbids a
      // comparable location cohort and must not become a fixed-point observation.
      expect(observationCohortKey(row)).toBeNull();
    }
    const repeat = await ingestDailyMonitor(config, source(blobs), store, { dates: ['2026-11-13'] });
    expect(repeat.observations).toEqual({ prepared: 2, inserted: 0, existing: 2 });
    expect(store.documents.get(firstObservation.observationId)).toEqual(firstObservation);
  });
  it('withholds a batch whose selected result is missing, tampered or unverified, and honours the store filter', async () => {
    const blobs = new Map<string, Buffer>();
    batch(blobs, { date: '2026-10-18', storeId: 'keke-flushing', run: 'run_1', keywords: [{ keyword: 'chinese food flushing', rank: 2, resultMissing: true }, { keyword: 'duck neck' }] });
    batch(blobs, { date: '2026-10-18', storeId: 'massage-float', run: 'run_2', keywords: [{ keyword: 'massage', rank: 1, corrupt: true }], placeId: 'ChIJmassage' });
    const unverifiedKey = batch(blobs, { date: '2026-10-19', storeId: 'keke-flushing', run: 'run_3', keywords: [{ keyword: 'duck neck', rank: 4 }] });
    const unverified = JSON.parse(blobs.get(unverifiedKey)!.toString()); unverified.artifacts[0].storageStatus = 'uploaded'; blobs.set(unverifiedKey, Buffer.from(JSON.stringify(unverified)));
    const okKey = batch(blobs, { date: '2026-10-19', storeId: 'massage-float', run: 'run_4', keywords: [{ keyword: 'massage' }], placeId: 'ChIJmassage' });
    const store = new MemoryObservationStore();
    const summary = await ingestDailyMonitor(config, source(blobs), store, { dates: ['2026-10-18', '2026-10-19'] });
    expect(summary.manifests).toMatchObject({ found: 4, ingested: 1, skippedIncompleteDelivery: 3 });
    expect(summary.observations).toEqual({ prepared: 1, inserted: 1, existing: 0 });
    expect([...store.documents.values()].map(o => o.evidence.manifestKey)).toEqual([okKey]);
    const filtered = await ingestDailyMonitor(config, source(blobs), new MemoryObservationStore(), { dates: ['2026-10-19'], storeIds: ['keke-flushing'] });
    expect(filtered.manifests).toMatchObject({ found: 2, ingested: 0, skippedIncompleteDelivery: 1 });
  });
  it('skips malformed manifests and local-only batches without touching the store', async () => {
    const blobs = new Map<string, Buffer>();
    blobs.set('2026-10-20/keke-flushing/run_d/batches/b01-x/run_5/att_y/manifest.json', Buffer.from('not json'));
    const localKey = batch(blobs, { date: '2026-10-20', storeId: 'keke-flushing', run: 'run_6', keywords: [{ keyword: 'duck neck' }] });
    const local = JSON.parse(blobs.get(localKey)!.toString()); local.persistenceMode = 'local_only'; blobs.set(localKey, Buffer.from(JSON.stringify(local)));
    const store = new MemoryObservationStore();
    const summary = await ingestDailyMonitor(config, source(blobs), store, { dates: ['2026-10-20'] });
    expect(summary.manifests).toMatchObject({ found: 2, ingested: 0, skippedInvalid: 2 });
    expect(store.documents.size).toBe(0);
    await expect(ingestDailyMonitor(config, source(blobs), store, { dates: ['20261020'] })).rejects.toThrow(/invalid date/);
  });
});
