import type { GridRing, GridSpec } from '../grid/grid.js';
import type { GeographicRelevance } from '../contracts.js';
import type { FixedPoint, KeywordTarget, MonitoringCatalog } from './tracking-config.js';

/**
 * The rank-tracking domain.
 *
 * A RankObservation is the fact the system exists to produce: on one surface, for one store and
 * keyword, at one observation point, at one moment, where did the store rank, and which evidence
 * proves it. Everything else (grid metrics, trends, surface comparisons) derives from it.
 */
export type Surface = 'web' | 'android';
export type LocationMode = 'query_only' | 'map_view' | 'device_gps';
export type RankStatus = 'ranked' | 'ad_only' | 'not_found' | 'not_found_in_prefix' | 'not_evaluated' | 'identity_unresolved' | 'unreliable' | 'blocked' | 'failed';

export interface ObservedListing {
  displayPosition: number; organicRank: number | null;
  resultType: 'ad' | 'organic' | 'unknown';
  name: string | null; placeId: string | null;
  rating: number | null; reviewCount: number | null; distanceText: string | null;
}
export interface TargetOccurrence {
  displayPosition: number; organicRank: number | null; resultType: ObservedListing['resultType'];
  occurrenceId?: string | null;
}
/** Missing quality is legacy/unverified evidence, never an implicit successful check. */
export interface ObservationQuality {
  rankingReliable: boolean | null;
  sequenceVerified: boolean | null;
  classificationComplete: boolean | null;
  screenshotCoverageComplete: boolean | null;
  identityResolved: boolean | null;
  organicCoverage: number | null;
  endOfResults: boolean | null;
  resultSurface: string | null;
  geographicRelevance: GeographicRelevance | null;
  locationEvidence?: { injectionStatus: string | null; deviceLocationStatus: string | null; mapsLocationStatus: string | null };
  warnings: string[];
}
export interface RankObservation {
  /** Source query identity, independent of result availability or ingestion time. */
  observationId: string;
  surface: Surface;
  storeId: string; placeId: string;
  keyword: string; keywordKey: string; keywordTier: 'core' | 'longTail' | null;
  pointId: string;
  point: { latitude: number | null; longitude: number | null; distanceKm: number | null; ring: GridRing | null; zoom?: number | null };
  locationMode: LocationMode;
  /** UTC instant the query started. */
  observedAt: string;
  /** Calendar date in the tracking timezone, for daily grouping. */
  localDate: string;
  scanId: string; queryId: string;
  /** Snapshot supplied by the executing scan, never reconstructed from today's configuration. */
  gridSpec?: GridSpec;
  gridRunId?: string;
  /** Planned catalog snapshot, not a fresh location verification or achieved target. */
  monitoringTarget?: { catalog: MonitoringCatalog; point: FixedPoint; target: KeywordTarget['pointTargets'][number] };
  rank: {
    status: RankStatus; displayPosition: number | null; organicRank: number | null;
    listingsObserved: number; listingStatus: string; stopReason: string | null;
    /** All matched appearances, including ads; the scalar organic rank is selected independently. */
    targetOccurrences?: TargetOccurrence[]; adDisplayPositions?: number[];
  };
  quality?: ObservationQuality;
  topListings: ObservedListing[];
  evidence: { manifestKey: string | null; resultKey: string | null; screenshotKeys: string[] };
  source: { adapterVersion: string | null; profileHash: string | null; attemptId?: string | null; queryAttemptId?: string | null };
  ingestedAt: string;
}

export function keywordKey(keyword: string): string {
  return keyword.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}
export function observationId(o: Pick<RankObservation, 'surface' | 'storeId' | 'scanId' | 'queryId'> & { source?: RankObservation['source'] }): string {
  return ['v2', o.surface, o.storeId, o.scanId, o.source?.attemptId ?? '', o.queryId, o.source?.queryAttemptId ?? ''].map(encodeURIComponent).join('|');
}

/** Number = qualified organic rank; null = confirmed organic absence; undefined = unknown. */
export function organicRankForMetrics(o: RankObservation, organicLimit = 20): number | null | undefined {
  const q = o.quality;
  if (!q || q.rankingReliable !== true || q.sequenceVerified !== true || q.classificationComplete !== true
    || q.screenshotCoverageComplete !== true || q.identityResolved !== true) return undefined;
  if (q.geographicRelevance?.status === 'outside' || q.geographicRelevance?.status === 'mixed') return undefined;
  if (o.rank.status === 'ranked' && Number.isSafeInteger(o.rank.organicRank) && o.rank.organicRank! > 0) return o.rank.organicRank;
  if ((o.rank.status === 'not_found' || o.rank.status === 'ad_only')
    && (q.endOfResults === true || (Number.isSafeInteger(q.organicCoverage) && q.organicCoverage! >= organicLimit))) return null;
  return undefined;
}

/** Missing location/profile provenance cannot establish a historical comparison cohort. */
export function observationCohortKey(o: RankObservation): string | null {
  if (o.point.latitude === null || o.point.longitude === null || !Number.isFinite(o.point.latitude) || !Number.isFinite(o.point.longitude)
    || Math.abs(o.point.latitude) > 90 || Math.abs(o.point.longitude) > 180
    || !o.source.profileHash || !o.source.adapterVersion || o.locationMode === 'query_only') return null;
  if (o.locationMode === 'map_view' && (o.point.zoom == null || !Number.isFinite(o.point.zoom))) return null;
  if (o.locationMode === 'device_gps' && o.quality?.locationEvidence?.deviceLocationStatus !== 'matched') return null;
  return JSON.stringify([o.surface, o.storeId, o.placeId, o.keywordKey, o.pointId,
    o.point.latitude, o.point.longitude, o.point.zoom ?? null, o.locationMode, o.source.profileHash, o.source.adapterVersion]);
}
