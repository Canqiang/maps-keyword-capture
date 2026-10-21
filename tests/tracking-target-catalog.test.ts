import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { main } from '../src/domain/cli.js';
import { ingestAndroidManifest, type AndroidManifestLike } from '../src/domain/ingest.js';
import { MemoryObservationStore } from '../src/domain/observation-store.js';
import { MemoryTrackingRepository, type StoredStore } from '../src/domain/repository.js';
import { parseTargetCatalog, reconcileTargetStores } from '../src/domain/target-catalog.js';
import { balancedShardStores, parseStore, parseTrackingConfig, planScan, shardStores, trackingIngestContext, toAndroidRuns, toWebBatches, withStores } from '../src/domain/tracking-config.js';

const catalogPath = new URL('../deploy/tracking-targets/liya-90-v1.json', import.meta.url).pathname;
const configPath = new URL('../deploy/tracking-targets/tracking.json', import.meta.url).pathname;
const catalog = parseTargetCatalog(JSON.parse(await readFile(catalogPath, 'utf8')));
const config = withStores(parseTrackingConfig(JSON.parse(await readFile(configPath, 'utf8'))), catalog.stores);
const first = catalog.stores[0]!;
const fixed = first.fixedPoints![0]!;
function manifest(): AndroidManifestLike {
  return { runId: 'new-fixed-point-scan', startedAt: '2026-10-21T01:00:00Z', queries: [{
    queryId: 'q1', storeId: first.storeId, keyword: first.keywordTargets![0]!.keyword,
    location: { id: fixed.id, latitude: fixed.latitude, longitude: fixed.longitude },
    rankingStatus: 'not_evaluated', organicRank: null, displayPosition: null, listingStatus: 'not_evaluated', evidenceStatus: 'failed', stopReason: 'query_timeout',
    listings: [], screens: [], locationScreen: null,
  }] };
}

describe('versioned nine-store report catalog', () => {
  it('keeps exactly 90 approved pairs, source goals and 27 explicit historical point definitions', () => {
    expect(catalog.stores.map(s => s.keywordTargets!.length)).toEqual([10, 10, 12, 12, 9, 10, 10, 9, 8]);
    expect(config.storeSource.collection).toBe('monitor-target-stores-v1');
    expect(config.database.collection).toBe('observations');
    const queries = catalog.stores.flatMap(s => s.keywordTargets!.map(t => t.keyword));
    expect(queries).toHaveLength(90);
    expect(new Set(queries).size).toBe(69);
    expect(queries.filter(k => /[\u4e00-\u9fff]/u.test(k))).toHaveLength(8);
    expect(queries.some(k => /flushing|nyc|american dream|upper west/i.test(k))).toBe(false);
    for (const store of catalog.stores) {
      expect(store.fixedPoints!.map(p => [p.label, p.distanceKm])).toEqual([['中心', 0], ['3公里', 3], ['5公里', 5]]);
      expect(store.fixedPoints![0]).toMatchObject(store.center);
      expect(store.monitoringCatalog!.source).toMatchObject({ documentDate: '2026-10-16', sourceBaselineIsLive: false, sha256: '9c717f3f2eb6caa2612ed7d2dafdbbc69871916188ba52fbf65e8cf362c0665d' });
    }
    const targets = catalog.stores.flatMap(s => s.keywordTargets!.flatMap(t => t.pointTargets));
    expect(targets).toHaveLength(270);
    expect(targets.filter(t => t.historicalEvidenceRef)).toHaveLength(189);
    expect(targets.filter(t => t.targetText === '候选方向：前10；待实测后校准')).toHaveLength(81);
  });

  it('balances the whole-store query workload deterministically without gaps or overlap', () => {
    for (const surface of ['web', 'android'] as const) {
      const stores = [0, 1].map(index => balancedShardStores(config, { surface, tier: 'point' }, index, 2));
      const ids = stores.flat().map(s => s.storeId);
      expect(ids).toHaveLength(9);
      expect(new Set(ids).size).toBe(9);
      const plans = stores.map(shard => planScan(withStores(config, shard), { surface, tier: 'point' }).queries);
      expect(plans.flat()).toHaveLength(270);
      expect(new Set(plans.flat().map(q => `${q.storeId}/${q.keyword}/${q.point.id}`)).size).toBe(270);
      expect(Math.max(...plans.map(p => p.length))).toBe(138);
      const reversed = withStores(config, config.stores.slice().reverse());
      for (const index of [0, 1]) expect(balancedShardStores(reversed, { surface, tier: 'point' }, index, 2).map(s => s.storeId).sort()).toEqual(stores[index]!.map(s => s.storeId).sort());
    }
    expect(() => balancedShardStores(config, { surface: 'web', tier: 'point' }, 2, 2)).toThrow(/shard index/);
  });

  it('plans the same exact 270 queries for each surface without expanding a grid or old keyword inventory', () => {
    const web = planScan(config, { surface: 'web', tier: 'point' });
    const android = planScan(config, { surface: 'android', tier: 'point' });
    expect(web.queries).toHaveLength(270);
    expect(android.queries).toEqual(web.queries);
    expect(toWebBatches(web)).toHaveLength(27);
    const runs = toAndroidRuns(android, config);
    expect(runs).toHaveLength(14);
    expect(runs.flat()).toHaveLength(270);
    expect(runs.flat().every(t => ['中心', '3公里', '5公里'].includes(t.location.label))).toBe(true);
    expect(web.queries.every(q => !q.point.id.startsWith('r0c'))).toBe(true);
    expect(web.queries.some(q => q.keyword === 'chinese food flushing')).toBe(false);
    expect(planScan(config, { surface: 'web', tier: 'grid' }).queries).toEqual([]);
    for (const surface of ['web', 'android'] as const) expect(config.surfaces[surface].point).toEqual({ everyHours: 2, keywords: 'all' });
    const shards = [0, 1].flatMap(i => planScan(withStores(config, shardStores(config.stores, i, 2)), { surface: 'web', tier: 'point' }).queries);
    expect(shards).toHaveLength(270);
    expect(new Set(shards.map(q => `${q.storeId}/${q.keyword}/${q.point.id}`)).size).toBe(270);
  });

  it('rejects duplicate point identities, missing goal mappings and active keywords outside inventory', () => {
    const duplicate = structuredClone(first); duplicate.fixedPoints![1]!.id = duplicate.fixedPoints![0]!.id;
    expect(() => parseStore(duplicate)).toThrow(/unique fixed point/);
    const missing = structuredClone(first); missing.keywordTargets![0]!.pointTargets.pop();
    expect(() => parseStore(missing)).toThrow(/target points/);
    const outside = structuredClone(first); outside.keywordTargets![0]!.keyword = 'not approved';
    expect(() => parseStore(outside)).toThrow(/keyword inventory/);
  });

  it('reuses existing IDs by Place ID, retains old words, and repeated import leaves observations untouched', async () => {
    const repo = new MemoryTrackingRepository();
    const old: StoredStore = { ...first, storeId: 'existing-keke-id', center: null, active: false, keywords: { core: ['historical-only query'], longTail: [] }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
    delete old.fixedPoints; delete old.keywordTargets; delete old.monitoringCatalog;
    repo.stores.set(old.storeId, structuredClone(old));
    const prepared = reconcileTargetStores(await repo.listStores({ includeInactive: true }), catalog);
    expect(prepared[0]!.storeId).toBe(old.storeId);
    expect(prepared[0]!.keywords.core).toEqual(['historical-only query']);
    await expect(repo.saveStore(prepared[0])).rejects.toThrow(/identity cannot change/);
    for (const store of prepared) await repo.saveStore(store, new Date('2026-10-21T00:00:00Z'), { fillMissingCenter: true });
    expect(reconcileTargetStores(await repo.listStores({ includeInactive: true }), catalog)).toEqual(prepared);
    expect((await repo.getStore(old.storeId))!.createdAt).toBe(old.createdAt);
    expect(repo.observations).toEqual([]);
    expect((await repo.rosterLatest(old.storeId, 'web'))!.configured).toBe(10);
    const collision = { ...old, storeId: catalog.stores[1]!.storeId };
    expect(() => reconcileTargetStores([collision], catalog)).toThrow(/belongs to another/);
  });

  it('snapshots planned goal provenance only on executing scans, and ingest is idempotent without replacing older runs', async () => {
    const input = { manifest: manifest(), placeIds: new Map([[first.storeId, first.placeId]]) };
    const rows = ingestAndroidManifest(input, trackingIngestContext(config, { includeTargetSnapshot: true }));
    expect(rows[0]!.monitoringTarget).toMatchObject({ catalog: { version: catalog.version, source: { sourceBaselineIsLive: false } }, point: { id: fixed.id }, target: { targetRank: 10, historicalBaselineDisplay: '待测' } });
    expect(rows[0]!.gridRunId).toBeUndefined();
    expect(rows[0]!.rank.status).toBe('failed');
    expect(ingestAndroidManifest(input, trackingIngestContext(config))[0]!.monitoringTarget).toBeUndefined();
    const mismatched = manifest(); mismatched.queries[0]!.location.latitude += 0.1;
    expect(ingestAndroidManifest({ ...input, manifest: mismatched }, trackingIngestContext(config, { includeTargetSnapshot: true }))[0]!.monitoringTarget).toBeUndefined();
    const oldManifest = manifest(); oldManifest.runId = 'older-run'; oldManifest.queries[0]!.location.id = 'r0c0';
    const oldRows = ingestAndroidManifest({ ...input, manifest: oldManifest }, trackingIngestContext(config));
    const db = new MemoryObservationStore();
    await db.upsert(oldRows); await db.upsert(rows); await db.upsert(rows);
    expect(db.documents.size).toBe(2);
    expect(db.documents.get(oldRows[0]!.observationId)).toEqual(oldRows[0]);
    const repo = new MemoryTrackingRepository([...oldRows]); await repo.saveStore(first);
    expect((await repo.rosterLatest(first.storeId, 'android'))!.withRecord).toBe(0);
    expect(await repo.latest(first.storeId, { surface: 'android', pointId: 'r0c0' })).toHaveLength(1);
  });

  it('supports an offline CLI plan from the reviewed catalog without Mongo access', async () => {
    const lines: string[] = []; const original = console.log; console.log = (s: string) => { lines.push(s); };
    try {
      expect(await main(['plan', '--config', configPath, '--catalog', catalogPath, '--surface', 'android', '--tier', 'point', '--format', 'android-runs'], {})).toBe(0);
      expect(JSON.parse(lines[0]!).count).toBe(270);
      expect(await main(['plan', '--config', configPath, '--catalog', catalogPath, '--surface', 'android', '--tier', 'point', '--shard-count', '2', '--shard-index', '0', '--shard-strategy', 'balanced'], {})).toBe(0);
      expect(JSON.parse(lines[1]!).count).toBeLessThanOrEqual(138);
      expect(await main(['plan', '--config', configPath, '--catalog', catalogPath, '--surface', 'android', '--tier', 'point', '--shard-count', '2', '--shard-index', '0'], {})).toBe(0);
      expect(JSON.parse(lines[2]!).count).toBe(177);
    } finally { console.log = original; }
  });
});
