import { generateGrid } from '../grid/grid.js';
import { computeGridMetrics, heatMapRows, matchesGridPoint, type GridObservation } from '../grid/metrics.js';
import { observationCohortKey, organicRankForMetrics, type RankObservation } from '../domain/model.js';
import { compareObservations } from '../domain/history.js';
import type { StoredStore } from '../domain/repository.js';
import { storeGridSpec, type TrackingConfig } from '../domain/tracking-config.js';

/** Existing default behavior remains newest attempted run, never latest successful run. */
export function gridHistory(rows: RankObservation[], config: TrackingConfig, store: StoredStore, selectedRunId?: string) {
  const scope = selectedRunId ? rows.filter(row => row.gridRunId === selectedRunId) : rows;
  const captured = scope.filter(row => row.gridSpec);
  const candidates = captured.length ? captured : scope.filter(row => row.pointId !== 'r0c0' || row.gridRunId);
  const newest = candidates.slice().sort((a, b) => compareObservations(b, a))[0];
  const spec = newest?.gridSpec ?? (store.center ? storeGridSpec(config, { ...store, center: store.center }) : null);
  const grid = spec ? generateGrid(spec) : [];
  const points = new Map(grid.map(point => [point.id, point]));
  const snapshotKey = (row: RankObservation): string | null => observationCohortKey(row) === null ? null
    : JSON.stringify([row.surface, row.storeId, row.placeId, row.keywordKey, row.locationMode, row.point.zoom ?? null, row.source.profileHash, row.source.adapterVersion, row.gridSpec ?? null, row.gridRunId ?? null]);
  const runRows = newest?.gridRunId ? scope.filter(row => row.gridRunId === newest.gridRunId) : scope;
  const anchor = newest?.gridRunId ? runRows.slice().sort((a, b) => compareObservations(b, a)).find(row => snapshotKey(row) !== null && organicRankForMetrics(row) !== undefined) : newest;
  const snapshot = anchor ? snapshotKey(anchor) : null;
  const latest = new Map<string, RankObservation>();
  for (const row of runRows) if ((newest?.gridRunId || (snapshot !== null && snapshotKey(row) === snapshot)) && points.has(row.pointId)
    && (!latest.has(row.pointId) || compareObservations(row, latest.get(row.pointId)!) > 0)) latest.set(row.pointId, row);
  const usable: GridObservation[] = [];
  for (const row of latest.values()) {
    const point = points.get(row.pointId)!, rank = organicRankForMetrics(row);
    if (snapshot !== null && snapshotKey(row) === snapshot && rank !== undefined && matchesGridPoint(point, row.point)) usable.push({ pointId: point.id, distanceKm: point.distanceKm, ring: point.ring, rank });
  }
  const times = [...latest.values()].map(row => row.observedAt).sort();
  return {
    grid, gridSpec: spec, geometrySource: newest?.gridSpec ? 'captured' : spec ? 'current_verified_coordinates' : 'unavailable',
    gridRunId: newest?.gridRunId ?? null, runIdentityVerified: Boolean(newest?.gridRunId),
    observedFrom: times[0] ?? null, observedTo: times.at(-1) ?? null, plannedPoints: grid.length, attemptedPoints: latest.size, qualifiedPoints: usable.length,
    metrics: computeGridMetrics(grid, usable), heatMap: heatMapRows(grid, usable),
    cells: grid.map(point => {
      const row = latest.get(point.id), qualified = usable.find(item => item.pointId === point.id);
      return { id: point.id, row: point.row, col: point.col, latitude: point.latitude, longitude: point.longitude, distanceKm: point.distanceKm,
        rank: qualified?.rank ?? null, observed: Boolean(qualified), eligible: Boolean(qualified), attempted: Boolean(row),
        observationId: row?.observationId ?? null, status: row?.rank.status ?? null, observedAt: row?.observedAt ?? null,
        point: row?.point ?? null, locationEvidence: row?.quality?.locationEvidence ?? null };
    }),
  };
}
export function discoverGridRuns(rows: RankObservation[], config: TrackingConfig, store: StoredStore) {
  const runs = new Map<string, RankObservation[]>();
  for (const row of rows) if (row.gridRunId) { const group = runs.get(row.gridRunId) ?? []; group.push(row); runs.set(row.gridRunId, group); }
  return [...runs].map(([gridRunId, group]) => {
    const grid = gridHistory(group, config, store, gridRunId), times = group.map(row => row.observedAt).sort();
    return { gridRunId, observedFrom: times[0]!, observedTo: times.at(-1)!, observations: group.length,
      attemptedPoints: new Set(group.map(row => row.pointId)).size, qualifiedPoints: grid.qualifiedPoints, gridSpec: group.find(row => row.gridSpec)?.gridSpec ?? null };
  }).sort((a, b) => b.observedTo.localeCompare(a.observedTo) || b.gridRunId.localeCompare(a.gridRunId));
}
