import type { Listing } from '../contracts.js';
export interface OwnStoreSummary { status: 'observed' | 'not_observed' | 'identity_unresolved'; displayPositions: number[]; organicRanks: number[]; adDisplayPositions: number[]; observedScope: number }
/** The adapter may expose a hex feature ID as placeId; it is not a canonical Place ID. */
function canonicalPlaceId(listing: Listing): string | null {
  if (listing.placeId && /^ChIJ[\w-]+$/.test(listing.placeId)) return listing.placeId;
  if (!listing.mapsUrl) return null;
  const match = /!19s(ChIJ[\w-]+)/.exec(listing.mapsUrl);
  if (match) return match[1]!;
  try { const id = new URL(listing.mapsUrl).searchParams.get('query_place_id'); return id && /^ChIJ[\w-]+$/.test(id) ? id : null; } catch { return null; }
}
export function summarizeOwnStore(placeId: string, listings: Listing[]): OwnStoreSummary {
  const matched = listings.filter(l => canonicalPlaceId(l) === placeId);
  const resolved = listings.length > 0 && listings.every(l => canonicalPlaceId(l) !== null);
  return { status: matched.length ? 'observed' : resolved ? 'not_observed' : 'identity_unresolved', displayPositions: matched.map(l => l.displayPosition), organicRanks: matched.flatMap(l => l.organicRank === null ? [] : [l.organicRank]), adDisplayPositions: matched.filter(l => l.resultType === 'ad').map(l => l.displayPosition), observedScope: listings.length };
}
