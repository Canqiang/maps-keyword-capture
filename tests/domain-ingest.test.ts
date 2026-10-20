import { describe, expect, it } from 'vitest';
import { ingestAndroidManifest, ingestWebBatch, type AndroidManifestLike, type IngestContext, type WebIngestInput } from '../src/domain/ingest.js';
import * as model from '../src/domain/model.js';
import { MemoryObservationStore } from '../src/domain/observation-store.js';
import type { BatchManifest, KeywordResult, Listing, ScreenshotArtifact } from '../src/contracts.js';

const target = 'ChIJtarget';
const resultFile = 'q0001/qa01/result.json';
const context: IngestContext = { timezone: 'UTC', now: () => new Date('2026-10-20T14:00:00Z') };
const metadata: KeywordResult['metadata'] = { configHash: 'config', profileHash: 'profile', adapterVersion: 'maps-feed-card/v6', sourceCommit: null, browserVersion: null, imageDigest: null, egressProfileId: null };
function listing(position: number, rank: number | null, placeId: string | null, ad = false): Listing {
  return {
    ...(ad ? { resultType: 'ad' as const, adLabel: 'Sponsored', organicRank: null } : { resultType: 'organic' as const, adLabel: null, organicRank: rank }),
    occurrenceId: `occ${position}`, businessKey: placeId, displayPosition: position, name: `Place ${position}`, address: null, mapsUrl: null, placeId,
    rating: 4.5, reviewCount: 10, category: null, rawText: `Place ${position}`,
    classificationEvidence: { source: 'supported_layout', owner: `occ${position}`, labelText: ad ? 'Sponsored' : null, layoutSignature: 'supported', evaluatedLabelLocations: ['header'], observationIds: ['obs1'] },
    observationIds: ['obs1'], screenshotIds: ['shot1'],
  };
}
const screenshot: ScreenshotArtifact = { id: 'shot1', filename: 'result__01.png', kind: 'results', bytes: 100, sha256: 'a'.repeat(64), queryId: 'q0001', queryAttemptId: 'qa01', storageStatus: 'local_only', objectKey: null, verifiedAt: null, storageError: null, capturedAt: '2026-10-20T12:00:21Z', width: 1440, height: 1000, observationId: 'obs1' };
function result(listings: Listing[] = [listing(1, 1, target)]): KeywordResult {
  return {
    schemaVersion: '1', runId: 'run_x', attemptId: 'att_x', queryId: 'q0001', queryAttemptId: 'qa01', keyword: 'food',
    startedAt: '2026-10-20T12:00:20Z', finishedAt: '2026-10-20T12:01:00Z', status: 'captured', stopReason: 'end_of_results', error: null,
    requestedLimit: 15, observedCount: listings.length, sequenceVerified: true, finalUrl: null, metadata,
    context: { locale: 'en-US', browserTimezoneId: 'UTC', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, locationMode: 'map_view', configuredMapView: { latitude: 40.7, longitude: -73.8, zoom: 15 }, observedMapView: null, loggedIn: false, geolocationPermission: 'not_granted', egressRegion: null, egressSource: null, observedLocationText: null, filters: [] },
    quality: { verifiedPrefixLength: listings.length, classificationComplete: true, screenshotCoverageComplete: true, warnings: [], observedQueryText: 'food', queryCorrectionText: null, resultSurface: 'results_list' },
    listings, screenshots: [screenshot], observationArtifactIds: ['obs1'],
  };
}
function input(r: KeywordResult = result()): WebIngestInput {
  const manifest: BatchManifest = {
    schemaVersion: '1', runId: 'run_x', attemptId: 'att_x', startedAt: '2026-10-20T12:00:00Z', finishedAt: '2026-10-20T12:01:01Z', status: 'completed', metadata, persistenceMode: 'local_only',
    queries: [{ queryId: r.queryId, inputIndex: 0, keyword: r.keyword, status: r.status, stopReason: r.stopReason, error: r.error, selectedQueryAttemptId: 'qa01', resultFile, artifactIds: ['result_json'], persistenceStatus: 'not_requested', attempts: [{ queryAttemptId: 'qa01', startedAt: r.startedAt, finishedAt: r.finishedAt, status: r.status, stopReason: r.stopReason, error: r.error, resultFile, artifactIds: ['result_json'] }] }] as BatchManifest['queries'],
    artifacts: [{ id: 'result_json', filename: 'result.json', kind: 'result_json', bytes: 100, sha256: 'b'.repeat(64), queryId: r.queryId, queryAttemptId: 'qa01', storageStatus: 'verified', objectKey: 'tracking/web/date/scan/store/run_x/att_x/q0001/qa01/result.json', verifiedAt: '2026-10-20T12:01:01Z', storageError: null }],
  };
  return { manifest, results: new Map([[resultFile, r]]), store: { storeId: 's', placeId: target }, pointId: 'r0c0', manifestKey: 'tracking/web/date/scan/store/run_x/att_x/manifest.json' };
}
const ingest = (r = result()) => ingestWebBatch(input(r), context)[0]!;
// Optional lookup makes the initial RED run fail on the expected behavior, not an import error.
const metrics = (o: model.RankObservation, limit?: number) => (model as typeof model & { organicRankForMetrics?: (o: model.RankObservation, limit?: number) => number | null }).organicRankForMetrics?.(o, limit);
const cohort = (o: model.RankObservation) => (model as typeof model & { observationCohortKey?: (o: model.RankObservation) => string | null }).observationCohortKey?.(o);

describe('web ingestion preserves observations without inventing qualified ranks', () => {
  it('keeps the target ad occurrence and its independent organic occurrence', () => {
    const observation = ingest(result([listing(1, null, target, true), listing(2, 1, 'ChIJother'), listing(3, 2, target)]));
    expect(observation.rank).toMatchObject({ status: 'ranked', displayPosition: 1, organicRank: 2, adDisplayPositions: [1], targetOccurrences: [
      { displayPosition: 1, organicRank: null, resultType: 'ad' }, { displayPosition: 3, organicRank: 2, resultType: 'organic' },
    ] });
    expect(metrics(observation)).toBe(2);
  });
  it('keeps a non-ranking page out of absence observations', () => {
    const r: KeywordResult = { ...result([]), status: 'partial', stopReason: 'non_ranking_result', error: null };
    r.quality.resultSurface = 'place_details';
    expect(ingest(r).rank).toMatchObject({ status: 'not_evaluated', displayPosition: null, organicRank: null });
  });
  it('does not claim absence when merchant identities are unresolved', () => {
    expect(ingest(result([listing(1, 1, null)])).rank.status).toBe('identity_unresolved');
  });
  it('retains failed sequence and geographic evidence while withholding numeric ranks', () => {
    const r = result(); r.sequenceVerified = false;
    r.quality.geographicRelevance = { status: 'outside', expectedArea: null, scope: 'observed_listings', checkedCount: 1, insideCount: 0, outsideCount: 1, unknownCount: 0, reason: 'all_observed_places_outside' };
    const observation = ingest(r);
    expect(observation.rank).toMatchObject({ status: 'unreliable', displayPosition: null, organicRank: null });
    expect(observation).toMatchObject({ quality: { sequenceVerified: false, geographicRelevance: { status: 'outside' } } });
    expect(metrics(observation)).toBeUndefined();
  });
  it('does not expose retained numeric ranks as qualified after query failure', () => {
    const r: KeywordResult = { ...result(), status: 'failed', stopReason: 'error', error: { code: 'export_failed', message: 'write failed' } };
    expect(ingest(r).rank).toMatchObject({ status: 'failed', displayPosition: null, organicRank: null });
  });
  it('uses the selected namespaced result artifact and actual local screenshot filename', () => {
    const i = { ...input(), attemptRoot: '/tmp/capture/run_x/att_x' };
    const observation = ingestWebBatch(i, context)[0]!;
    expect(observation.evidence).toMatchObject({
      resultKey: 'tracking/web/date/scan/store/run_x/att_x/q0001/qa01/result.json',
      screenshotKeys: ['/tmp/capture/run_x/att_x/q0001/qa01/result__01.png'],
    });
  });
  it('keeps same-query identity stable when its result becomes readable', async () => {
    const i = input(); const store = new MemoryObservationStore();
    const missing = ingestWebBatch({ ...i, results: new Map() }, context);
    const recovered = ingestWebBatch(i, context);
    expect(missing[0]!.observedAt).toBe('2026-10-20T12:00:20.000Z');
    expect(missing[0]!.observationId).toBe(recovered[0]!.observationId);
    await store.upsert(missing); await store.upsert(recovered);
    expect(store.documents.size).toBe(1);
    expect([...store.documents.values()][0]!.rank.status).toBe('ranked');
  });
  it('keeps different query occurrences separate even at an identical timestamp', () => {
    const a = input(), b = input(); b.manifest.queries[0]!.queryId = 'q0002';
    expect(ingestWebBatch(a, context)[0]!.observationId).not.toBe(ingestWebBatch(b, context)[0]!.observationId);
  });
  it.each(['runId', 'attemptId', 'queryId', 'queryAttemptId', 'keyword'] as const)('rejects result evidence belonging to a different %s', field => {
    const i = input(); i.results.get(resultFile)![field] = 'different';
    const observation = ingestWebBatch(i, context)[0]!;
    expect(observation.rank).toMatchObject({ status: 'failed', displayPosition: null, organicRank: null });
    expect(observation.evidence.screenshotKeys).toEqual([]);
    expect(observation.quality?.warnings).toContain('result_identity_mismatch');
  });
  it('represents unknown geometry as null', () => {
    const r = result(); r.context.locationMode = 'query_only'; r.context.configuredMapView = null;
    expect(ingest(r).point).toMatchObject({ latitude: null, longitude: null });
  });
  it('resolves keyword tiers and point metadata within the store context', () => {
    const scoped = { ...context, gridRunId: 'grid_scan', storeContexts: new Map([
      ['s', { points: new Map([['r0c0', { id: 'r0c0', row: 0, col: 0, latitude: 40.7, longitude: -73.8, distanceKm: 0, ring: 'inner' as const }]]), keywordTiers: new Map([['food', 'core' as const]]), gridSpec: { center: { latitude: 40.7, longitude: -73.8 }, radiusKm: 5, size: 5 } }],
      ['other', { keywordTiers: new Map([['food', 'longTail' as const]]) }],
    ]) };
    expect(ingestWebBatch(input(), scoped)[0]).toMatchObject({ keywordTier: 'core', point: { distanceKm: 0, ring: 'inner' }, gridSpec: { radiusKm: 5, size: 5 }, gridRunId: 'grid_scan' });
  });
  it('does not apply current plan distance or ring to a different captured coordinate', () => {
    const mismatched = { ...context, points: new Map([['r0c0', { id: 'r0c0', row: 0, col: 0, latitude: 41, longitude: -74, distanceKm: 0, ring: 'inner' as const }]]) };
    expect(ingestWebBatch(input(), mismatched)[0]!.point).toMatchObject({ latitude: 40.7, longitude: -73.8, distanceKm: null, ring: null });
  });
});

describe('shared ranking eligibility and comparison cohort', () => {
  it('rejects missing legacy quality and incomplete screenshot coverage', () => {
    const observation = ingest();
    expect(metrics(observation)).toBe(1);
    const legacy = { ...observation }; delete legacy.quality;
    expect(metrics(legacy)).toBeUndefined();
    const r = result(); r.quality.screenshotCoverageComplete = false;
    expect(metrics(ingest(r))).toBeUndefined();
  });
  it('uses organic coverage rather than twenty display positions for absence', () => {
    const r = result(Array.from({ length: 20 }, (_, i) => listing(i + 1, i === 0 ? null : i, `ChIJother${i}`, i === 0)));
    r.stopReason = 'limit_reached';
    expect(metrics(ingest(r))).toBeUndefined();
    r.listings.push(listing(21, 20, 'ChIJlast')); r.quality.verifiedPrefixLength = 21;
    expect(metrics(ingest(r))).toBeNull();
  });
  it('accepts a verified real list end while keeping a capped ad-only result distinct', () => {
    const r = result([listing(1, null, target, true)]);
    expect(ingest(r).rank.status).toBe('ad_only');
    expect(metrics(ingest(r))).toBeNull();
    r.stopReason = 'limit_reached';
    expect(metrics(ingest(r))).toBeUndefined();
  });
  it('does not compare different coordinates, viewport zooms, identities or profiles', () => {
    const a = ingest(), b = ingest();
    expect(cohort(a)).toEqual(expect.any(String));
    expect(cohort(a)).toBe(cohort(b));
    for (const changed of [
      { ...a, point: { ...a.point, latitude: 41 } },
      { ...a, point: { ...a.point, zoom: 16 } },
      { ...a, placeId: 'ChIJdifferent' },
      { ...a, source: { ...a.source, profileHash: 'different' } },
    ]) expect(cohort(a)).not.toBe(cohort(changed));
    expect(cohort({ ...a, source: { ...a.source, profileHash: null } })).toBeNull();
  });
});

describe('Android ingestion qualification', () => {
  function android(reliable: boolean | undefined): AndroidManifestLike {
    return { runId: 'android_run', startedAt: '2026-10-20T12:00:00Z', adapterVersion: 'android-screen-ocr/v4', profileHash: 'profile', queries: [{
      queryId: 'q0001', storeId: 's', keyword: 'food', location: { id: 'r0c0', latitude: 40.7, longitude: -73.8 },
      rankingStatus: 'ranked', organicRank: 1, displayPosition: 1, listingStatus: 'complete', evidenceStatus: 'captured', stopReason: 'list_end',
      targetMatches: [{ displayPosition: 1, organicRank: 1, name: 'Target', alias: 'Target' }],
      listingQuality: reliable === undefined ? null : { rankingReliable: reliable, sequenceVerified: reliable, classificationComplete: true, screenshotCoverageComplete: true, organicCoverage: 1, endOfResults: true, warnings: [] },
      listings: [{ displayPosition: 1, organicRank: 1, resultType: 'organic', name: 'Target', rating: 4.5, reviewCount: 10, distanceText: null }],
      screens: [{ capturedAt: '2026-10-20T12:00:20Z', png: { objectKey: null, relativePath: 'android/run/q0001/01.png' } }], locationScreen: null,
    }] };
  }
  it.each([false, undefined])('withholds numeric rank for unreliable or legacy Android quality: %s', reliable => {
    const observation = ingestAndroidManifest({ manifest: android(reliable), placeIds: new Map([['s', target]]) }, context)[0]!;
    expect(observation.rank).toMatchObject({ status: 'unreliable', displayPosition: null, organicRank: null });
    expect(metrics(observation)).toBeUndefined();
  });
  it('records a reliable Android occurrence and evidence without inventing field confidence', () => {
    const observation = ingestAndroidManifest({ manifest: android(true), placeIds: new Map([['s', target]]) }, context)[0]!;
    expect(observation.rank).toMatchObject({ status: 'ranked', organicRank: 1 });
    expect(metrics(observation)).toBe(1);
    expect(observation).toMatchObject({ quality: { rankingReliable: true } });
  });
});
