import type { BoundingBox, ClassificationEvidence, ListingClassification, ObservedCard } from '../contracts.js';
import { occurrenceIdFor, sha256Hex } from '../ids.js';
import type { ClassifiedCard, ParsedCardFields, RawFeedChild } from './types.js';

export const LAYOUT_SIGNATURE = 'maps-feed-card/v1';
const LABEL_LOCATIONS = ['card_text', 'aria_label'];

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

export function parseCategoryAndAddress(text: string, name: string): { category: string | null; address: string | null } {
  let body = text;
  // Drop the repeated name prefix(es) and the rating/review prefix.
  while (name && body.startsWith(name)) body = body.slice(name.length).trim();
  body = body.replace(/^Sponsored\s*/, '');
  while (name && body.startsWith(name)) body = body.slice(name.length).trim();
  body = body.replace(/^\d(?:\.\d)?\s*(\(\d[\d,]*\))?\s*/, '');
  const statusAt = body.search(STATUS_WORDS);
  const head = (statusAt >= 0 ? body.slice(0, statusAt) : body).trim();
  if (!head.includes('·')) return { category: null, address: null };
  const parts = head.split('·').map((p) => p.trim()).filter((p) => p.length > 0);
  const category = parts[0] ?? null;
  const address = parts.length >= 2 ? parts[parts.length - 1] ?? null : null;
  return { category, address };
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
  const layoutRecognized = raw.placeHref !== null && name !== null && (rating !== null || raw.text.includes(name));

  let classification: ListingClassification;
  let evidence: ClassificationEvidence;
  if (sponsored) {
    classification = { resultType: 'ad', adLabel: 'Sponsored', organicRank: null };
    evidence = { source: 'card_label', owner: `feed-child:${raw.index}`, labelText: sponsored.text.trim(), layoutSignature: LAYOUT_SIGNATURE, evaluatedLabelLocations: LABEL_LOCATIONS, observationIds: [observationId] };
  } else if (layoutRecognized) {
    classification = { resultType: 'organic', adLabel: null, organicRank: null };
    evidence = { source: 'supported_layout', owner: `feed-child:${raw.index}`, labelText: null, layoutSignature: LAYOUT_SIGNATURE, evaluatedLabelLocations: LABEL_LOCATIONS, observationIds: [observationId] };
  } else {
    classification = { resultType: 'unknown', adLabel: null, organicRank: null };
    evidence = { source: 'unresolved', owner: null, labelText: null, layoutSignature: null, evaluatedLabelLocations: LABEL_LOCATIONS, observationIds: [observationId] };
  }

  const isAdCard = classification.resultType === 'ad';
  const parsedFields = name ? parseCategoryAndAddress(raw.text, name) : { category: null, address: null };
  const parsed: ParsedCardFields = {
    placeId: identity.placeId,
    rating,
    reviewCount: parseReviewCount(raw.text),
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
    rawText: raw.text,
    bounds: raw.bounds,
    fullyVisible: withinPane(raw.bounds, paneBounds),
    classification,
    classificationEvidence: evidence,
    parsed,
  };
}
