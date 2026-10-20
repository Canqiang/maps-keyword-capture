/**
 * Observation grids for location-dependent rank tracking.
 *
 * A grid is an N×N square of points centred on a store, Local Falcon style: `radiusKm` is the
 * distance from the centre to the grid edge, so the point spacing is 2·radius/(N−1). Point IDs
 * encode row and column (`r-3c+2`), which keeps the same point comparable across days and surfaces.
 */
export interface GridCenter { latitude: number; longitude: number }
export interface GridSpec {
  center: GridCenter;
  /** Distance from the centre to the grid edge in kilometres. */
  radiusKm: number;
  /** Odd number of rows and columns, 3 to 15. */
  size: number;
}
export type GridRing = 'inner' | 'middle' | 'outer';
export interface GridPoint {
  id: string; row: number; col: number;
  latitude: number; longitude: number;
  /** Great-circle distance from the centre. */
  distanceKm: number;
  ring: GridRing;
}
export interface GridOptions {
  /** Ring boundaries in kilometres: distance ≤ first is inner, ≤ second is middle, otherwise outer. */
  ringKm?: [number, number];
}

const KM_PER_DEGREE_LAT = 111.32;
const EARTH_RADIUS_KM = 6371.0088;

export function validateGridSpec(spec: GridSpec): void {
  const { center, radiusKm, size } = spec;
  if (!Number.isFinite(center?.latitude) || Math.abs(center.latitude) > 85) throw new Error('grid center latitude must be between -85 and 85');
  if (!Number.isFinite(center.longitude) || Math.abs(center.longitude) > 180) throw new Error('grid center longitude must be between -180 and 180');
  if (!Number.isFinite(radiusKm) || radiusKm < 0.1 || radiusKm > 50) throw new Error('grid radiusKm must be between 0.1 and 50');
  if (!Number.isInteger(size) || size < 3 || size > 15 || size % 2 === 0) throw new Error('grid size must be an odd integer between 3 and 15');
}

export function pointSpacingKm(spec: GridSpec): number {
  validateGridSpec(spec);
  return (2 * spec.radiusKm) / (spec.size - 1);
}

export function pointId(row: number, col: number): string {
  const sign = (value: number): string => (value > 0 ? `+${value}` : String(value));
  return `r${sign(row)}c${sign(col)}`;
}

export function haversineKm(a: GridCenter, b: GridCenter): number {
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function ringFor(distanceKm: number, ringKm: [number, number] = [1, 3]): GridRing {
  if (!(ringKm[0] > 0 && ringKm[1] > ringKm[0])) throw new Error('ring boundaries must be increasing positive kilometres');
  return distanceKm <= ringKm[0] ? 'inner' : distanceKm <= ringKm[1] ? 'middle' : 'outer';
}

/** Generate the grid in reading order (north-west corner first, row by row); the centre is `r0c0`. */
export function generateGrid(spec: GridSpec, options: GridOptions = {}): GridPoint[] {
  validateGridSpec(spec);
  const spacing = pointSpacingKm(spec);
  const half = (spec.size - 1) / 2;
  const kmPerDegreeLng = KM_PER_DEGREE_LAT * Math.cos((spec.center.latitude * Math.PI) / 180);
  const points: GridPoint[] = [];
  // Rows run north to south so the output reads like the heat map; `row` is positive northwards.
  for (let row = half; row >= -half; row--) {
    for (let col = -half; col <= half; col++) {
      const latitude = round(spec.center.latitude + (row * spacing) / KM_PER_DEGREE_LAT);
      const longitude = round(spec.center.longitude + (col * spacing) / kmPerDegreeLng);
      const distanceKm = Math.round(haversineKm(spec.center, { latitude, longitude }) * 1000) / 1000;
      points.push({ id: pointId(row, col), row, col, latitude, longitude, distanceKm, ring: ringFor(distanceKm, options.ringKm) });
    }
  }
  return points;
}

function round(value: number): number { return Math.round(value * 1e7) / 1e7; }
