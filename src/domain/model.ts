import type { GridRing } from '../grid/grid.js';

/**
 * The rank-tracking domain.
 *
 * A RankObservation is the fact the system exists to produce: on one surface, for one store and
 * keyword, at one observation point, at one moment, where did the store rank, and which evidence
 * proves it. Everything else (grid metrics, trends, surface comparisons) derives from it.
 */
export type Surface = 'web' | 'android';
export type LocationMode = 'query_only' | 'map_view' | 'device_gps';
export type RankStatus = 'ranked' | 'not_found' | 'not_found_in_prefix' | 'not_evaluated' | 'blocked' | 'failed';

export interface ObservedListing {
  displayPosition: number; organicRank: number | null;
  resultType: 'ad' | 'organic' | 'unknown';
  name: string | null; placeId: string | null;
  rating: number | null; reviewCount: number | null; distanceText: string | null;
}
export interface RankObservation {
  /** `${surface}|${storeId}|${keywordKey}|${pointId}|${observedAt}`; stable so re-ingesting is idempotent. */
  observationId: string;
  surface: Surface;
  storeId: string; placeId: string;
  keyword: string; keywordKey: string; keywordTier: 'core' | 'longTail' | null;
  pointId: string;
  point: { latitude: number; longitude: number; distanceKm: number | null; ring: GridRing | null };
  locationMode: LocationMode;
  /** UTC instant the query started. */
  observedAt: string;
  /** Calendar date in the tracking timezone, for daily grouping. */
  localDate: string;
  scanId: string; queryId: string;
  rank: { status: RankStatus; displayPosition: number | null; organicRank: number | null; listingsObserved: number; listingStatus: string; stopReason: string | null };
  topListings: ObservedListing[];
  evidence: { manifestKey: string | null; resultKey: string | null; screenshotKeys: string[] };
  source: { adapterVersion: string | null; profileHash: string | null };
  ingestedAt: string;
}

export function keywordKey(keyword: string): string {
  return keyword.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}
export function observationId(o: Pick<RankObservation, 'surface' | 'storeId' | 'keywordKey' | 'pointId' | 'observedAt'>): string {
  return `${o.surface}|${o.storeId}|${o.keywordKey}|${o.pointId}|${o.observedAt}`;
}
