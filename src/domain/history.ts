import { createHash } from 'node:crypto';
import { keywordKey, observationCohortKey, organicRankForMetrics, type RankObservation, type Surface } from './model.js';
import type { StoredStore } from './repository.js';

export interface TimelineOptions { surface: Surface; pointId: string; from: string; to: string; keywordKey?: string; limit: number; cursor?: string }
export interface TimelinePage { items: RankObservation[]; nextCursor: string | null; complete: boolean }
export interface HistoryObservation extends RankObservation { eligible: boolean; metricOrganicRank: number | null; cohortKey: string | null }
export interface ObservedPoint {
  pointId: string; point: RankObservation['point']; locationMode: RankObservation['locationMode'];
  coordinateStatus: 'recorded' | 'unavailable'; coordinateVariants: number;
  observedFrom: string; observedTo: string; observations: number; latestObservationId: string;
  latestStatus: RankObservation['rank']['status']; locationEvidence: NonNullable<RankObservation['quality']>['locationEvidence'] | null;
}
export interface PointInventory { points: ObservedPoint[]; truncated: boolean }
export interface RosterLatest {
  storeId: string; surface: Surface; configured: number; withRecord: number; qualifiedRanked: number; top3: number;
  qualifiedAbsent: number; unavailable: number; noRecord: number; historicalOnly: number;
  oldestObservedAt: string | null; newestObservedAt: string | null;
}
export function compareObservations(a: RankObservation, b: RankObservation): number {
  const time = a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0;
  return time || (a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0);
}
function scope(storeId: string, options: TimelineOptions): string {
  return createHash('sha256').update(JSON.stringify([storeId, options.surface, options.pointId, options.from, options.to, options.keywordKey ?? null])).digest('hex');
}
export function decodeHistoryCursor(storeId: string, options: TimelineOptions): { observedAt: string; observationId: string } | null {
  if (!options.cursor) return null;
  try {
    if (options.cursor.length > 16_384 || !/^[A-Za-z0-9_-]+$/u.test(options.cursor)) throw new Error();
    const cursor: unknown = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
    if (!cursor || typeof cursor !== 'object') throw new Error();
    const c = cursor as Record<string, unknown>;
    if (c.v !== 1 || c.scope !== scope(storeId, options) || typeof c.observedAt !== 'string' || !Number.isFinite(Date.parse(c.observedAt)) || typeof c.observationId !== 'string' || !c.observationId || c.observationId.length > 8000) throw new Error();
    return { observedAt: c.observedAt, observationId: c.observationId };
  } catch { throw new Error('invalid timeline cursor for this selection'); }
}
export function historyPage(storeId: string, rows: RankObservation[], options: TimelineOptions): TimelinePage {
  const items = rows.slice(0, options.limit), last = items.at(-1), complete = rows.length <= options.limit;
  return { items, complete, nextCursor: complete || !last ? null : Buffer.from(JSON.stringify({ v: 1, scope: scope(storeId, options), observedAt: last.observedAt, observationId: last.observationId })).toString('base64url') };
}
export function summarizeRoster(store: StoredStore, surface: Surface, rows: RankObservation[]): RosterLatest {
  const roster = new Set((store.keywordTargets?.map(t => t.keyword) ?? [...store.keywords.core, ...store.keywords.longTail]).map(keywordKey));
  const latest = new Map<string, RankObservation>();
  for (const row of rows) if (!latest.has(row.keywordKey) || compareObservations(row, latest.get(row.keywordKey)!) > 0) latest.set(row.keywordKey, row);
  let qualifiedRanked = 0, top3 = 0, qualifiedAbsent = 0, unavailable = 0, noRecord = 0;
  for (const word of roster) {
    const row = latest.get(word);
    if (!row) { noRecord++; continue; }
    const rank = organicRankForMetrics(row);
    if (rank === undefined) unavailable++;
    else if (rank === null) qualifiedAbsent++;
    else { qualifiedRanked++; if (rank <= 3) top3++; }
  }
  const times = [...latest.values()].filter(row => roster.has(row.keywordKey)).map(row => row.observedAt).sort();
  return { storeId: store.storeId, surface, configured: roster.size, withRecord: roster.size - noRecord, qualifiedRanked, top3, qualifiedAbsent, unavailable, noRecord,
    historicalOnly: [...latest.keys()].filter(word => !roster.has(word)).length, oldestObservedAt: times[0] ?? null, newestObservedAt: times.at(-1) ?? null };
}
export function observedPoints(rows: RankObservation[]): PointInventory {
  const groups = new Map<string, RankObservation[]>();
  for (const row of rows) { const group = groups.get(row.pointId) ?? []; group.push(row); groups.set(row.pointId, group); }
  const points = [...groups].sort(([a], [b]) => a.localeCompare(b)).slice(0, 500).map(([pointId, group]): ObservedPoint => {
    group.sort(compareObservations); const row = group.at(-1)!;
    return { pointId, point: row.point, locationMode: row.locationMode, coordinateStatus: validCoordinates(row.point) ? 'recorded' : 'unavailable',
      coordinateVariants: new Set(group.map(item => JSON.stringify([item.point.latitude, item.point.longitude]))).size,
      observedFrom: group[0]!.observedAt, observedTo: row.observedAt, observations: group.length, latestObservationId: row.observationId, latestStatus: row.rank.status,
      locationEvidence: row.quality?.locationEvidence ?? null };
  });
  return { points, truncated: groups.size > 500 };
}
export function validCoordinates(point: { latitude: number | null; longitude: number | null }): boolean {
  return typeof point.latitude === 'number' && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && typeof point.longitude === 'number' && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}
/** Storage references are relative object keys, never credentials, signed URLs or local files. */
function evidenceKey(value: string | null): string | null {
  if (!value || !/^(?:tracking|android-maps|maps-keyword-capture|\d{4}-\d{2}-\d{2})\/[A-Za-z0-9_.+\-/%一-鿿]+$/u.test(value)) return null;
  try { if (decodeURIComponent(value).split('/').some(part => !part || part === '.' || part === '..')) return null; } catch { return null; }
  return value;
}
/** Explicit public projection: adding a private ingestion field does not expose it to HTTP. */
export function historyObservation(row: RankObservation): HistoryObservation {
  const rank = organicRankForMetrics(row), q = row.quality, geo = q?.geographicRelevance;
  return {
    observationId: row.observationId, surface: row.surface, storeId: row.storeId, placeId: row.placeId,
    keyword: row.keyword, keywordKey: row.keywordKey, keywordTier: row.keywordTier, pointId: row.pointId,
    point: { latitude: row.point.latitude, longitude: row.point.longitude, distanceKm: row.point.distanceKm, ring: row.point.ring, ...(row.point.zoom === undefined ? {} : { zoom: row.point.zoom }) },
    locationMode: row.locationMode, observedAt: row.observedAt, localDate: row.localDate, scanId: row.scanId, queryId: row.queryId,
    ...(row.gridSpec ? { gridSpec: { center: { latitude: row.gridSpec.center.latitude, longitude: row.gridSpec.center.longitude }, radiusKm: row.gridSpec.radiusKm, size: row.gridSpec.size } } : {}),
    ...(row.gridRunId ? { gridRunId: row.gridRunId } : {}),
    ...(row.monitoringTarget ? { monitoringTarget: structuredClone(row.monitoringTarget) } : {}),
    rank: { status: row.rank.status, displayPosition: row.rank.displayPosition, organicRank: row.rank.organicRank, listingsObserved: row.rank.listingsObserved, listingStatus: row.rank.listingStatus, stopReason: row.rank.stopReason,
      ...(row.rank.targetOccurrences ? { targetOccurrences: row.rank.targetOccurrences.map(o => ({ displayPosition: o.displayPosition, organicRank: o.organicRank, resultType: o.resultType, ...(o.occurrenceId === undefined ? {} : { occurrenceId: o.occurrenceId }) })) } : {}),
      ...(row.rank.adDisplayPositions ? { adDisplayPositions: row.rank.adDisplayPositions.slice() } : {}) },
    ...(q ? { quality: { rankingReliable: q.rankingReliable, sequenceVerified: q.sequenceVerified, classificationComplete: q.classificationComplete, screenshotCoverageComplete: q.screenshotCoverageComplete,
      identityResolved: q.identityResolved, organicCoverage: q.organicCoverage, endOfResults: q.endOfResults, resultSurface: q.resultSurface,
      geographicRelevance: geo ? { status: geo.status, expectedArea: geo.expectedArea ? { label: geo.expectedArea.label, latitude: geo.expectedArea.latitude, longitude: geo.expectedArea.longitude, radiusKm: geo.expectedArea.radiusKm, source: geo.expectedArea.source } : null,
        scope: geo.scope, checkedCount: geo.checkedCount, insideCount: geo.insideCount, outsideCount: geo.outsideCount, unknownCount: geo.unknownCount, reason: geo.reason } : null,
      ...(q.locationEvidence ? { locationEvidence: { injectionStatus: q.locationEvidence.injectionStatus, deviceLocationStatus: q.locationEvidence.deviceLocationStatus, mapsLocationStatus: q.locationEvidence.mapsLocationStatus } } : {}), warnings: q.warnings.slice() } } : {}),
    topListings: row.topListings.map(o => ({ displayPosition: o.displayPosition, organicRank: o.organicRank, resultType: o.resultType, name: o.name, placeId: o.placeId, rating: o.rating, reviewCount: o.reviewCount, distanceText: o.distanceText })),
    evidence: { manifestKey: evidenceKey(row.evidence.manifestKey), resultKey: evidenceKey(row.evidence.resultKey), screenshotKeys: row.evidence.screenshotKeys.map(evidenceKey).filter((key): key is string => key !== null && key.endsWith('.png')) },
    source: { adapterVersion: row.source.adapterVersion, profileHash: row.source.profileHash, ...(row.source.attemptId === undefined ? {} : { attemptId: row.source.attemptId }), ...(row.source.queryAttemptId === undefined ? {} : { queryAttemptId: row.source.queryAttemptId }) },
    ingestedAt: row.ingestedAt, eligible: rank !== undefined, metricOrganicRank: rank ?? null, cohortKey: observationCohortKey(row),
  };
}
