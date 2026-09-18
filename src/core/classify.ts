import type { BoundingBox, ClassificationEvidence, ListingClassification, ObservedCard } from '../contracts.js';
import { occurrenceIdFor, sha256Hex } from '../ids.js';
import type { ClassifiedCard, ParsedCardFields, RawFeedChild } from './types.js';

export const LAYOUT_SIGNATURE = 'maps-feed-card/v2';
/** Frozen: every evidence record gets its own copy, so one card's array is never another's. */
export const LABEL_LOCATIONS = Object.freeze(['card_text', 'aria_label'] as const);

export function parsePlaceIdentity(href: string): { placeId: string | null; placeKey: string } {
  const hex = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(href);
  const chij = /!19s(ChIJ[\w-]+)/.exec(href);
  const placeId = hex?.[1] ?? chij?.[1] ?? null;
  if (placeId) return { placeId, placeKey: placeId };
  let pathname = href;
  try { pathname = new URL(href, 'https://www.google.com').pathname; } catch { /* keep raw href */ }
  return { placeId: null, placeKey: pathname };
}

/** Accepts both live label shapes: "4.8 stars" and, when the card shows a count, "4.8 stars 97 Reviews". */
export function parseRating(label: string | null): number | null {
  if (!label) return null;
  const m = /^(\d(?:\.\d)?) stars?(?:\s+\d{1,3}(?:,\d{3})*\s+Reviews?)?$/.exec(label.trim());
  return m ? Number(m[1]) : null;
}

export function parseReviewCount(text: string): number | null {
  const m = /\((\d{1,3}(?:,\d{3})+|\d+)\)/.exec(text);
  if (!m?.[1]) return null;
  const digits = m[1].replace(/,/g, '');
  // Phone-number groups such as (516) are followed by a space and digits; require the group to be followed by a word, not more digits.
  const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 2);
  if (/^\s\d/.test(after)) return null;
  return Number(digits);
}

const STATUS_WORDS = /\b(Closed|Open|Opens|Closes|Temporarily closed|Permanently closed)\b/;
const PHONE_TAIL = /\s*\(?\d{3}\)?[\s-]\d{3}-\d{4}\b.*$/;
const RATING_PREFIX = /^\d(?:\.\d)?(\s*\(\d[\d,]*\))?$/;
// A category without an address is ambiguous with a locality description. Only
// these explicit business labels are supported after an exact No reviews row;
// unknown category-only layouts remain unknown until independently verified.
const NO_REVIEW_BUSINESS_CATEGORIES = new Set(['Bakery', 'Cafe', 'Coffee shop', 'Restaurant', 'Bubble tea store', 'Tea house']);

/** Remove icon-font glyphs (private-use characters) and collapse whitespace. */
export function cleanCardText(s: string): string {
  return s.replace(/[\ue000-\uf8ff]/g, '').replace(/\s+/g, ' ').trim();
}

function splitCategoryLine(line: string): { category: string | null; address: string | null } | null {
  if (!line.includes('·')) return null;
  const parts = line.split('·').map((p) => cleanCardText(p)).filter((p) => p.length > 0);
  const first = parts[0];
  if (!first || first === 'No reviews' || RATING_PREFIX.test(first) || STATUS_WORDS.test(first)) return null;
  const last = parts.length >= 2 ? parts[parts.length - 1] ?? null : null;
  return { category: first, address: last ? cleanCardText(last.replace(PHONE_TAIL, '')) || null : null };
}

/**
 * Category and address normally come from the card line "Category · address". A
 * supported no-review card may show only its category. When the page script
 * supplies the rendered lines, that line is found directly; otherwise the collapsed text is
 * parsed after stripping the repeated name, the Sponsored label, and the rating prefix.
 */
export function parseCategoryAndAddress(text: string, name: string, lines?: string[]): { category: string | null; address: string | null } {
  if (lines) {
    const cleaned = lines.map(cleanCardText);
    for (const line of cleaned) {
      const hit = splitCategoryLine(line);
      if (hit) return hit;
    }
    const noReviewsAt = cleaned.indexOf('No reviews');
    const category = noReviewsAt >= 0 ? cleaned[noReviewsAt + 1] : undefined;
    return { category: category && NO_REVIEW_BUSINESS_CATEGORIES.has(category) ? category : null, address: null };
  }
  let body = cleanCardText(text);
  const cleanName = cleanCardText(name);
  // Drop the repeated name prefix(es), the Sponsored label, and the rating/review prefix.
  while (cleanName && body.startsWith(cleanName)) body = body.slice(cleanName.length).trim();
  body = body.replace(/^Sponsored\s*/, '');
  while (cleanName && body.startsWith(cleanName)) body = body.slice(cleanName.length).trim();
  body = body.replace(/^\d(?:\.\d)?\s*(\(\d[\d,]*\))?\s*/, '');
  const noReviews = body.startsWith('No reviews ');
  if (noReviews) body = body.slice('No reviews '.length);
  const statusAt = body.search(STATUS_WORDS);
  const head = (statusAt >= 0 ? body.slice(0, statusAt) : body).trim();
  return splitCategoryLine(head) ?? { category: noReviews && NO_REVIEW_BUSINESS_CATEGORIES.has(head) ? head : null, address: null };
}

function withinPane(b: BoundingBox, pane: BoundingBox): boolean {
  return b.y >= pane.y - 0.5 && b.y + b.height <= pane.y + pane.height + 0.5 && b.height > 0;
}

export function isAd(card: ObservedCard): boolean {
  return card.classification.resultType === 'ad';
}

export function classifyCard(raw: RawFeedChild, paneBounds: BoundingBox, observationId: string): ClassifiedCard {
  const trimmed = raw.placeAriaLabel?.trim();
  const name = trimmed ? trimmed : null;
  const identity = raw.placeHref ? parsePlaceIdentity(raw.placeHref) : { placeId: null, placeKey: `feed-child:${raw.index}` };
  const sponsored = raw.sponsoredLabels.find((l) => l.text.trim() === 'Sponsored') ?? null;
  const rating = parseRating(raw.ratingAriaLabel);
  const parsedFields = name ? parseCategoryAndAddress(raw.text, name, raw.lines) : { category: null, address: null };
  // A recognized business card carries a rating or a supported category format. A bare
  // place card (a locality, a region) must not be ranked as an organic business result.
  const unresolvedAdMarker = !sponsored && (raw.sponsoredLabels.length > 0 ||
    (raw.lines ?? []).some((line) => /^(Sponsored|Ad|Advertisement)$/.test(cleanCardText(line)) && cleanCardText(line) !== name));
  const layoutRecognized = !unresolvedAdMarker && raw.placeHref !== null && name !== null && (rating !== null || parsedFields.category !== null);

  let classification: ListingClassification;
  let evidence: ClassificationEvidence;
  if (sponsored) {
    classification = { resultType: 'ad', adLabel: 'Sponsored', organicRank: null };
    evidence = { source: 'card_label', owner: `feed-child:${raw.index}`, labelText: sponsored.text.trim(), layoutSignature: LAYOUT_SIGNATURE, evaluatedLabelLocations: [...LABEL_LOCATIONS], observationIds: [observationId] };
  } else if (layoutRecognized) {
    classification = { resultType: 'organic', adLabel: null, organicRank: null };
    evidence = { source: 'supported_layout', owner: `feed-child:${raw.index}`, labelText: null, layoutSignature: LAYOUT_SIGNATURE, evaluatedLabelLocations: [...LABEL_LOCATIONS], observationIds: [observationId] };
  } else {
    classification = { resultType: 'unknown', adLabel: null, organicRank: null };
    evidence = { source: 'unresolved', owner: null, labelText: null, layoutSignature: null, evaluatedLabelLocations: [...LABEL_LOCATIONS], observationIds: [observationId] };
  }

  const isAdCard = classification.resultType === 'ad';
  const parsed: ParsedCardFields = {
    placeId: identity.placeId,
    rating,
    reviewCount: parseReviewCount(cleanCardText(raw.text)),
    category: parsedFields.category,
    address: parsedFields.address,
  };

  return {
    fingerprint: sha256Hex(`${identity.placeKey}|${isAdCard ? 'ad' : 'organic'}|${raw.index}`).slice(0, 24),
    feedChildIndex: raw.index,
    occurrenceId: occurrenceIdFor({ placeKey: identity.placeKey, isAd: isAdCard, feedChildIndex: raw.index }),
    businessKey: identity.placeId,
    name,
    mapsUrl: raw.placeHref,
    rawText: cleanCardText(raw.text),
    bounds: raw.bounds,
    fullyVisible: withinPane(raw.bounds, paneBounds),
    classification,
    classificationEvidence: evidence,
    parsed,
  };
}
