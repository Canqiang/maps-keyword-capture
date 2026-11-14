import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runDailyMonitor } from '../src/monitor/daily.js';
import { openSearch } from '../src/browser/maps-adapter.js';
import { createAtomicClaim, NamespacedBatchStore } from '../src/monitor/storage.js';
import { parseMonitorConfig } from '../src/monitor/config.js';
import { parseKeywordResponse } from '../src/monitor/source.js';
import { LocalArtifactStore } from '../src/storage/local.js';
import { RemoteArtifactStore } from '../src/storage/remote.js';
import { FakeGateway } from './helpers/fake-gateway.js';
import { runBatch, type BatchDeps, type BatchOutput } from '../src/runner/batch-runner.js';
import type { BatchManifest, GeographicRelevance, KeywordResult } from '../src/contracts.js';
import { namedCards, writeFixture } from './fixtures/feed-fixture.js';

const first = { storeId: 'one', merchantId: 'm1', placeId: 'ChIJone', name: 'one' };
const second = { storeId: 'two', merchantId: 'm2', placeId: 'ChIJtwo', name: 'two' };
const config = parseMonitorConfig({ schemaVersion: '1', sourceBaseUrl: 'http://example.test', stores: [first, second], maxKeywordsPerStore: 40, batchSize: 20, sourceTimeoutMs: 100, outputDirectory: '/tmp/placeholder', capture: {} });
async function setup() {
  const local = new LocalArtifactStore(await mkdtemp(join(tmpdir(), 'monitor-')));
  const gateway = new FakeGateway();
  const store = new RemoteArtifactStore({ gateway, local });
  const source = { read: vi.fn(async (s: typeof first) => parseKeywordResponse({ place_id: s.placeId, local_keywords: [{ local_keyword_id: `record-${s.storeId}`, merchant_id: s.merchantId, place_id: s.placeId, keywords: Array.from({ length: 40 }, (_, i) => ({ keyword: `${s.storeId} ${i}`, priority: 'P1' })) }] }, s)) };
  let index = 0;
  const runner = vi.fn(async (deps: BatchDeps): Promise<BatchOutput> => {
    const runId = `run${++index}`;
    const rel = `maps-keyword-capture/2026-09-18/${runId}/att`;
    const manifest = { schemaVersion: '1', runId, attemptId: 'att', status: 'completed', persistenceMode: deps.store!.mode, startedAt: '', finishedAt: '', metadata: {}, queries: deps.config.keywords.map((keyword, inputIndex) => ({ queryId: `q${inputIndex}`, inputIndex, keyword, status: 'captured', stopReason: 'end_of_results', persistenceStatus: 'verified', attempts: [], resultFile: null })), artifacts: [] } as unknown as BatchManifest;
    const file = await deps.store!.writeFile(`${rel}/manifest.json`, JSON.stringify(manifest));
    const state = await deps.store!.persist(file);
    return { manifest, attemptRoot: deps.store!.absolutePath(rel), manifestPath: deps.store!.absolutePath(`${rel}/manifest.json`), manifestReceipt: { ...state, runId, attemptId: 'att', filename: 'manifest.json', bytes: file.bytes, sha256: file.sha256 }, exitCode: 0 };
  });
  return { config, local, gateway, store, source, batchRunner: runner, claim: createAtomicClaim(gateway), now: () => new Date('2026-09-17T16:00:00Z') };
}
describe('daily monitor', () => {
  it('uses an identity-bound monitoring cohort without changing the fresh shared source or other stores', async () => {
    const deps = await setup();
    const input = { id: 'keke-20261014-v1', merchantId: first.merchantId, placeId: first.placeId, keywords: [
      { keyword: '法拉盛 卤味', group: 'core' as const },
      { keyword: 'chinese cold dishes flushing', group: 'exploration' as const },
      { keyword: '可可小卤', group: 'brand' as const },
    ] };
    const out = await runDailyMonitor({ ...deps, config: parseMonitorConfig({ ...deps.config, monitoringKeywordSets: [input] }) });
    expect(out.manifest?.counts).toMatchObject({ stores: 2, selected: 43, batches: 3, captured: 43 });
    const one = out.manifest!.stores[0]!;
    const two = out.manifest!.stores[1]!;
    expect(one.batches.flatMap(b => b.keywords)).toEqual(input.keywords.map(k => k.keyword));
    expect(two.batches.flatMap(b => b.keywords)).toEqual(Array.from({ length: 40 }, (_, i) => `two ${i}`));
    const snapshot = JSON.parse((await deps.gateway.get(one.snapshotReceipt!.objectKey!)).toString());
    expect(snapshot.source.keywords).toHaveLength(40);
    expect(snapshot.source.keywords[0].keyword).toBe('one 0');
    expect(snapshot.monitoringCohort).toMatchObject({ id: input.id, groups: { core: 1, exploration: 1, brand: 1 } });
    expect(snapshot.keywords[0]).toEqual({ keyword: '法拉盛 卤味', priority: null, sourceIndex: null, cohortIndex: 0, monitoringGroup: 'core' });
    expect(one.monitoringCohort).toEqual(snapshot.monitoringCohort);
    const regularSnapshot = JSON.parse((await deps.gateway.get(two.snapshotReceipt!.objectKey!)).toString());
    expect(regularSnapshot.monitoringCohort).toBeUndefined();
    expect(regularSnapshot.keywords[0]).toEqual({ keyword: 'two 0', priority: 'P1', sourceIndex: 0 });
  });
  it('does not apply a monitoring cohort to a different merchant with the same Place ID', async () => {
    const deps = await setup();
    const out = await runDailyMonitor({ ...deps, config: parseMonitorConfig({ ...deps.config, monitoringKeywordSets: [{ id: 'wrong-owner', merchantId: 'different', placeId: first.placeId, keywords: [{ keyword: 'wrong query', group: 'core' }] }] }) });
    expect(out.manifest?.stores[0]).toMatchObject({ status: 'source_failed', sourceError: 'source_monitoring_cohort_identity_mismatch', selectedCount: 0, batches: [] });
    expect(out.manifest?.stores[1]?.selectedCount).toBe(40);
    expect(out.exitCode).toBe(2);
  });
  it('still requires a fresh valid source read for an overridden store', async () => {
    const deps = await setup();
    deps.source.read.mockRejectedValueOnce(new Error('source_http_503'));
    const out = await runDailyMonitor({ ...deps, config: parseMonitorConfig({ ...deps.config, monitoringKeywordSets: [{ id: 'fixed-v1', merchantId: first.merchantId, placeId: first.placeId, keywords: [{ keyword: 'new query', group: 'core' }] }] }) });
    expect(out.manifest?.stores[0]).toMatchObject({ status: 'source_failed', sourceError: 'source_http_503', selectedCount: 0, batches: [] });
    expect(out.manifest?.counts).toMatchObject({ selected: 40, sourceFailed: 1 });
  });
  it('snapshots all stores before browser work, caps and splits, persists checkpoints and verifies final manifest', async () => {
    const deps = await setup();
    const impl = deps.batchRunner.getMockImplementation()!;
    deps.batchRunner.mockImplementation(async batch => {
      expect([...deps.gateway.objects.keys()].filter(k => k.endsWith('/keyword-selection.json'))).toHaveLength(2);
      return impl(batch);
    });
    const out = await runDailyMonitor(deps);
    expect(out.exitCode).toBe(0);
    expect(out.manifest?.stores).toHaveLength(2);
    expect(out.manifest?.counts).toMatchObject({ selected: 80, captured: 80, stores: 2, batches: 4 });
    expect(out.manifestReceipt?.storageStatus).toBe('verified');
    expect(deps.batchRunner).toHaveBeenCalledTimes(4);
    const paths = [...deps.gateway.objects.keys()];
    expect(paths.some(p => /^2026-09-18\/one\/run_.*\/batches\/b01-.*\/run1\/att\/manifest.json$/.test(p))).toBe(true);
    expect(paths.some(p => /^2026-09-18\/daily\/run_.*\/manifest.json$/.test(p))).toBe(true);
    for (const call of deps.batchRunner.mock.results) await expect(access((await call.value).attemptRoot)).rejects.toThrow();
    const body = await deps.gateway.get(out.manifestReceipt!.objectKey!);
    expect(JSON.parse(body.toString()).status).toBe('completed');
  });
  it('passes each store reference area into its own batch and snapshot while preserving actual result geography', async () => {
    const deps = await setup();
    const expectedArea = { label: 'Mineola, NY', latitude: 40.75, longitude: -73.64, radiusKm: 10, source: 'Verified test registry' };
    const geography: GeographicRelevance = { status: 'outside', expectedArea, scope: 'observed_listings', checkedCount: 1, insideCount: 0, outsideCount: 1, unknownCount: 0, reason: 'all_observed_places_outside' };
    const impl = deps.batchRunner.getMockImplementation()!;
    deps.batchRunner.mockImplementation(async batch => {
      // The browser boundary must receive only this store's optional reference, never a shared city.
      expect(batch.config.expectedArea).toEqual(batch.config.keywords[0] === 'one 0' ? expectedArea : undefined);
      expect(batch.config.mapView).toBeUndefined();
      const out = await impl(batch);
      const query = out.manifest.queries[0]!;
      const relativeRoot = `maps-keyword-capture/2026-09-18/${out.manifest.runId}/${out.manifest.attemptId}`;
      const result: KeywordResult = { schemaVersion: '1', runId: out.manifest.runId, attemptId: out.manifest.attemptId, queryId: query.queryId, queryAttemptId: 'qa01', keyword: query.keyword, status: 'captured', stopReason: 'end_of_results', error: null, startedAt: '2026-09-17T16:00:00Z', finishedAt: '2026-09-17T16:01:00Z', requestedLimit: 15, observedCount: 1, sequenceVerified: true, finalUrl: null, metadata: { configHash: 'hash', profileHash: 'profile', adapterVersion: 'test', sourceCommit: null, browserVersion: null, imageDigest: null, egressProfileId: null }, context: { locale: 'en-US', browserTimezoneId: 'America/New_York', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, locationMode: 'query_only', configuredMapView: null, observedMapView: null, loggedIn: false, geolocationPermission: 'not_granted', egressRegion: null, egressSource: null, observedLocationText: null, filters: [] }, quality: { verifiedPrefixLength: 1, classificationComplete: true, screenshotCoverageComplete: true, warnings: [], observedQueryText: query.keyword, queryCorrectionText: null, ...(batch.config.expectedArea ? { geographicRelevance: geography } : {}) }, listings: [{ occurrenceId: 'occ1', businessKey: 'outside', name: 'Outside business', displayPosition: 1, resultType: 'organic', organicRank: 1, adLabel: null, address: null, mapsUrl: 'https://www.google.com/maps/place/Outside/data=!3d32.66!4d-95.49', placeId: 'ChIJoutside', rating: 4.5, reviewCount: 5, category: 'Cafe', rawText: 'Outside business', classificationEvidence: { source: 'supported_layout', owner: 'occ1', labelText: null, layoutSignature: 'fixture', evaluatedLabelLocations: [], observationIds: [] }, observationIds: [], screenshotIds: [] }], screenshots: [], observationArtifactIds: [] };
      await batch.store!.writeFile(`${relativeRoot}/query.json`, JSON.stringify(result));
      query.resultFile = 'query.json';
      return out;
    });
    const out = await runDailyMonitor({ ...deps, config: { ...deps.config, maxKeywordsPerStore: 1, stores: [{ ...first, expectedArea }, second] } });
    expect(out.exitCode).toBe(0);
    expect(out.manifest?.counts).toMatchObject({ captured: 2, skipped: 0 });
    const one = out.manifest!.stores[0]!;
    const two = out.manifest!.stores[1]!;
    expect(JSON.parse((await deps.gateway.get(one.snapshotReceipt!.objectKey!)).toString()).store.expectedArea).toEqual(expectedArea);
    expect(JSON.parse((await deps.gateway.get(two.snapshotReceipt!.objectKey!)).toString()).store.expectedArea).toBeNull();
    expect(one.batches[0]!.ownStore[0]!.geographicRelevance).toEqual(geography);
    expect(two.batches[0]!.ownStore[0]!.geographicRelevance).toMatchObject({ status: 'unverified', expectedArea: null });
  });
  it('atomic claim deduplicates scheduled/manual runs; unique manual recovery preserves the first attempt', async () => {
    const deps = await setup();
    const firstRun = await runDailyMonitor(deps);
    const skipped = await runDailyMonitor(deps);
    expect(skipped.status).toBe('duplicate_skipped');
    expect(skipped.exitCode).toBe(0);
    expect(deps.batchRunner).toHaveBeenCalledTimes(4);
    const recovery = await runDailyMonitor({ ...deps, runKey: 'manual-recovery' });
    expect(recovery.manifest?.dailyRunId).not.toBe(firstRun.manifest?.dailyRunId);
    expect(deps.gateway.objects.has(firstRun.manifestReceipt!.objectKey!)).toBe(true);
  });
  it('never dispatches if atomic claim readback is corrupt', async () => {
    const deps = await setup(); deps.gateway.corruptGet = k => k.startsWith('claims/');
    const out = await runDailyMonitor(deps);
    expect(out.exitCode).toBe(1); expect(deps.batchRunner).not.toHaveBeenCalled();
  });
  it('collects distinct scheduled Job keys within one Beijing day while a repeat of either Job remains a no-op', async () => {
    const deps = await setup();
    const runConfig = { ...deps.config, stores: [first], maxKeywordsPerStore: 1 };
    const jobOne = 'maps-keyword-monitor-daily-29910600';
    const jobTwo = 'maps-keyword-monitor-daily-29910720';
    const one = await runDailyMonitor({ ...deps, config: runConfig, runKey: jobOne, now: () => new Date('2026-11-12T16:00:00Z') });
    const originalBytes = await deps.gateway.get(one.manifestReceipt!.objectKey!);
    const sameJob = await runDailyMonitor({ ...deps, config: runConfig, runKey: jobOne, now: () => new Date('2026-11-12T16:05:00Z') });
    expect(sameJob.status).toBe('duplicate_skipped');
    const two = await runDailyMonitor({ ...deps, config: runConfig, runKey: jobTwo, now: () => new Date('2026-11-12T18:00:00Z') });
    expect([one.exitCode, two.exitCode]).toEqual([0, 0]);
    expect([one.manifest!.date, two.manifest!.date]).toEqual(['2026-11-13', '2026-11-13']);
    expect(one.manifest!.dailyRunId).not.toBe(two.manifest!.dailyRunId);
    expect([one.manifest!.counts.selected, two.manifest!.counts.selected]).toEqual([1, 1]);
    expect(deps.source.read).toHaveBeenCalledTimes(2);
    expect(deps.batchRunner).toHaveBeenCalledTimes(2);
    expect(await deps.gateway.get(one.manifestReceipt!.objectKey!)).toEqual(originalBytes);
    expect(deps.gateway.objects.has(`claims/${jobOne}.json`)).toBe(true);
    expect(deps.gateway.objects.has(`claims/${jobTwo}.json`)).toBe(true);
    const repeatLater = await runDailyMonitor({ ...deps, config: runConfig, runKey: jobTwo, now: () => new Date('2026-11-13T16:00:00Z') });
    expect(repeatLater.status).toBe('duplicate_skipped');
    expect(deps.batchRunner).toHaveBeenCalledTimes(2);
  });
  it('accounts for source failures and empty stores without claiming empty success', async () => {
    const deps = await setup();
    const record = await deps.source.read(second); record.keywords = [];
    deps.source.read.mockRejectedValueOnce(new Error('source_identity_mismatch'));
    deps.source.read.mockResolvedValueOnce(record);
    const out = await runDailyMonitor(deps);
    expect(out.exitCode).toBe(2);
    expect(out.manifest?.stores.map(s => s.status)).toEqual(['source_failed', 'empty']);
    expect(deps.batchRunner).not.toHaveBeenCalled();
  });
  it.each(['batch_blocked', 'storage_unavailable', 'cancelled', 'unsupported_layout'])('propagates %s to all remaining batches and stores', async reason => {
    const deps = await setup(); const impl = deps.batchRunner.getMockImplementation()!;
    deps.batchRunner.mockImplementationOnce(async batch => {
      const out = await impl(batch);
      out.manifest.queries[0] = { ...out.manifest.queries[0], status: 'skipped', stopReason: reason } as any;
      out.manifest.status = 'partial'; out.exitCode = reason === 'storage_unavailable' ? 1 : 2;
      return out;
    });
    const out = await runDailyMonitor(deps);
    expect(deps.batchRunner).toHaveBeenCalledTimes(1);
    expect(out.manifest?.stopReason).toBe(reason);
    expect(out.manifest?.stores[1]?.batches.every(b => b.status === 'skipped' && b.stopReason === reason)).toBe(true);
    expect(out.exitCode).toBe(reason === 'storage_unavailable' ? 1 : 2);
  });
  it('requires final manifest readback despite successful capture', async () => {
    const deps = await setup(); deps.gateway.corruptGet = key => /\/daily\/.*\/manifest.json$/.test(key);
    const out = await runDailyMonitor(deps);
    expect(out.exitCode).toBe(1); expect(out.manifestReceipt?.storageStatus).toBe('failed');
  });
  it('requires daily checkpoint before deleting verified batch staging', async () => {
    const deps = await setup(); deps.gateway.failOn = (_, key) => key.includes('/checkpoints/0002.json');
    const out = await runDailyMonitor(deps);
    expect(out.exitCode).toBe(1);
    expect(deps.batchRunner).toHaveBeenCalledTimes(1);
    const batch = await deps.batchRunner.mock.results[0]!.value;
    await expect(access(batch.attemptRoot)).resolves.toBeUndefined();
  });
  it('cancellation before source accounts for all stores without launching', async () => {
    const deps = await setup(); const abort = new AbortController(); abort.abort();
    const out = await runDailyMonitor({ ...deps, signal: abort.signal });
    expect(out.exitCode).toBe(2); expect(out.manifest?.stores.every(s => s.status === 'skipped')).toBe(true);
    expect(deps.batchRunner).not.toHaveBeenCalled();
  });
  it('retains local-only files and explicitly reports delivery not requested', async () => {
    const deps = await setup(); const out = await runDailyMonitor({ ...deps, store: deps.local });
    expect(out.manifest?.deliveryMode).toBe('local_only');
    expect(out.exitCode).toBe(2);
    await expect(readFile(out.manifestPath!, 'utf8')).resolves.toContain('local_only');
  });
  it('allows only one concurrently claimed cycle to dispatch', async () => {
    const deps = await setup();
    const results = await Promise.all([runDailyMonitor(deps), runDailyMonitor(deps)]);
    expect(results.map(r => r.status).sort()).toEqual(['completed', 'duplicate_skipped']);
    expect(deps.batchRunner).toHaveBeenCalledTimes(4);
  });
  it('stops after the global deadline and labels every remaining batch', async () => {
    const deps = await setup(); let current = new Date('2026-09-17T16:00:00Z');
    const impl = deps.batchRunner.getMockImplementation()!;
    deps.batchRunner.mockImplementationOnce(async batch => { const out = await impl(batch); current = new Date(current.getTime() + 14 * 3600 * 1000); return out; });
    const out = await runDailyMonitor({ ...deps, now: () => current });
    expect(out.manifest?.stopReason).toBe('daily_timeout'); expect(out.exitCode).toBe(2);
    expect(deps.batchRunner).toHaveBeenCalledTimes(1);
    expect(out.manifest?.counts.skipped).toBe(60);
  });
  it('carries unsupported-layout streak across short batches and stores', async () => {
    const deps = await setup(); const impl = deps.batchRunner.getMockImplementation()!;
    deps.batchRunner.mockImplementation(async batch => {
      const out = await impl(batch); out.manifest.status = 'partial'; out.exitCode = 2;
      for (const query of out.manifest.queries) Object.assign(query, { status: 'partial', stopReason: 'unsupported_layout' });
      return out;
    });
    const out = await runDailyMonitor({ ...deps, config: { ...deps.config, maxKeywordsPerStore: 2, batchSize: 1 } });
    expect(deps.batchRunner).toHaveBeenCalledTimes(3);
    expect(out.manifest?.stopReason).toBe('unsupported_layout'); expect(out.manifest?.counts.skipped).toBe(1);
  });
  it('snapshot delivery failure prevents all browser work and accounts for remaining stores', async () => {
    const deps = await setup(); deps.gateway.corruptGet = k => k.endsWith('/keyword-selection.json');
    const out = await runDailyMonitor(deps);
    expect(out.exitCode).toBe(1); expect(deps.batchRunner).not.toHaveBeenCalled();
    expect(out.manifest?.stores.map(s => s.status)).toEqual(['failed', 'skipped']);
  });
  it('reuses the collector with verified structured evidence and omits images without a resolved Top10 target', async () => {
    const deps = await setup();
    const url = await writeFixture({ query: 'one 0', cards: namedCards(3), endMarkerInitially: true });
    const out = await runDailyMonitor({ ...deps, config: { ...deps.config, stores: [first], maxKeywordsPerStore: 1 }, batchRunner: batch => runBatch({ ...batch, searchUrlFor: () => url }) });
    expect(out.exitCode).toBe(0);
    expect(out.manifest?.counts.captured).toBe(1);
    expect(out.manifest?.stores[0]?.batches[0]?.ownStore[0]?.summary.status).toBe('identity_unresolved');
    const keys = [...deps.gateway.objects.keys()];
    expect(keys.some(k => k.startsWith('2026-09-18/one/') && k.endsWith('.png'))).toBe(false);
    expect(keys.some(k => k.startsWith('2026-09-18/one/') && k.endsWith('.csv'))).toBe(true);
    const receipt = out.manifest!.stores[0]!.batches[0]!.manifestReceipt!;
    const batchManifest = JSON.parse((await deps.gateway.get(receipt.objectKey!)).toString()) as BatchManifest;
    for (const artifact of batchManifest.artifacts) {
      expect(artifact.storageStatus).toBe('verified');
      expect(deps.gateway.objects.has(artifact.objectKey!)).toBe(true);
    }
  }, 30000);
  it('preserves the real terminal batch output when result JSON writing throws', async () => {
    const deps = await setup();
    const base = deps.store;
    const faultStore = { mode: base.mode, rootDirectory: base.rootDirectory, absolutePath: base.absolutePath.bind(base), persist: base.persist.bind(base), writeFile: async (path: string, data: Buffer | string) => {
      if (/__q0001\.json$/.test(path)) throw new Error('disk full');
      return base.writeFile(path, data);
    } };
    const url = await writeFixture({ query: 'one 0', cards: namedCards(3), endMarkerInitially: true });
    const out = await runDailyMonitor({ ...deps, config: { ...deps.config, maxKeywordsPerStore: 2 }, store: faultStore, batchRunner: batch => runBatch({ ...batch, searchUrlFor: () => url }) });
    expect(out.exitCode).toBe(1); expect(out.manifest?.stopReason).toBe('storage_unavailable');
    const firstBatch = out.manifest!.stores[0]!.batches[0]!;
    expect(firstBatch.runId).not.toBeNull(); expect(firstBatch.attemptId).not.toBeNull();
    expect(firstBatch.manifestReceipt?.storageStatus).toBe('verified');
    expect(deps.gateway.objects.has(firstBatch.manifestReceipt!.objectKey!)).toBe(true);
    expect(out.manifest?.counts).toMatchObject({ selected: 4, skipped: 4 });
    await expect(access(base.absolutePath(firstBatch.prefix))).resolves.toBeUndefined();
  }, 30000);
  it('accounts for every keyword when the batch throws before returning any output', async () => {
    const deps = await setup(); deps.batchRunner.mockRejectedValueOnce(new Error('unexpected runtime failure'));
    const out = await runDailyMonitor(deps);
    expect(out.exitCode).toBe(1); expect(out.manifest?.stopReason).toBe('operational_failure');
    expect(out.manifest?.counts).toMatchObject({ selected: 80, failed: 20, skipped: 60 });
    expect(out.manifest?.stores[0]?.batches[0]?.manifestReceipt).toBeNull();
    expect(deps.batchRunner).toHaveBeenCalledTimes(1);
  });
  it('stops the real collector immediately when unsupported layouts cross a 2+1 batch boundary', async () => {
    const deps = await setup(); let queriesOpened = 0;
    const url = await writeFixture({ query: 'one 0', cards: [] });
    const out = await runDailyMonitor({ ...deps, config: { ...deps.config, maxKeywordsPerStore: 2, batchSize: 2 }, batchRunner: batch => runBatch({ ...batch, searchUrlFor: () => url, openSearchImpl: async () => { queriesOpened++; return { state: { kind: 'unknown' as const, detail: 'fixture unsupported layout' }, finalUrl: url }; } }) });
    expect(queriesOpened).toBe(3); expect(out.manifest?.stopReason).toBe('unsupported_layout');
    expect(out.manifest?.counts).toMatchObject({ selected: 4, partial: 3, skipped: 1 });
    expect(out.exitCode).toBe(2);
  }, 30000);
  it('continues the daily run across three recognized details, later keywords, and later stores', async () => {
    const deps = await setup();
    const listingKeywords = ['one 3', 'two 0', 'two 1', 'two 2', 'two 3'];
    const urls = new Map(await Promise.all(listingKeywords.map(async keyword => [keyword, await writeFixture({ query: keyword, cards: namedCards(2), endMarkerInitially: true })] as const)));
    let queriesOpened = 0;
    const out = await runDailyMonitor({
      ...deps,
      config: { ...deps.config, maxKeywordsPerStore: 4, batchSize: 2 },
      batchRunner: batch => runBatch({
        ...batch,
        searchUrlFor: keyword => urls.get(keyword) ?? urls.get('one 3')!,
        openSearchImpl: async (page, target, timeout) => {
          if (++queriesOpened <= 3) {
            await page.setContent('<main><h1>Business details</h1><button aria-label="Directions">Directions</button></main>');
            return { state: { kind: 'place_redirect' as const }, finalUrl: 'https://www.google.com/maps/place/Business/data=!3d40.75!4d-73.64' };
          }
          return openSearch(page, target, timeout);
        },
      }),
    });
    expect(queriesOpened).toBe(8);
    expect(out.manifest?.stopReason).toBeNull();
    expect(out.manifest?.counts).toMatchObject({ selected: 8, captured: 5, partial: 3, skipped: 0 });
    expect(out.manifest?.stores.map(store => store.status)).toEqual(['partial', 'completed']);
    expect(out.exitCode).toBe(0);
    expect(out.manifest).toMatchObject({ status: 'partial', executionStatus: 'completed' });
    expect(out.manifest?.counts).toMatchObject({ nonRanking: 3 });
    expect(out.manifestReceipt?.storageStatus).toBe('verified');
    const batches = out.manifest!.stores.flatMap(store => store.batches);
    expect(batches).toHaveLength(4);
    const manifests = await Promise.all(batches.map(async batch => {
      expect(batch.manifestReceipt?.storageStatus).toBe('verified');
      return JSON.parse((await deps.gateway.get(batch.manifestReceipt!.objectKey!)).toString()) as BatchManifest;
    }));
    const queries = manifests.flatMap(manifest => manifest.queries);
    expect(queries.slice(0, 3).map(query => query.stopReason)).toEqual(['non_ranking_result', 'non_ranking_result', 'non_ranking_result']);
    expect(queries.slice(3).every(query => query.status === 'captured' && query.persistenceStatus === 'verified')).toBe(true);
  }, 30000);
  it('namespacing preserves artifact key identity across write/persist/read paths', async () => {
    const deps = await setup(); const scoped = new NamespacedBatchStore(deps.store, '2026-09-18/one/daily/batches/b01');
    const relative = 'maps-keyword-capture/2026-09-18/run/att/q/qa/result.json';
    const written = await scoped.writeFile(relative, '{}');
    const receipt = await scoped.persist(written);
    expect(receipt.objectKey).toBe('2026-09-18/one/daily/batches/b01/run/att/q/qa/result.json');
    expect(await readFile(scoped.absolutePath(relative), 'utf8')).toBe('{}');
  });
});
