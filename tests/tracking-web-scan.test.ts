import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BatchManifest, KeywordResult } from '../src/contracts.js';
import { MemoryObservationStore } from '../src/domain/observation-store.js';
import { runWebScan } from '../src/domain/scan.js';
import { parseTrackingConfig } from '../src/domain/tracking-config.js';
import type { BatchDeps, BatchOutput } from '../src/runner/batch-runner.js';
import { LocalArtifactStore } from '../src/storage/local.js';

const config = parseTrackingConfig({
  schemaVersion: 'tracking-config/v1', timezone: 'America/New_York',
  stores: [
    { storeId: 'keke', name: 'Keke', placeId: 'ChIJkeke', aliases: ['Keke'], center: { latitude: 40.7658211, longitude: -73.8315243 }, keywords: { core: ['braised food', '卤味'], longTail: ['duck neck'] } },
    { storeId: 'bear', name: 'Only Bear', placeId: 'ChIJbear', aliases: ['Only Bear'], center: { latitude: 40.7, longitude: -73.9 }, keywords: { core: ['boba'] } },
  ],
  surfaces: { web: { point: { everyHours: 2, keywords: 'all' }, grid: { enabled: true, keywords: 'core' } }, android: { point: { everyHours: 2, keywords: 'core' }, grid: { enabled: false } } },
  database: { provider: 'mongo', database: 'maps-rank-tracking' },
});

/** A batch runner that writes a manifest and one result per keyword under the scoped store, like the real collector. */
function fakeRunner(options: { rankFor?: (keyword: string) => number | null; blockKeyword?: string; throwFor?: string } = {}) {
  const calls: BatchDeps[] = [];
  const runner = async (deps: BatchDeps): Promise<BatchOutput> => {
    calls.push(deps);
    if (options.throwFor && deps.config.keywords.includes(options.throwFor)) throw new Error('browser crashed');
    const attemptRel = 'maps-keyword-capture/2026-10-20/run_x/att_y';
    const attemptRoot = deps.store!.absolutePath(attemptRel);
    const queries: BatchManifest['queries'] = [];
    for (const [i, keyword] of deps.config.keywords.entries()) {
      const queryId = `q${String(i + 1).padStart(4, '0')}`;
      const blocked = keyword === options.blockKeyword;
      const rank = options.rankFor?.(keyword) ?? null;
      const listings = blocked ? [] : [{ displayPosition: 1, organicRank: 1, resultType: 'organic', adLabel: null, name: 'Other', mapsUrl: null, placeId: 'ChIJother', rating: 4, reviewCount: 1 }, ...(rank ? [{ displayPosition: rank, organicRank: rank, resultType: 'organic', adLabel: null, name: 'Keke', mapsUrl: null, placeId: 'ChIJkeke', rating: 4.6, reviewCount: 9 }] : [])];
      const result = { schemaVersion: '1', runId: 'run_x', attemptId: 'att_y', queryId, queryAttemptId: 'qa01', keyword, startedAt: '2026-10-20T16:00:00-04:00', finishedAt: '2026-10-20T16:00:20-04:00', requestedLimit: 15, observedCount: listings.length, sequenceVerified: true, finalUrl: null,
        status: blocked ? 'blocked' : 'captured', stopReason: blocked ? 'captcha' : 'end_of_results', error: null, metadata: { configHash: 'c', profileHash: 'p', adapterVersion: 'maps-feed-card/v6' },
        context: { locale: 'en-US', browserTimezoneId: 'America/New_York', viewport: deps.config.viewport, deviceScaleFactor: 1, locationMode: 'map_view', configuredMapView: deps.config.mapView, observedMapView: null, loggedIn: false, geolocationPermission: 'not_granted', egressRegion: null, egressSource: null, observedLocationText: null, filters: [] },
        quality: {}, listings, screenshots: [{ objectKey: `${attemptRel}/${queryId}/shot.png` }], observationArtifactIds: [] } as unknown as KeywordResult;
      const resultFile = `${queryId}/qa01/${queryId}.json`;
      await mkdir(join(attemptRoot, queryId, 'qa01'), { recursive: true });
      await writeFile(join(attemptRoot, resultFile), JSON.stringify(result));
      queries.push({ queryId, inputIndex: i, keyword, status: blocked ? 'blocked' : 'captured', stopReason: blocked ? 'captcha' : 'end_of_results', error: null, selectedQueryAttemptId: 'qa01', attempts: [{} as never], resultFile, artifactIds: [], persistenceStatus: 'verified' } as BatchManifest['queries'][number]);
    }
    const manifest = { schemaVersion: '1', runId: 'run_x', attemptId: 'att_y', startedAt: '2026-10-20T20:00:00Z', finishedAt: null, status: 'completed', metadata: { configHash: 'c', profileHash: 'p', adapterVersion: 'maps-feed-card/v6' }, persistenceMode: 'local_only', queries, artifacts: [] } as unknown as BatchManifest;
    await writeFile(join(attemptRoot, 'manifest.json'), JSON.stringify(manifest));
    return { manifest, attemptRoot, manifestPath: join(attemptRoot, 'manifest.json'), manifestReceipt: null, exitCode: 0 };
  };
  return { runner, calls };
}

describe('runWebScan', () => {
  it('runs one batch per store at the point tier with a map view, ingests ranks and persists a summary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tracking-scan-'));
    const store = new LocalArtifactStore(root);
    const observations = new MemoryObservationStore();
    const { runner, calls } = fakeRunner({ rankFor: keyword => (keyword === 'braised food' ? 2 : null) });
    const logs: Record<string, unknown>[] = [];
    const summary = await runWebScan({ config, tier: 'point', store, observations, batchRunner: runner, capture: { maxResultsPerKeyword: 10 }, log: e => logs.push(e), now: () => new Date('2026-10-20T20:00:00Z') });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.config).toMatchObject({ keywords: ['braised food', '卤味', 'duck neck'], mapView: { latitude: 40.7658211, longitude: -73.8315243, zoom: 15 }, maxResultsPerKeyword: 10 });
    expect(calls[0]!.store!.rootDirectory).toContain('tracking/web/2026-10-20/point/scan_');
    expect(calls[0]!.store!.rootDirectory).toContain('/keke/r0c0/001');
    expect(summary).toMatchObject({ tier: 'point', status: 'completed', exitCode: 0, batches: { planned: 2, run: 2, blocked: 0, failed: 0 }, queries: { planned: 4, observed: 4, ranked: 1, notFound: 3, blocked: 0, failed: 0 }, observations: { inserted: 4, updated: 0 } });
    expect(summary.scanId).toMatch(/^scan_\d{8}T\d{6}Z_[a-f0-9]{6}$/);
    const docs = [...observations.documents.values()];
    expect(docs.map(d => [d.storeId, d.keyword, d.keywordTier, d.pointId, d.rank.status, d.rank.organicRank, d.locationMode])).toEqual([
      ['keke', 'braised food', 'core', 'r0c0', 'ranked', 2, 'map_view'], ['keke', '卤味', 'core', 'r0c0', 'not_found', null, 'map_view'], ['keke', 'duck neck', 'longTail', 'r0c0', 'not_found', null, 'map_view'], ['bear', 'boba', 'core', 'r0c0', 'not_found', null, 'map_view']]);
    expect(docs[0]!.evidence.screenshotKeys).toEqual(['maps-keyword-capture/2026-10-20/run_x/att_y/q0001/shot.png']);
    expect(docs[0]!.scanId).toBe('run_x');
    const persisted = JSON.parse(await readFile(join(root, summary.prefix, 'scan.json'), 'utf8'));
    expect(persisted.scanId).toBe(summary.scanId);
    expect(logs.map(l => l.stage)).toEqual(['scan_start', 'batch_ingested', 'batch_ingested', 'scan_finished']);
  });
  it('stops at the first blocked batch and reports it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tracking-scan-'));
    const observations = new MemoryObservationStore();
    const { runner, calls } = fakeRunner({ blockKeyword: '卤味' });
    const summary = await runWebScan({ config, tier: 'point', store: new LocalArtifactStore(root), observations, batchRunner: runner });
    expect(calls).toHaveLength(1);
    expect(summary).toMatchObject({ status: 'blocked', exitCode: 1, batches: { planned: 2, run: 1, blocked: 1 }, queries: { observed: 3, blocked: 1 } });
  });
  it('records a crashed batch as partial and keeps going', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tracking-scan-'));
    const observations = new MemoryObservationStore();
    const { runner } = fakeRunner({ throwFor: 'braised food' });
    const summary = await runWebScan({ config, tier: 'point', store: new LocalArtifactStore(root), observations, batchRunner: runner });
    expect(summary).toMatchObject({ status: 'partial', exitCode: 2, batches: { planned: 2, run: 1, failed: 1 }, queries: { observed: 1 } });
    expect(observations.documents.size).toBe(1);
  });
  it('runs grid batches for one store only when asked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tracking-scan-'));
    const { runner, calls } = fakeRunner();
    const summary = await runWebScan({ config, tier: 'grid', store: new LocalArtifactStore(root), observations: new MemoryObservationStore(), batchRunner: runner, storeIds: ['keke'] });
    expect(calls).toHaveLength(25);
    expect(new Set(calls.map(c => `${c.config.mapView!.latitude},${c.config.mapView!.longitude}`)).size).toBe(25);
    expect(calls.every(c => c.config.keywords.length === 2)).toBe(true);
    expect(summary.queries.planned).toBe(50);
    expect(calls[0]!.store!.rootDirectory).toContain('/keke/rp2cm2/001');
  });
  it('honours cancellation between batches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tracking-scan-'));
    const controller = new AbortController();
    const { runner, calls } = fakeRunner();
    const summary = await runWebScan({ config, tier: 'point', store: new LocalArtifactStore(root), observations: new MemoryObservationStore(), batchRunner: async deps => { controller.abort(); return runner(deps); }, signal: controller.signal });
    expect(calls).toHaveLength(1);
    expect(summary.status).toBe('cancelled');
    expect(summary.exitCode).toBe(1);
  });
});
