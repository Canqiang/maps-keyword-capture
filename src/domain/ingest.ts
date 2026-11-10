import { basename, dirname, isAbsolute, join, normalize } from 'node:path';
import { dateFolder } from '../naming.js';
import { canonicalPlaceId } from '../monitor/identity.js';
import type { BatchManifest, KeywordResult, Listing } from '../contracts.js';
import { keywordKey, observationId, type ObservedListing, type ObservationQuality, type RankObservation, type RankStatus, type TargetOccurrence } from './model.js';
import type { GridPoint, GridSpec } from '../grid/grid.js';
import type { KeywordTarget, MonitoringCatalog, TrackingPoint } from './tracking-config.js';

export interface StoreIngestContext {
  points?: Map<string, TrackingPoint>;
  keywordTiers?: Map<string, 'core' | 'longTail'>;
  /** Captured scan plan only; historical imports must not substitute today's grid. */
  gridSpec?: GridSpec;
  monitoringCatalog?: MonitoringCatalog;
  keywordTargets?: Map<string, KeywordTarget>;
}
export interface IngestContext extends StoreIngestContext {
  timezone: string;
  storeContexts?: Map<string, StoreIngestContext>;
  gridRunId?: string;
  now?: () => Date;
}
const TOP_LISTINGS = 10;
const scopedContext = (context: IngestContext, storeId: string): StoreIngestContext => context.storeContexts ? context.storeContexts.get(storeId) ?? {} : context;
const booleanOrNull = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
const coordinate = (value: unknown, maximum: number): number | null => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= maximum ? value : null;
function allVerified(checks: Array<boolean | null>): boolean | null {
  return checks.includes(false) ? false : checks.includes(null) ? null : true;
}
function plannedMetadata(point: GridPoint | undefined, latitude: number | null, longitude: number | null) {
  const matches = point && latitude !== null && longitude !== null && Math.abs(point.latitude - latitude) < 0.000001 && Math.abs(point.longitude - longitude) < 0.000001;
  return { distanceKm: matches ? point.distanceKm : null, ring: matches ? point.ring : null };
}
function monitoringSnapshot(context: StoreIngestContext, keyword: string, point: TrackingPoint | undefined, latitude: number | null, longitude: number | null): Pick<RankObservation, 'monitoringTarget'> {
  const target = context.keywordTargets?.get(keyword)?.pointTargets.find(t => t.pointId === point?.id);
  if (!context.monitoringCatalog || !point?.fixedPoint || !target || latitude === null || longitude === null
    || Math.abs(point.latitude - latitude) >= 0.000001 || Math.abs(point.longitude - longitude) >= 0.000001) return {};
  return { monitoringTarget: structuredClone({ catalog: context.monitoringCatalog, point: point.fixedPoint, target }) };
}
function webListing(listing: Listing): ObservedListing {
  return { displayPosition: listing.displayPosition, organicRank: listing.organicRank, resultType: listing.resultType, name: listing.name, placeId: canonicalPlaceId(listing), rating: listing.rating, reviewCount: listing.reviewCount, distanceText: null };
}
/** Only consecutive organic ranks in the verified display prefix establish coverage. */
function organicCoverage(listings: Pick<ObservedListing, 'displayPosition' | 'organicRank' | 'resultType'>[]): number {
  let organic = 0;
  for (const [index, listing] of listings.entries()) {
    if (listing.displayPosition !== index + 1 || listing.resultType === 'unknown') break;
    if (listing.resultType === 'organic') {
      if (listing.organicRank !== organic + 1) break;
      organic++;
    }
  }
  return organic;
}
function targetRank(status: RankStatus, occurrences: TargetOccurrence[]): Pick<RankObservation['rank'], 'displayPosition' | 'organicRank' | 'targetOccurrences' | 'adDisplayPositions'> {
  const qualified = status === 'ranked' || status === 'ad_only';
  const organic = occurrences.find(o => o.resultType === 'organic' && o.organicRank !== null);
  return {
    displayPosition: qualified ? occurrences[0]?.displayPosition ?? null : null,
    organicRank: status === 'ranked' ? organic?.organicRank ?? null : null,
    targetOccurrences: occurrences,
    adDisplayPositions: occurrences.filter(o => o.resultType === 'ad').map(o => o.displayPosition),
  };
}
function localKey(relative: string | null, root?: string): string | null {
  if (!relative || isAbsolute(relative) || relative.split(/[\\/]/u).some(part => part === '..')) return null;
  return root ? join(root, normalize(relative)) : normalize(relative);
}

export interface WebIngestInput {
  manifest: BatchManifest;
  results: Map<string, KeywordResult>;
  store: { storeId: string; placeId: string };
  pointId?: string;
  manifestKey?: string | null;
  attemptRoot?: string;
}
export function ingestWebBatch(input: WebIngestInput, context: IngestContext): RankObservation[] {
  const now = (context.now ?? (() => new Date()))().toISOString();
  const scoped = scopedContext(context, input.store.storeId);
  return input.manifest.queries.map(entry => {
    const candidate = entry.resultFile ? input.results.get(entry.resultFile) : undefined;
    const identityMismatch = !!candidate && (candidate.runId !== input.manifest.runId || candidate.attemptId !== input.manifest.attemptId
      || candidate.queryId !== entry.queryId || candidate.queryAttemptId !== entry.selectedQueryAttemptId || keywordKey(candidate.keyword) !== keywordKey(entry.keyword));
    const result = identityMismatch ? undefined : candidate;
    const attempt = entry.attempts.find(a => a.queryAttemptId === entry.selectedQueryAttemptId);
    const observedAt = new Date(attempt?.startedAt ?? result?.startedAt ?? input.manifest.startedAt).toISOString();
    const pointId = input.pointId ?? 'r0c0';
    const point = scoped.points?.get(pointId);
    const configured = result?.context.configuredMapView;
    const latitude = coordinate(configured?.latitude ?? point?.latitude, 90), longitude = coordinate(configured?.longitude ?? point?.longitude, 180);
    const listings = result?.listings ?? [];
    const matched = listings.filter(l => canonicalPlaceId(l) === input.store.placeId);
    const occurrences: TargetOccurrence[] = matched.map(l => ({ displayPosition: l.displayPosition, organicRank: l.organicRank, resultType: l.resultType, occurrenceId: l.occurrenceId }));
    const sourceQuality = result?.quality;
    const sequenceVerified = booleanOrNull(result?.sequenceVerified);
    const classificationComplete = booleanOrNull(sourceQuality?.classificationComplete);
    const screenshotCoverageComplete = booleanOrNull(sourceQuality?.screenshotCoverageComplete);
    const resultSurface = sourceQuality?.resultSurface ?? null;
    const identityResolved = result ? matched.length > 0 || listings.every(l => canonicalPlaceId(l) !== null) : null;
    const geographicRelevance = sourceQuality?.geographicRelevance ?? null;
    const screenshotPolicy = sourceQuality?.screenshotPolicy;
    const top10Targets = matched.filter(l => l.resultType === 'organic' && l.organicRank !== null && l.organicRank <= 10);
    const policyVerified = result?.status === 'captured' && entry.status === 'captured' && screenshotPolicy?.version === 'target-organic-top10/v1'
      && screenshotPolicy.targetPlaceId === input.store.placeId && screenshotPolicy.satisfied === true
      && (screenshotPolicy.decision === 'omitted_by_policy'
        ? top10Targets.length === 0 && screenshotPolicy.triggerRank === null
        : screenshotPolicy.decision === 'captured' && top10Targets.length > 0
          && screenshotPolicy.triggerRank === top10Targets[0]!.organicRank
          && top10Targets.every(l => l.screenshotIds.some(id => result.screenshots.some(s => s.id === id && s.kind === 'results'
            && s.queryId === result.queryId && s.queryAttemptId === result.queryAttemptId
            && s.bytes > 0 && (s.storageStatus === 'verified' || s.storageStatus === 'local_only')))));
    const quality: ObservationQuality = {
      ...(screenshotPolicy ? { screenshotPolicy: { ...screenshotPolicy, satisfied: policyVerified } } : {}),
      rankingReliable: allVerified([sequenceVerified, classificationComplete, screenshotPolicy ? policyVerified : screenshotCoverageComplete,
        result ? sourceQuality?.verifiedPrefixLength === listings.length : null,
        resultSurface === null ? null : resultSurface === 'results_list']),
      sequenceVerified, classificationComplete, screenshotCoverageComplete, identityResolved,
      organicCoverage: sequenceVerified === true ? organicCoverage(listings) : null,
      endOfResults: !!result && entry.status === 'captured' && result.status === 'captured' && entry.stopReason === 'end_of_results' && result.stopReason === 'end_of_results',
      resultSurface, geographicRelevance, warnings: identityMismatch ? ['result_identity_mismatch'] : sourceQuality?.warnings?.map(w => `${w.code}: ${w.message}`) ?? [],
    };
    let status: RankStatus;
    if (entry.status === 'blocked' || result?.status === 'blocked') status = 'blocked';
    else if (entry.status === 'failed' || entry.status === 'skipped' || !result || result.status === 'failed') status = 'failed';
    else if (entry.stopReason === 'non_ranking_result' || resultSurface === 'place_details' || resultSurface === 'no_results') status = 'not_evaluated';
    else if (identityResolved !== true) status = 'identity_unresolved';
    else if (quality.rankingReliable !== true || geographicRelevance?.status === 'outside' || geographicRelevance?.status === 'mixed') status = 'unreliable';
    else if (matched.some(l => l.resultType === 'organic' && l.organicRank !== null)) status = 'ranked';
    else if (matched.some(l => l.resultType === 'ad')) status = 'ad_only';
    else if (matched.length) status = 'unreliable';
    else status = entry.status === 'captured' ? 'not_found' : 'not_found_in_prefix';
    const resultArtifact = input.manifest.artifacts.find(a => a.kind === 'result_json' && a.queryId === entry.queryId
      && a.queryAttemptId === entry.selectedQueryAttemptId && a.filename === basename(entry.resultFile ?? ''));
    const resultKey = resultArtifact?.objectKey ?? localKey(entry.resultFile, input.attemptRoot);
    const screenshotKeys = (result?.screenshots ?? []).flatMap(s => {
      if (s.objectKey) return [s.objectKey];
      if (!entry.resultFile || basename(s.filename ?? '') !== s.filename) return [];
      const key = localKey(join(dirname(entry.resultFile), s.filename), input.attemptRoot);
      return key ? [key] : [];
    });
    const observation: RankObservation = {
      observationId: '', surface: 'web', storeId: input.store.storeId, placeId: input.store.placeId,
      keyword: entry.keyword, keywordKey: keywordKey(entry.keyword), keywordTier: scoped.keywordTiers?.get(keywordKey(entry.keyword)) ?? null,
      pointId, point: { latitude, longitude, ...plannedMetadata(point, latitude, longitude), zoom: configured?.zoom ?? null },
      ...monitoringSnapshot(scoped, entry.keyword, point, latitude, longitude),
      ...(scoped.gridSpec ? { gridSpec: structuredClone(scoped.gridSpec) } : {}),
      ...(context.gridRunId ? { gridRunId: context.gridRunId } : {}),
      locationMode: result?.context.locationMode ?? 'query_only', observedAt, localDate: dateFolder(new Date(observedAt), context.timezone), scanId: input.manifest.runId, queryId: entry.queryId,
      rank: { status, ...targetRank(status, occurrences), listingsObserved: listings.length, listingStatus: entry.status, stopReason: entry.stopReason ?? null },
      quality, topListings: listings.map(webListing),
      evidence: { manifestKey: input.manifestKey ?? null, resultKey, screenshotKeys },
      source: { adapterVersion: input.manifest.metadata.adapterVersion ?? null, profileHash: input.manifest.metadata.profileHash ?? null, attemptId: input.manifest.attemptId, queryAttemptId: entry.selectedQueryAttemptId }, ingestedAt: now,
    };
    observation.observationId = observationId(observation);
    return observation;
  });
}

export interface AndroidManifestLike {
  runId: string; startedAt: string; adapterVersion?: string; profileHash?: string | null;
  queries: Array<{
    queryId: string; storeId: string; keyword: string;
    location: { id: string; latitude: number; longitude: number };
    rankingStatus: string; organicRank: number | null; displayPosition: number | null;
    listingStatus: string; evidenceStatus: string; stopReason: string | null;
    targetMatches?: Array<{ displayPosition: number; organicRank: number | null; name?: string; alias?: string }>;
    listingQuality?: {
      rankingReliable: boolean; sequenceVerified?: boolean; classificationComplete?: boolean; screenshotCoverageComplete?: boolean;
      organicCoverage?: number; endOfResults?: boolean; warnings?: string[];
    } | null;
    locationEvidence?: { injectionStatus?: string; deviceLocationStatus?: string; mapsLocationStatus?: string } | null;
    listings: Array<{ displayPosition: number; organicRank: number | null; resultType: 'ad' | 'organic' | 'unknown'; name: string | null; rating: number | null; reviewCount: number | null; distanceText: string | null }>;
    screens: Array<{ capturedAt: string; png: { objectKey?: string | null; relativePath: string } }>;
    locationScreen: { capturedAt: string } | null;
  }>;
}
export interface AndroidIngestInput { manifest: AndroidManifestLike; placeIds: Map<string, string>; manifestKey?: string | null }
export function ingestAndroidManifest(input: AndroidIngestInput, context: IngestContext): RankObservation[] {
  const now = (context.now ?? (() => new Date()))().toISOString();
  const observations: RankObservation[] = [];
  for (const query of input.manifest.queries) {
    const placeId = input.placeIds.get(query.storeId);
    if (!placeId) continue;
    const scoped = scopedContext(context, query.storeId);
    const observedAt = new Date(query.screens[0]?.capturedAt ?? query.locationScreen?.capturedAt ?? input.manifest.startedAt).toISOString();
    const point = scoped.points?.get(query.location.id);
    const latitude = coordinate(query.location.latitude, 90), longitude = coordinate(query.location.longitude, 180);
    const sourceQuality = query.listingQuality;
    const matchedPositions = new Set(query.targetMatches?.map(m => m.displayPosition));
    const occurrences: TargetOccurrence[] = query.listings.filter(l => matchedPositions.has(l.displayPosition))
      .map(l => ({ displayPosition: l.displayPosition, organicRank: l.organicRank, resultType: l.resultType }));
    const identityResolved = query.targetMatches ? occurrences.length > 0 || (query.rankingStatus !== 'ranked' && query.listings.every(l => !!l.name)) : null;
    const quality: ObservationQuality = {
      rankingReliable: booleanOrNull(sourceQuality?.rankingReliable), sequenceVerified: booleanOrNull(sourceQuality?.sequenceVerified),
      classificationComplete: booleanOrNull(sourceQuality?.classificationComplete), screenshotCoverageComplete: booleanOrNull(sourceQuality?.screenshotCoverageComplete),
      identityResolved, organicCoverage: sourceQuality?.sequenceVerified === true ? Math.min(sourceQuality.organicCoverage ?? 0, organicCoverage(query.listings)) : null,
      endOfResults: sourceQuality?.endOfResults === true && query.stopReason === 'list_end',
      resultSurface: query.listingStatus === 'non_ranking' ? 'non_ranking' : query.listings.length ? 'results_list' : null, geographicRelevance: null,
      locationEvidence: { injectionStatus: query.locationEvidence?.injectionStatus ?? null, deviceLocationStatus: query.locationEvidence?.deviceLocationStatus ?? null, mapsLocationStatus: query.locationEvidence?.mapsLocationStatus ?? null },
      warnings: [...(sourceQuality?.warnings ?? [])],
    };
    let status: RankStatus;
    if (query.evidenceStatus === 'failed' || query.evidenceStatus === 'skipped') status = 'failed';
    else if (query.listingStatus === 'non_ranking' || query.stopReason === 'screen_detail' || query.stopReason === 'screen_no_results') status = 'not_evaluated';
    else if (allVerified([quality.rankingReliable, quality.sequenceVerified, quality.classificationComplete, quality.screenshotCoverageComplete]) !== true) status = 'unreliable';
    else if (identityResolved !== true) status = 'identity_unresolved';
    else if (occurrences.some(o => o.resultType === 'organic' && o.organicRank !== null)) status = 'ranked';
    else if (occurrences.some(o => o.resultType === 'ad')) status = 'ad_only';
    else if (query.rankingStatus === 'not_found') status = 'not_found';
    else if (query.rankingStatus === 'not_found_in_prefix') status = 'not_found_in_prefix';
    else status = 'not_evaluated';
    const observation: RankObservation = {
      observationId: '', surface: 'android', storeId: query.storeId, placeId,
      keyword: query.keyword, keywordKey: keywordKey(query.keyword), keywordTier: scoped.keywordTiers?.get(keywordKey(query.keyword)) ?? null,
      pointId: query.location.id, point: { latitude, longitude, ...plannedMetadata(point, latitude, longitude) },
      ...monitoringSnapshot(scoped, query.keyword, point, latitude, longitude),
      ...(scoped.gridSpec ? { gridSpec: structuredClone(scoped.gridSpec) } : {}),
      ...(context.gridRunId ? { gridRunId: context.gridRunId } : {}),
      locationMode: 'device_gps', observedAt, localDate: dateFolder(new Date(observedAt), context.timezone), scanId: input.manifest.runId, queryId: query.queryId,
      rank: { status, ...targetRank(status, occurrences), listingsObserved: query.listings.length, listingStatus: query.listingStatus, stopReason: query.stopReason },
      quality, topListings: query.listings.slice(0, TOP_LISTINGS).map(l => ({ ...l, placeId: null })),
      evidence: { manifestKey: input.manifestKey ?? null, resultKey: null, screenshotKeys: query.screens.map(s => s.png.objectKey ?? s.png.relativePath) },
      source: { adapterVersion: input.manifest.adapterVersion ?? null, profileHash: input.manifest.profileHash ?? null }, ingestedAt: now,
    };
    observation.observationId = observationId(observation);
    observations.push(observation);
  }
  return observations;
}
