import { dateFolder } from '../naming.js';
import { canonicalPlaceId } from '../monitor/identity.js';
import type { BatchManifest, KeywordResult, Listing } from '../contracts.js';
import { keywordKey, observationId, type LocationMode, type ObservedListing, type RankObservation, type RankStatus } from './model.js';
import type { GridPoint } from '../grid/grid.js';

/**
 * Turn collector output into RankObservations. Collectors keep writing their own manifests and
 * evidence; ingestion reads those and derives the one fact per query. Running it twice on the
 * same manifest yields the same observation IDs, so stores can upsert.
 */
export interface IngestContext {
  timezone: string;
  /** Observation points by ID; a point the output references but the plan does not know is kept with null geometry. */
  points?: Map<string, GridPoint>;
  keywordTiers?: Map<string, 'core' | 'longTail'>;
  now?: () => Date;
}
const TOP_LISTINGS = 10;

function webListing(listing: Listing): ObservedListing {
  return { displayPosition: listing.displayPosition, organicRank: listing.organicRank, resultType: listing.resultType, name: listing.name, placeId: canonicalPlaceId(listing), rating: listing.rating, reviewCount: listing.reviewCount, distanceText: null };
}
function artifactKey(artifact: { objectKey?: string | null; relativePath?: string } | null | undefined): string | null {
  return artifact?.objectKey ?? artifact?.relativePath ?? null;
}

export interface WebIngestInput {
  manifest: BatchManifest;
  /** Result JSON per manifest `resultFile`. */
  results: Map<string, KeywordResult>;
  store: { storeId: string; placeId: string };
  /** Point the batch was planned for; defaults to the centre when the batch had no map view. */
  pointId?: string;
  manifestKey?: string | null;
}
export function ingestWebBatch(input: WebIngestInput, context: IngestContext): RankObservation[] {
  const now = (context.now ?? (() => new Date()))().toISOString();
  const observations: RankObservation[] = [];
  for (const entry of input.manifest.queries) {
    const result = entry.resultFile ? input.results.get(entry.resultFile) : undefined;
    const observedAt = new Date(result?.startedAt ?? input.manifest.startedAt).toISOString();
    const pointId = input.pointId ?? 'r0c0';
    const point = context.points?.get(pointId);
    const configured = result?.context.configuredMapView ?? null;
    const listings = result?.listings ?? [];
    const matched = listings.filter(l => canonicalPlaceId(l) === input.store.placeId);
    const first = matched[0];
    let status: RankStatus;
    if (entry.status === 'blocked') status = 'blocked';
    else if (entry.status === 'failed' || entry.status === 'skipped' || !result) status = 'failed';
    else if (first) status = 'ranked';
    else if (entry.status === 'captured') status = 'not_found';
    else status = 'not_found_in_prefix';
    const observation: RankObservation = {
      observationId: '', surface: 'web', storeId: input.store.storeId, placeId: input.store.placeId,
      keyword: entry.keyword, keywordKey: keywordKey(entry.keyword), keywordTier: context.keywordTiers?.get(keywordKey(entry.keyword)) ?? null,
      pointId,
      point: { latitude: configured?.latitude ?? point?.latitude ?? Number.NaN, longitude: configured?.longitude ?? point?.longitude ?? Number.NaN, distanceKm: point?.distanceKm ?? null, ring: point?.ring ?? null },
      locationMode: (result?.context.locationMode ?? 'query_only') as LocationMode,
      observedAt, localDate: dateFolder(new Date(observedAt), context.timezone),
      scanId: input.manifest.runId, queryId: entry.queryId,
      rank: { status, displayPosition: first?.displayPosition ?? null, organicRank: first?.organicRank ?? null, listingsObserved: listings.length, listingStatus: entry.status, stopReason: entry.stopReason ?? null },
      topListings: listings.slice(0, TOP_LISTINGS).map(webListing),
      evidence: { manifestKey: input.manifestKey ?? null, resultKey: entry.resultFile ?? null, screenshotKeys: (result?.screenshots ?? []).map(artifactKey).filter((k): k is string => k !== null) },
      source: { adapterVersion: input.manifest.metadata.adapterVersion ?? null, profileHash: input.manifest.metadata.profileHash ?? null },
      ingestedAt: now,
    };
    if (!Number.isFinite(observation.point.latitude)) observation.point = { ...observation.point, latitude: 0, longitude: 0 };
    observation.observationId = observationId(observation);
    observations.push(observation);
  }
  return observations;
}

/** The subset of an Android v4 manifest that ingestion reads. */
export interface AndroidManifestLike {
  runId: string; startedAt: string; adapterVersion?: string; profileHash?: string | null;
  queries: Array<{
    queryId: string; storeId: string; keyword: string;
    location: { id: string; latitude: number; longitude: number };
    rankingStatus: string; organicRank: number | null; displayPosition: number | null;
    listingStatus: string; evidenceStatus: string; stopReason: string | null;
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
    const observedAt = new Date(query.screens[0]?.capturedAt ?? query.locationScreen?.capturedAt ?? input.manifest.startedAt).toISOString();
    const point = context.points?.get(query.location.id);
    const status: RankStatus = query.evidenceStatus === 'failed' || query.evidenceStatus === 'skipped' ? 'failed'
      : query.rankingStatus === 'ranked' ? 'ranked' : query.rankingStatus === 'not_found' ? 'not_found' : query.rankingStatus === 'not_found_in_prefix' ? 'not_found_in_prefix' : 'not_evaluated';
    const observation: RankObservation = {
      observationId: '', surface: 'android', storeId: query.storeId, placeId,
      keyword: query.keyword, keywordKey: keywordKey(query.keyword), keywordTier: context.keywordTiers?.get(keywordKey(query.keyword)) ?? null,
      pointId: query.location.id,
      point: { latitude: query.location.latitude, longitude: query.location.longitude, distanceKm: point?.distanceKm ?? null, ring: point?.ring ?? null },
      locationMode: 'device_gps',
      observedAt, localDate: dateFolder(new Date(observedAt), context.timezone),
      scanId: input.manifest.runId, queryId: query.queryId,
      rank: { status, displayPosition: query.displayPosition, organicRank: query.organicRank, listingsObserved: query.listings.length, listingStatus: query.listingStatus, stopReason: query.stopReason },
      topListings: query.listings.slice(0, TOP_LISTINGS).map(l => ({ displayPosition: l.displayPosition, organicRank: l.organicRank, resultType: l.resultType, name: l.name, placeId: null, rating: l.rating, reviewCount: l.reviewCount, distanceText: l.distanceText })),
      evidence: { manifestKey: input.manifestKey ?? null, resultKey: null, screenshotKeys: query.screens.map(s => artifactKey(s.png)).filter((k): k is string => k !== null) },
      source: { adapterVersion: input.manifest.adapterVersion ?? null, profileHash: input.manifest.profileHash ?? null },
      ingestedAt: now,
    };
    observation.observationId = observationId(observation);
    observations.push(observation);
  }
  return observations;
}
