import { haversineKm, type GridPoint, type GridRing } from './grid.js';

/**
 * Grid rank metrics, after Local Falcon:
 * - ARP  (Average Rank Position): mean rank over the points where the store appears.
 * - ATRP (Average Total Rank Position): mean over every point, a missing store counted as `notFoundRank` (21).
 * - SoLV (Share of Local Voice): share of points where the store ranks in the top 3.
 * Plus rank buckets for the heat map and the same figures per distance ring.
 */
export interface GridObservation {
  pointId: string; distanceKm: number; ring: GridRing;
  /** Organic rank (ads excluded) or display position, depending on what the caller tracks. */
  rank: number | null;
}
export interface RankBuckets { top3: number; top10: number; top20: number; notFound: number }
export interface RingMetrics { points: number; found: number; arp: number | null; atrp: number | null; solv: number | null }
export interface GridMetrics extends RingMetrics {
  notFoundRank: number;
  buckets: RankBuckets;
  rings: Record<GridRing, RingMetrics>;
  /** Points with no observation at all (query failed or skipped); they are excluded from every figure. */
  missingPoints: string[];
}
export interface MetricsOptions { notFoundRank?: number }

export type RankBucket = keyof RankBuckets;
export function rankBucket(rank: number | null): RankBucket {
  if (rank === null || rank > 20) return 'notFound';
  return rank <= 3 ? 'top3' : rank <= 10 ? 'top10' : 'top20';
}

function ringMetrics(observations: GridObservation[], notFoundRank: number): RingMetrics {
  const ranks = observations.map(o => (o.rank !== null && o.rank <= 20 ? o.rank : null));
  const found = ranks.filter((r): r is number => r !== null);
  const mean = (values: number[]): number => Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 100) / 100;
  return {
    points: observations.length, found: found.length,
    arp: found.length ? mean(found) : null,
    atrp: observations.length ? mean(ranks.map(r => r ?? notFoundRank)) : null,
    solv: observations.length ? Math.round((found.filter(r => r <= 3).length / observations.length) * 1000) / 1000 : null,
  };
}

/** `grid` lists every point that should have been observed; observations missing from it are reported, not invented. */
export function computeGridMetrics(grid: GridPoint[], observations: GridObservation[], options: MetricsOptions = {}): GridMetrics {
  const notFoundRank = options.notFoundRank ?? 21;
  if (!Number.isInteger(notFoundRank) || notFoundRank < 21) throw new Error('notFoundRank must be an integer of at least 21');
  const byPoint = new Map(observations.map(o => [o.pointId, o]));
  if (byPoint.size !== observations.length) throw new Error('duplicate grid observations for one point');
  const observed = grid.map(p => byPoint.get(p.id)).filter((o): o is GridObservation => o !== undefined);
  const missingPoints = grid.filter(p => !byPoint.has(p.id)).map(p => p.id);
  const unknown = observations.filter(o => !grid.some(p => p.id === o.pointId));
  if (unknown.length) throw new Error(`observations for points outside the grid: ${unknown.map(o => o.pointId).join(', ')}`);
  const buckets: RankBuckets = { top3: 0, top10: 0, top20: 0, notFound: 0 };
  for (const o of observed) buckets[rankBucket(o.rank)]++;
  const rings = Object.fromEntries((['inner', 'middle', 'outer'] as const).map(ring => [ring, ringMetrics(observed.filter(o => o.ring === ring), notFoundRank)])) as Record<GridRing, RingMetrics>;
  return { ...ringMetrics(observed, notFoundRank), notFoundRank, buckets, rings, missingPoints };
}

/** Coordinates belong to the observation, never to an interchangeable row/column label. */
export function matchesGridPoint(point: Pick<GridPoint, 'latitude' | 'longitude'>, observed: { latitude?: number | null; longitude?: number | null }): boolean {
  return Number.isFinite(observed.latitude) && Number.isFinite(observed.longitude)
    && haversineKm(point, observed as { latitude: number; longitude: number }) <= 0.001;
}

export interface GridRankEvidence {
  rank: number | null; rankingStatus: string; listingStatus: string;
  rankingReliable?: boolean; observedRanks?: Array<number | null>; stopReason?: string | null;
  endOfResults?: boolean;
}
/** A null rank is a proven absence, not the absence of an assessment. */
export function eligibleGridRank(input: GridRankEvidence): boolean {
  if (input.rankingReliable !== true || !['complete', 'partial'].includes(input.listingStatus)) return false;
  if (input.rank !== null) return input.rankingStatus === 'ranked' && Number.isInteger(input.rank) && input.rank > 0;
  if (input.rankingStatus !== 'not_found' || input.listingStatus !== 'complete') return false;
  const ranks = new Set(input.observedRanks ?? []);
  return input.endOfResults === true || Array.from({ length: 20 }, (_, i) => i + 1).every(rank => ranks.has(rank));
}

/** Historical manifests lacking geometry or reliability remain raw evidence only. */
export interface AndroidManifestLike {
  queries: Array<{
    storeId: string; keyword: string; location: { id: string; latitude?: number; longitude?: number };
    organicRank: number | null; displayPosition: number | null; listingStatus: string; evidenceStatus: string;
    rankingStatus?: string; stopReason?: string | null;
    listingQuality?: { rankingReliable: boolean; endOfResults?: boolean } | null;
    listings?: Array<{ organicRank: number | null; displayPosition: number }>;
  }>;
}
export interface ManifestSelection { storeId: string; keyword: string; rankField?: 'organicRank' | 'displayPosition' }

/** One eligible observation per immutable grid point; unsupported captures stay missing. */
export function observationsFromAndroidManifest(manifest: AndroidManifestLike, grid: GridPoint[], selection: ManifestSelection): GridObservation[] {
  const field = selection.rankField ?? 'organicRank';
  const points = new Map(grid.map(p => [p.id, p]));
  const observations: GridObservation[] = [];
  for (const query of manifest.queries) {
    if (query.storeId !== selection.storeId || query.keyword !== selection.keyword) continue;
    const point = points.get(query.location.id);
    if (!point || !matchesGridPoint(point, query.location)) continue;
    if (!['captured', 'needs_review'].includes(query.evidenceStatus)) continue;
    if (!eligibleGridRank({ rank: query[field], rankingStatus: query.rankingStatus ?? 'not_evaluated', listingStatus: query.listingStatus,
      rankingReliable: query.listingQuality?.rankingReliable ?? false, observedRanks: query.listings?.map(row => row[field]) ?? [],
      endOfResults: query.listingQuality?.endOfResults ?? false })) continue;
    if (observations.some(o => o.pointId === point.id)) throw new Error(`manifest has two queries for grid point ${point.id}`);
    observations.push({ pointId: point.id, distanceKm: point.distanceKm, ring: point.ring, rank: query[field] });
  }
  return observations;
}

/** Heat-map rows (north to south) of rank buckets, for a quick textual view. */
export function heatMapRows(grid: GridPoint[], observations: GridObservation[]): string[] {
  const byPoint = new Map(observations.map(o => [o.pointId, o]));
  const symbol = (o: GridObservation | undefined): string => (o === undefined ? ' ? ' : o.rank === null || o.rank > 20 ? ' x ' : String(o.rank).padStart(2, ' ') + ' ');
  const rows = new Map<number, GridPoint[]>();
  for (const p of grid) rows.set(p.row, [...(rows.get(p.row) ?? []), p]);
  return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, points]) => points.sort((a, b) => a.col - b.col).map(p => symbol(byPoint.get(p.id))).join(''));
}
