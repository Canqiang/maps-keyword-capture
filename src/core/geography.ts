import type { ExpectedArea, GeographicRelevance } from '../contracts.js';

type Coordinates = { latitude: number; longitude: number };
const GOOGLE_MAPS_HOSTS = new Set(['www.google.com', 'google.com', 'maps.google.com']);
const DECIMAL = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;

/** Only embedded place coordinates count; @lat,lng is a camera position, not a business. */
function placeCoordinates(raw: string | null | undefined): Coordinates | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !GOOGLE_MAPS_HOSTS.has(url.hostname) || !url.pathname.startsWith('/maps/place/')) return null;
    const rawData = /\/data=([^/]+)$/.exec(url.pathname)?.[1];
    if (!rawData) return null;
    const data = decodeURIComponent(rawData);
    const points = new Map<string, Coordinates>();
    for (const pair of data.matchAll(/!3d([^!/?&#]+)!4d([^!/?&#]+)/g)) {
      if (!DECIMAL.test(pair[1]!) || !DECIMAL.test(pair[2]!)) return null;
      const latitude = Number(pair[1]); const longitude = Number(pair[2]);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
      points.set(`${latitude},${longitude}`, { latitude, longitude });
    }
    // Nested directions/related-place payloads can contain several distinct places.
    return points.size === 1 ? points.values().next().value! : null;
  } catch { return null; }
}

function distanceKm(a: Coordinates, b: Coordinates): number {
  const radians = Math.PI / 180;
  const latA = a.latitude * radians; const latB = b.latitude * radians;
  const sinLat = Math.sin((latB - latA) / 2);
  const sinLng = Math.sin((b.longitude - a.longitude) * radians / 2);
  const haversine = sinLat ** 2 + Math.cos(latA) * Math.cos(latB) * sinLng ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
}

/** Passive observation only: this never changes the query, browser location, rank or outcome. */
export function assessGeographicRelevance(
  expectedArea: ExpectedArea | null | undefined,
  urls: readonly (string | null | undefined)[],
  scope: GeographicRelevance['scope'],
): GeographicRelevance {
  const result: GeographicRelevance = { status: 'unverified', expectedArea: expectedArea ?? null, scope, checkedCount: 0, insideCount: 0, outsideCount: 0, unknownCount: 0, reason: 'no_observations' };
  for (const url of urls) {
    const coordinates = placeCoordinates(url);
    if (!coordinates) { result.unknownCount++; continue; }
    result.checkedCount++;
    if (expectedArea) {
      if (distanceKm(expectedArea, coordinates) <= expectedArea.radiusKm) result.insideCount++;
      else result.outsideCount++;
    }
  }
  if (!expectedArea) result.reason = 'expected_area_not_configured';
  else if (!urls.length) result.reason = 'no_observations';
  else if (result.insideCount && result.outsideCount) {
    result.status = 'mixed'; result.reason = 'observed_places_mixed';
  } else if (result.unknownCount) result.reason = 'incomplete_coordinates';
  else if (result.insideCount) {
    result.status = 'matched'; result.reason = 'all_observed_places_inside';
  } else if (result.outsideCount) {
    result.status = 'outside'; result.reason = 'all_observed_places_outside';
  }
  return result;
}
