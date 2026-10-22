import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectNativeAdvertisementMarkers, inspectNativeResultList } from './ui.js';

/**
 * Screen reader v4: full-screen OCR is the primary listing evidence.
 *
 * Each screenshot of the native result sheet is OCR'd as a whole. A result card is
 * recognized by its rating line ("4.6 ★ (9) · $10–20 · Chinese"), the name line
 * directly above it and the status line ("Closed · Opens 9:30 AM · 0.9 mi") below.
 * Frames are merged in capture order, so display positions follow the sheet.
 * Native UI XML is retained as auxiliary evidence only.
 */
export interface Rect { left: number; top: number; right: number; bottom: number }
export interface OcrWord { text: string; confidence: number; bounds: Rect }
export interface OcrLine { text: string; confidence: number; bounds: Rect; words?: OcrWord[] }
export interface ScreenOcr {
  schemaVersion: 'android-screen-ocr/v1'; imageSha256: string;
  imageWidth: number; imageHeight: number;
  engine: string; engineVersion: string; languages: string; scale: number;
  lines: OcrLine[];
}
export interface ScreenRecognizeRequest { png: Buffer; timeoutMs: number; languages: string; scale?: number; signal?: AbortSignal }
export type ScreenRecognizer = (request: ScreenRecognizeRequest) => Promise<ScreenOcr>;

export interface ScreenCard {
  cardIndex: number; frameId: string;
  name: string | null; nameConfidence: number | null;
  rating: number | null; reviewCount: number | null;
  priceText: string | null; category: string | null;
  distanceText: string | null; distanceMeters: number | null; openText: string | null;
  resultType: 'ad' | 'organic' | 'unknown'; adLabel: string | null;
  bounds: Rect; ratingLineText: string; warnings: string[];
  /** Raw OCR geometry retained for bounded cross-frame movement checks. */
  ratingBounds?: Rect;
  nameBounds?: Rect | null;
}
export interface ScreenFrame {
  frameId: string; capturedAt: string; imageSha256: string;
  queryVisible: boolean; sheetTop: number | null;
  topStateVerified: boolean; endOfResults: boolean;
  cards: ScreenCard[]; warnings: string[];
  /** Auxiliary native geometry can establish context, never a merchant identity. */
  sheetBoundarySource?: 'native_result_list' | 'ocr_header' | null;
  topStateSource?: 'native_scroll_actions' | 'ocr_relevance' | null;
  nativeListBounds?: Rect | null;
  /** Legible sheet lines (snippets, status, action rows, module titles) used only to measure
   * continuity between adjacent frames; never a merchant identity. */
  anchors?: Array<{ text: string; bounds: Rect }>;
  /** Captured right after a bounded backward correction: content may legitimately have moved down. */
  afterBackwardCorrection?: boolean;
}
export interface RankedListing {
  displayPosition: number; organicRank: number | null;
  name: string | null; nameConfidence: number | null;
  rating: number | null; reviewCount: number | null;
  priceText: string | null; category: string | null;
  distanceText: string | null; distanceMeters: number | null; openText: string | null;
  resultType: ScreenCard['resultType']; adLabel: string | null;
  frameIds: string[]; warnings: string[];
}
export interface ScreenReconciliation {
  listings: RankedListing[];
  adCount: number; organicCount: number; unknownCount: number;
  /** False when an unknown or unnamed card precedes an organic listing. */
  rankingReliable: boolean;
  sequenceVerified: boolean;
  /** Observed occurrences excluded by maxDisplayedResults, even if their frame shows a terminal marker. */
  truncatedCount: number;
  warnings: string[];
}
export interface TargetMatch { displayPosition: number; organicRank: number | null; name: string; alias: string }

const CHROME_PREFIXES = ['relevance', 'open now', 'opennow', 'price', 'find a table', 'results', 'discover through photos', 'view photo map',
  'sponsored', 'directions', 'order', 'menu', 'call', 'website', 'reserve', 'save', 'share', 'more', 'update results', 'filters', 'about this ad',
  'visit site', 'search here', 'search google maps', 'all filters', 'rating', 'hours'];
const CHROME_WORDS = new Set(['directions', 'order', 'menu', 'call', 'website', 'reserve', 'save', 'share', 'visit', 'site', 'open', 'now', 'price',
  'relevance', 'results', 'filters', 'opennow', 'rating', 'hours', 'book', 'online', 'join', 'waitlist', 'table', 'find']);
// Receipt-verified Maps/Tesseract frames misread the star as 玄, 計 or 丙 (probe 5,
// q0004 frame 15). The slot between a leading 1.0–5.0 rating and its parenthesised
// count is only ever the star glyph, so accept at most one CJK glyph among the
// punctuation there; two or more CJK characters (3.9 公里 (1256)) remain prose.
const RATING = /^\s*([1-4](?:[.,]\d)?|5(?:[.,]0)?)\s*(?:[^\da-z一-鿿(]{0,4}|[^\da-z一-鿿(]{0,2}[一-鿿][^\da-z一-鿿(]{0,2})\s*\(\s*(\d[\d,.]*)\s*([km])?\s*\)/iu;
const NO_REVIEWS = /^\s*no reviews\b/iu;
const DISTANCE = /(\d+(?:[.,]\d+)?)\s*(mi|ft|km|m)\b/iu;
const OPEN_STATUS = /\b(temporarily closed|permanently closed|open 24 hours|closed|opens?|closes)\b/iu;
// Field separators are a middle dot, or punctuation surrounded by spaces; never the '.' in 0.5 or the '-' in $20-30.
const SEPARATOR = /\s*[·•]\s*|\s+[.\-–—|]+\s+/u;

export function normalizeText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}
/** Identity key: letters, digits and CJK only. Tolerates OCR spacing and punctuation noise. */
export function nameKey(text: string): string {
  return normalizeText(text).replace(/[^a-z0-9一-鿿]/gu, '');
}
function isChrome(text: string): boolean {
  const normalized = normalizeText(text).replace(/^[^a-z一-鿿]+/u, '');
  if (!normalized) return true;
  if (CHROME_PREFIXES.some(prefix => normalized.startsWith(prefix))) return true;
  // Only Latin words vote; a CJK-only line is never UI chrome.
  const words = normalized.split(' ').map(word => word.replace(/[^a-z]/gu, '')).filter(Boolean);
  if (!words.length) return !/[\u4e00-\u9fff]/u.test(normalized);
  const chrome = words.filter(word => CHROME_WORDS.has(word)).length;
  return chrome / words.length >= 0.6 && chrome >= 1;
}
function isSnippet(text: string): boolean {
  return /^[^a-z0-9一-鿿]*["“‘']/u.test(normalizeText(text)) || /["”]\s*$/u.test(text.trim());
}
function parseCount(value: string, suffix: string | undefined): number | null {
  const base = Number(value.replaceAll(',', ''));
  if (!Number.isFinite(base)) return null;
  const count = suffix ? Math.round(base * (suffix.toLowerCase() === 'k' ? 1000 : 1_000_000)) : base;
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}
function parseDistance(text: string): { distanceText: string; distanceMeters: number } | null {
  const match = DISTANCE.exec(text);
  if (!match) return null;
  const value = Number(match[1]!.replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  const unit = match[2]!.toLowerCase();
  const meters = unit === 'mi' ? value * 1609.344 : unit === 'ft' ? value * 0.3048 : unit === 'km' ? value * 1000 : value;
  return { distanceText: `${match[1]} ${unit}`, distanceMeters: Math.round(meters) };
}
function parsePrice(token: string): string | null {
  const cleaned = token.replace(/\s+/gu, '');
  if (/^\$+$/u.test(cleaned)) return cleaned;
  const range = /^[$s]?(\d{1,4})[-–]?[$s]?(\d{1,4})?\+?$/iu.exec(cleaned);
  if (range && (cleaned.startsWith('$') || /^s\d/iu.test(cleaned)) && range[2]) return `$${range[1]}–${range[2]}`;
  if (/^\$\d{1,4}\+$/u.test(cleaned)) return cleaned;
  return null;
}

/** Parse one OCR'd screenshot into the result cards visible inside the result sheet. */
export function parseScreenFrame(ocr: ScreenOcr, keyword: string, frameId: string, capturedAt: string, sourceXml?: string): ScreenFrame {
  const frame: ScreenFrame = { frameId, capturedAt, imageSha256: ocr.imageSha256, queryVisible: false, sheetTop: null, topStateVerified: false, endOfResults: false, cards: [], warnings: [] };
  const inspected = sourceXml === undefined ? null : inspectNativeResultList(sourceXml, keyword);
  // Caller pairs this source with the PNG before OCR. Reject geometry for another
  // image size; inspectNativeResultList also requires the exact native query and
  // a supported, settled list. Unknown/photo layouts receive no positive proof.
  const native = inspected && inspected.bounds.left >= 0 && inspected.bounds.top >= 0 &&
    inspected.bounds.right <= ocr.imageWidth && inspected.bounds.bottom <= ocr.imageHeight ? inspected : null;
  const lines = [...ocr.lines].sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left);
  const query = normalizeText(keyword);
  // The result sheet starts at its own copy of the query. Map labels above it are never results.
  const headers = lines.filter(line => {
    const text = normalizeText(line.text).replace(/[^a-z0-9一-鿿 ]/gu, '').trim();
    return line.confidence >= 40 && text.startsWith(query.replace(/[^a-z0-9一-鿿 ]/gu, '').trim()) && text.length <= query.length + 4;
  });
  const header = headers.at(-1);
  if (native) { frame.queryVisible = true; frame.sheetTop = native.bounds.top; frame.sheetBoundarySource = 'native_result_list'; frame.nativeListBounds = { ...native.bounds }; }
  else if (header) { frame.queryVisible = true; frame.sheetTop = header.bounds.bottom; frame.sheetBoundarySource = 'ocr_header'; }
  else frame.warnings.push('query_header_not_recognized: the result sheet header was not found by OCR; all lines were considered.');
  const sheet = lines.filter(line => (frame.sheetTop === null || line.bounds.top >= frame.sheetTop) &&
    (!native || (line.bounds.bottom <= native.bounds.bottom && line.bounds.right > native.bounds.left && line.bounds.left < native.bounds.right)));
  const kind = (line: OcrLine): 'rating' | 'no_reviews' | 'sponsored' | 'uncertain_ad' | 'chrome' | 'snippet' | 'text' => {
    if (RATING.test(normalizeText(line.text))) return 'rating';
    if (NO_REVIEWS.test(line.text)) return 'no_reviews';
    if (/^\W*sponsored\b/iu.test(normalizeText(line.text))) return line.confidence >= 40 ? 'sponsored' : 'uncertain_ad';
    if (/^spons/iu.test(nameKey(line.text).replaceAll('0', 'o'))) return 'uncertain_ad';
    if (isChrome(line.text)) return 'chrome';
    if (isSnippet(line.text)) return 'snippet';
    return 'text';
  };
  const kinds = sheet.map(kind);
  const cardHeaders: Array<{ name: Rect | null; rating: Rect }> = [];
  sheet.forEach((line, index) => {
    const lineKind = kinds[index]!;
    if (lineKind !== 'rating' && lineKind !== 'no_reviews') return;
    const normalized = normalizeText(line.text);
    const card: ScreenCard = { cardIndex: frame.cards.length, frameId, name: null, nameConfidence: null, rating: null, reviewCount: null, priceText: null, category: null,
      distanceText: null, distanceMeters: null, openText: null, resultType: 'unknown', adLabel: null, bounds: { ...line.bounds }, ratingBounds: { ...line.bounds }, ratingLineText: line.text, warnings: [] };
    let remainder = normalized;
    if (lineKind === 'rating') {
      const match = RATING.exec(normalized)!;
      card.rating = Number(match[1]!.replace(',', '.'));
      card.reviewCount = parseCount(match[2]!, match[3]);
      remainder = normalized.slice(match[0].length);
    } else { card.reviewCount = 0; remainder = normalized.replace(NO_REVIEWS, ''); }
    const tokens = remainder.split(SEPARATOR).map(token => token.trim()).filter(token => token && !/^[^a-z0-9一-鿿$]+$/u.test(token));
    for (const token of tokens) {
      const price = parsePrice(token);
      if (price && !card.priceText) { card.priceText = price; continue; }
      const distance = parseDistance(token);
      if (distance && !card.distanceText) { Object.assign(card, distance); continue; }
      if (/[a-z一-鿿]{3,}/u.test(token) && !card.category) card.category = token.replace(/^[^a-z一-鿿]+|[^a-z一-鿿]+$/gu, '');
    }
    // Name: the closest text line directly above the rating line, plus one wrapped line above it.
    let nameIndex = -1;
    let nameBounds: Rect | null = null;
    for (let i = index - 1; i >= 0; i--) {
      const candidate = sheet[i]!;
      if (line.bounds.top - candidate.bounds.bottom > 90) break;
      if (kinds[i] === 'text') { nameIndex = i; break; }
      if (kinds[i] !== 'snippet') break;
    }
    if (nameIndex >= 0) {
      const parts = [sheet[nameIndex]!];
      const above = sheet[nameIndex - 1];
      if (above && kinds[nameIndex - 1] === 'text' && parts[0]!.bounds.top - above.bounds.bottom <= 22) parts.unshift(above);
      card.name = parts.map(part => part.text.normalize('NFKC').replace(/\s+/gu, ' ').trim()).join(' ');
      nameBounds = { left: Math.min(...parts.map(part => part.bounds.left)), top: parts[0]!.bounds.top,
        right: Math.max(...parts.map(part => part.bounds.right)), bottom: parts.at(-1)!.bounds.bottom };
      card.nameBounds = nameBounds;
      card.nameConfidence = Math.round(parts.reduce((sum, part) => sum + part.confidence, 0) / parts.length * 100) / 100;
      card.bounds.top = parts[0]!.bounds.top;
      if (card.nameConfidence < 40) card.warnings.push('low_name_confidence');
      // An explicit Sponsored label sits a short distance above the name.
      for (let i = (parts[0] === above ? nameIndex - 2 : nameIndex - 1); i >= 0 && parts[0]!.bounds.top - sheet[i]!.bounds.bottom <= 160; i--) {
        if (kinds[i] === 'uncertain_ad') { card.warnings.push('uncertain_ad_label'); card.bounds.top = sheet[i]!.bounds.top; break; }
        if (kinds[i] === 'sponsored') { card.resultType = 'ad'; card.adLabel = sheet[i]!.text.trim(); card.bounds.top = sheet[i]!.bounds.top; break; }
        if (kinds[i] === 'rating' || kinds[i] === 'text') break;
      }
    } else card.warnings.push(index === 0 || line.bounds.top - (frame.sheetTop ?? 0) < 60 ? 'name_clipped_at_top' : 'name_not_recognized');
    // Status: the next line below the rating line, within one card header.
    const status = sheet[index + 1];
    // A line touching the native sheet edge can contain plausible but truncated
    // digits (a verified 3.3 mi was read as 22 mi). Keep its raw OCR, but do not
    // make that cropped text a field or a cross-frame identity conflict.
    const statusClipped = status && native && status.bounds.bottom >= native.bounds.bottom - 3;
    if (status && kinds[index + 1] !== 'rating' && status.bounds.top - line.bounds.bottom <= 80 && statusClipped) {
      card.warnings.push('status_line_clipped');
    }
    if (status && kinds[index + 1] !== 'rating' && status.bounds.top - line.bounds.bottom <= 80 && !statusClipped) {
      const text = normalizeText(status.text);
      const open = OPEN_STATUS.exec(text);
      if (open || DISTANCE.test(text)) {
        card.bounds.bottom = status.bounds.bottom;
        if (open) card.openText = text.slice(open.index).replace(DISTANCE, '').replace(/[\s·•.\-–—|]+$/u, '').trim() || null;
        const distance = parseDistance(text);
        if (distance && !card.distanceText) Object.assign(card, distance);
      }
    }
    if (line.confidence < 40) card.warnings.push('low_rating_confidence');
    if (!frame.queryVisible) card.warnings.push('sheet_header_unverified');
    if (card.name !== null && native?.canScrollBackward !== false && card.bounds.top - (frame.sheetTop ?? 0) < 35) card.warnings.push('card_header_clipped');
    // A legible positive Sponsored label is independent of list-top/query OCR.
    // Missing sheet context still prevents reliable ordering; it must not erase
    // a directly observed advertisement. Organic inference remains stricter.
    const uncertain = card.resultType === 'ad' ? ['uncertain_ad_label'] :
      ['low_name_confidence', 'low_rating_confidence', 'uncertain_ad_label', 'sheet_header_unverified', 'card_header_clipped'];
    if (card.warnings.some(warning => uncertain.includes(warning))) card.resultType = 'unknown';
    else if (card.resultType !== 'ad' && card.name !== null && (card.rating !== null || lineKind === 'no_reviews')) card.resultType = 'organic';
    frame.cards.push(card);
    cardHeaders.push({ name: nameBounds, rating: line.bounds });
  });
  if (sourceXml !== undefined) {
    const contains = (outer: Rect, inner: Rect): boolean => inner.left >= outer.left && inner.top >= outer.top && inner.right <= outer.right && inner.bottom <= outer.bottom;
    const markers = inspectNativeAdvertisementMarkers(sourceXml);
    const groups = new Map<number, typeof markers>();
    let unresolved = markers.some(marker => marker.ownerIndex === null);
    for (const marker of markers) {
      if (marker.ownerIndex === null) continue;
      const group = groups.get(marker.ownerIndex) ?? [];
      group.push(marker); groups.set(marker.ownerIndex, group);
    }
    const associations = [...groups.values()].map(group => ({ group, candidates: cardHeaders.flatMap((header, index) =>
      header.name && contains(group[0]!.cardBounds!, header.name) && contains(group[0]!.cardBounds!, header.rating) ? [index] : []) }));
    const ownerCounts = new Map<number, number>();
    for (const { candidates } of associations) for (const index of candidates) ownerCounts.set(index, (ownerCounts.get(index) ?? 0) + 1);
    for (const { group, candidates } of associations) {
      const owner = group[0]!.cardBounds!, list = group[0]!.listBounds!;
      const sameList = native && contains(native.bounds, list) && contains(list, native.bounds);
      // A next card may expose only its ad label at the bottom of this frame.
      // No later recognized row can receive rank across that pending header.
      // Keep capturing it, rather than invalidating the complete prefix above.
      const lastCard = frame.cards.at(-1);
      if (sameList && candidates.length === 0 && lastCard && owner.bottom === native.bounds.bottom && owner.top > lastCard.bounds.bottom &&
        group.some(marker => marker.kind === 'sponsored') && group.every(marker => marker.kind !== 'ambiguous' && marker.bounds && contains(owner, marker.bounds))) {
        frame.warnings.push('native_trailing_ad_header_pending');
        continue;
      }
      // The exact native result list establishes only this association's scope.
      // Require uniqueness in both directions: one complete OCR header in one
      // native owner. Duplicate/overlapping owners are not independent proof.
      const supported = sameList && candidates.length === 1 &&
        ownerCounts.get(candidates[0]!) === 1 &&
        group.every(marker => marker.kind !== 'ambiguous' && marker.bounds && contains(owner, marker.bounds));
      const index = candidates[0], header = index === undefined ? null : cardHeaders[index]!.name;
      const positive = supported && header ? group.find(marker => marker.kind === 'sponsored' && marker.bounds!.bottom <= header.top && header.top - marker.bounds!.bottom <= 160) : undefined;
      if (positive && index !== undefined) {
        const card = frame.cards[index]!;
        card.resultType = 'ad'; card.adLabel ??= positive.label;
        card.warnings.push('native_ad_label_confirmed');
      } else unresolved = true;
    }
    if (unresolved) {
      frame.warnings.push('native_ad_evidence_unresolved');
      for (const card of frame.cards) {
        if (card.resultType !== 'ad') card.resultType = 'unknown';
        card.warnings.push('native_ad_evidence_unresolved');
      }
    }
  }
  frame.anchors = sheet.filter(line => line.confidence >= 55 && normalizeText(line.text).length >= 10 && !/^[^a-z0-9一-鿿]*$/u.test(normalizeText(line.text)))
    .map(line => ({ text: normalizeText(line.text), bounds: { ...line.bounds } }));
  frame.topStateVerified = frame.queryVisible && sheet.some(line => line.confidence >= 40 && /\brelevance\b/iu.test(line.text) && line.bounds.bottom <= (frame.cards[0]?.bounds.top ?? Infinity));
  if (frame.topStateVerified) frame.topStateSource = 'ocr_relevance';
  if (native && native.canScrollBackward !== null) {
    frame.topStateVerified = native.canScrollBackward === false;
    frame.topStateSource = frame.topStateVerified ? 'native_scroll_actions' : null;
    if (!frame.topStateVerified) frame.warnings.push('native_list_top_contradicted');
  }
  frame.endOfResults = frame.queryVisible && sheet.some(line => line.confidence >= 60 && /^(?:you['’]ve reached the end of the list[.!]?|no more results[.!]?)$/iu.test(line.text.trim()) && line.bounds.top >= (frame.cards.at(-1)?.bounds.bottom ?? Infinity));
  if (frame.warnings.includes('native_trailing_ad_header_pending')) frame.endOfResults = false;
  if (!frame.cards.length) frame.warnings.push('no_cards_recognized');
  return frame;
}

function similarNames(a: string, b: string): boolean {
  const ka = nameKey(a), kb = nameKey(b);
  if (!ka || !kb) return false;
  if (ka === kb || ka.includes(kb) || kb.includes(ka)) return true;
  // Short CJK names (probe 8: 一回小店 vs 一间小店) share most characters when one is misread.
  const cjk = (text: string): string[] => [...text].filter(ch => /[一-鿿]/u.test(ch));
  const ca = cjk(ka), cb = cjk(kb);
  if (ca.length >= 3 && cb.length >= 3 && ca.length === cjk(ka).length && ka.length <= 8 && kb.length <= 8 && ca.length >= ka.length - 1 && cb.length >= kb.length - 1) {
    const sa = new Set(ca), sb = new Set(cb);
    let shared = 0; for (const ch of sa) if (sb.has(ch)) shared++;
    if (shared / (sa.size + sb.size - shared) >= 0.6) return true;
  }
  const bigrams = (text: string): Set<string> => { const out = new Set<string>(); for (let i = 0; i + 1 < text.length; i++) out.add(text.slice(i, i + 2)); return out; };
  const ba = bigrams(ka), bb = bigrams(kb);
  let shared = 0;
  for (const bigram of ba) if (bb.has(bigram)) shared++;
  const union = ba.size + bb.size - shared;
  return union > 0 && shared / union >= 0.5;
}
/**
 * Identity proven by geometry when the text is not (candidate10). At an anchored overlap position
 * the previous frame's card and this frame's card are the same occurrence when rating and review
 * count are present and equal, distances agree when both are visible, the rating line keeps its
 * horizontal span and moved by the anchored amount. Names may then disagree:
 * - probe 9 q0001 frame 19: a CJK name read below the confidence floor ('unknown');
 * - probe 10 q0005 frames 40-43: 'Maman' read as 'miamian', 'maman' and a low-confidence 'Maman',
 *   which became four rows. The row keeps the most confident reading.
 * Only name-confidence uncertainty may be present; a known ad/organic disagreement refuses.
 */
/** OCR names never contradict an identity proven by geometry (probe 11 q0003 frames 35-36: TIGER SUGAR
 * read confidently as 'CER >UCAR TI'), except at a header partly under the sheet edge, where a truncated
 * or extended reading of a different merchant is possible: there two confident names must have equal keys. */
function compatibleNames(a: ScreenCard, b: ScreenCard): boolean {
  if (a.name === null || b.name === null || (a.nameConfidence ?? 0) < 40 || (b.nameConfidence ?? 0) < 40) return true;
  return ![a, b].some(card => card.warnings.includes('card_header_clipped')) || nameKey(a.name) === nameKey(b.name);
}

function anchoredIdentity(a: ScreenCard, b: ScreenCard, delta: number | null): boolean {
  const onlyName = (card: ScreenCard): boolean => card.warnings.every(warning => warning === 'low_name_confidence');
  if (delta === null || !onlyName(a) || !onlyName(b) || (a.resultType !== 'unknown' && b.resultType !== 'unknown' && a.resultType !== b.resultType) ||
    a.name === null || b.name === null || Math.max(a.nameConfidence ?? 0, b.nameConfidence ?? 0) < 40 || !compatibleNames(a, b) ||
    a.rating === null || a.reviewCount === null || a.rating !== b.rating || a.reviewCount !== b.reviewCount ||
    (a.distanceText !== null && b.distanceText !== null && a.distanceText !== b.distanceText) ||
    !a.ratingBounds || !b.ratingBounds || Math.abs(b.ratingBounds.left - a.ratingBounds.left) > 4 || Math.abs(b.ratingBounds.right - a.ratingBounds.right) > 4) return false;
  return Math.abs((b.ratingBounds.top - a.ratingBounds.top) - delta) <= 12;
}

/** A query may continue while the only uncertainty is a card name read below the confidence floor
 * that is still visible in the newest frame and has been read in at most three frames: later frames
 * read it at other positions and can resolve it (anchoredIdentity / anchored geometry). */
export function onlyPendingLowConfidence(result: ScreenReconciliation, frames: ScreenFrame[]): boolean {
  const last = frames.at(-1);
  if (!last || result.rankingReliable || !result.sequenceVerified || frames[0]?.topStateVerified !== true ||
    frames.some(frame => frame.warnings.includes('native_ad_evidence_unresolved'))) return false;
  const uncertain = result.listings.filter(row => row.resultType === 'unknown' || row.name === null || (row.nameConfidence ?? 0) < 40 ||
    row.warnings.some(warning => ['low_rating_confidence', 'native_ad_evidence_unresolved', 'sequence_unverified'].includes(warning)));
  // Probe 12 (q0001 frame 30): the newest card's name was not recognised at all; it gets the same chances.
  const pending = ['low_name_confidence', 'name_not_recognized'];
  const benign = [...pending, 'joined_by_anchored_geometry', 'name_joined_by_line_anchors', 'name_clipped_at_top'];
  return uncertain.length > 0 && uncertain.every(row => row.frameIds.includes(last.frameId) && row.frameIds.length <= 3 &&
    row.warnings.some(warning => pending.includes(warning)) && row.warnings.every(warning => benign.includes(warning)));
}

/** Identity is considered only at a verified overlap position, never globally within a screenshot. */
function sameCard(a: ScreenCard, b: ScreenCard): boolean {
  if (a.resultType !== b.resultType) return false;
  if (a.name === null || b.name === null || (a.nameConfidence ?? 0) < 40 || (b.nameConfidence ?? 0) < 40) return false;
  if (a.rating !== b.rating || a.reviewCount !== b.reviewCount) return false;
  if (a.distanceText !== null && b.distanceText !== null && a.distanceText !== b.distanceText) return false;
  if (nameKey(a.name) === nameKey(b.name)) return true;
  // No missing metadata or shared generic name token establishes an occurrence identity.
  return a.distanceText !== null && a.distanceText === b.distanceText && similarNames(a.name, b.name);
}

/** A clipped prefix is not a new merchant if a full following header anchors
 * the same ordered overlap and both headers moved by the same measured amount.
 * Metadata alone, fuzzy names, missing native context or a jump cannot repair it.
 */
function clippedPrefixOverlap(previous: ScreenFrame, frame: ScreenFrame, count: number): boolean {
  const beforeList = previous.nativeListBounds, afterList = frame.nativeListBounds;
  // A single clipped card can only be joined when its own name is still legible and
  // identical (probe 5, q0002 frame 3: the header sat 34 px under the list top with
  // no following card on screen). Without a name, a following anchor is required.
  if (count < 1 || (count < 2 && frame.cards[0]?.name === null) || !beforeList || !afterList || previous.sheetBoundarySource !== 'native_result_list' || frame.sheetBoundarySource !== 'native_result_list' ||
    !previous.queryVisible || !frame.queryVisible || previous.warnings.includes('native_ad_evidence_unresolved') || frame.warnings.includes('native_ad_evidence_unresolved') ||
    beforeList.left !== afterList.left || beforeList.right !== afterList.right || beforeList.bottom !== afterList.bottom || Math.abs(beforeList.top - afterList.top) > 2) return false;
  const before = previous.cards.slice(-count), after = frame.cards.slice(0, count), a = before[0]!, b = after[0]!;
  if (b.resultType !== 'unknown' || !b.warnings.some(warning => ['name_clipped_at_top', 'card_header_clipped'].includes(warning)) ||
    b.warnings.some(warning => !['name_clipped_at_top', 'card_header_clipped'].includes(warning)) || b.bounds.top - afterList.top > 35 ||
    a.name === null || (a.nameConfidence ?? 0) < 40 || a.resultType === 'unknown' || a.warnings.includes('low_rating_confidence') ||
    (b.name !== null && ((b.nameConfidence ?? 0) < 40 || nameKey(a.name) !== nameKey(b.name))) ||
    a.rating === null || a.reviewCount === null || a.category === null ||
    a.rating !== b.rating || a.reviewCount !== b.reviewCount || a.distanceMeters !== b.distanceMeters || a.category !== b.category || !a.ratingBounds || !b.ratingBounds) return false;
  if (a.distanceMeters === null && normalizeText(a.ratingLineText) !== normalizeText(b.ratingLineText)) return false;
  const delta = b.ratingBounds.top - a.ratingBounds.top;
  const span = (afterList.bottom - afterList.top) * 0.5;
  if ((frame.afterBackwardCorrection ? Math.abs(delta) > span : delta >= -2 || delta < -span) || Math.abs(b.ratingBounds.left - a.ratingBounds.left) > 3 ||
    Math.abs(b.ratingBounds.right - a.ratingBounds.right) > 3) return false;
  return before.slice(1).every((anchor, i) => {
    const next = after[i + 1]!;
    return anchor.resultType !== 'unknown' && next.resultType !== 'unknown' &&
      ![anchor, next].some(card => card.warnings.some(warning => ['low_name_confidence', 'low_rating_confidence', 'card_header_clipped',
        'name_clipped_at_top', 'uncertain_ad_label', 'native_ad_evidence_unresolved'].includes(warning))) &&
      sameCard(anchor, next) && anchor.name !== null && next.name !== null && nameKey(anchor.name) === nameKey(next.name) &&
      !!anchor.ratingBounds && !!next.ratingBounds && Math.abs(next.ratingBounds.top - anchor.ratingBounds.top - delta) <= 12;
  });
}

/** OCR name drift (probe 5, q0001: `可 可 小 鹵 KEKE…` then `By AJ/)\\pq KEKE…`) must
 * not break an otherwise verified ordered overlap. The join is accepted only when
 * every aligned pair sits in the same native list (same left/right/bottom; the top
 * may change while the sheet expands), kept the same rating line geometry, moved
 * by one consistent non-positive amount relative to the list top, carries equal
 * rating, review count and result type, and has a similar name. Metadata without
 * geometry, or geometry without a similar name, never joins.
 */
function measuredDriftOverlap(previous: ScreenFrame, frame: ScreenFrame, count: number): boolean {
  const beforeList = previous.nativeListBounds, afterList = frame.nativeListBounds;
  if (count < 1 || !beforeList || !afterList || previous.sheetBoundarySource !== 'native_result_list' || frame.sheetBoundarySource !== 'native_result_list' ||
    !previous.queryVisible || !frame.queryVisible || previous.warnings.includes('native_ad_evidence_unresolved') || frame.warnings.includes('native_ad_evidence_unresolved') ||
    beforeList.left !== afterList.left || beforeList.right !== afterList.right || beforeList.bottom !== afterList.bottom) return false;
  const before = previous.cards.slice(-count), after = frame.cards.slice(0, count);
  const height = afterList.bottom - afterList.top;
  let delta: number | null = null;
  return before.every((a, i) => {
    const b = after[i]!;
    const unreliable = ['low_name_confidence', 'low_rating_confidence', 'card_header_clipped', 'name_clipped_at_top', 'uncertain_ad_label', 'native_ad_evidence_unresolved', 'sheet_header_unverified'];
    if (a.resultType === 'unknown' || a.resultType !== b.resultType || [a, b].some(card => card.warnings.some(warning => unreliable.includes(warning)))) return false;
    if (a.name === null || b.name === null || (a.nameConfidence ?? 0) < 40 || (b.nameConfidence ?? 0) < 40 || !similarNames(a.name, b.name)) return false;
    if (a.rating === null || a.reviewCount === null || a.rating !== b.rating || a.reviewCount !== b.reviewCount) return false;
    if (a.distanceText !== null && b.distanceText !== null && a.distanceText !== b.distanceText) return false;
    if (!a.ratingBounds || !b.ratingBounds || Math.abs(b.ratingBounds.left - a.ratingBounds.left) > 3 || Math.abs(b.ratingBounds.right - a.ratingBounds.right) > 3) return false;
    const moved = (b.ratingBounds.top - afterList.top) - (a.ratingBounds.top - beforeList.top);
    // Sub-pixel OCR box jitter (probe 5: +0.33 px) is not downward movement; after a backward
    // correction the content may sit lower than in the kept frame (probe 8).
    if (moved > (frame.afterBackwardCorrection ? height * 0.5 : 2) || moved < -height * 0.5) return false;
    if (delta === null) delta = moved;
    return Math.abs(moved - delta) <= 12;
  });
}

/** Continuity between adjacent frames measured from the sheet text itself (probe 6,
 * q0001/q0002 frames 3→4: the first card's name slid under the sheet header while the
 * photo-discovery module filled the rest of the viewport, so no card header was shared).
 * Two or more identical legible lines at the same left/right that all moved by one
 * non-positive amount within half the list height prove that nothing between the two
 * viewports was skipped. Returns that movement, or null. A pitch-sized jump that could
 * align one card's repeated chrome with the next card's is excluded by the bound.
 */
/**
 * Largest upward movement (share of the native list height) that line anchors may bridge. Probe 9
 * (q0002 frames 50 -> 52): a forward gesture flung almost a full list height, the backward correction
 * returned 45%, and the corrected frame sat 505 px (53% of 958 px) below the kept one, sharing two
 * unique lines. Any movement smaller than the list height leaves a common band, so nothing is skipped;
 * 70% keeps at least 30% of the list in common and still requires two unique, consistent anchors.
 */
const MAX_ANCHORED_ADVANCE = 0.7;

export function anchoredContinuity(previous: ScreenFrame | undefined, frame: ScreenFrame): number | null {
  const before = previous?.nativeListBounds, after = frame.nativeListBounds;
  if (!previous || !before || !after || previous.sheetBoundarySource !== 'native_result_list' || frame.sheetBoundarySource !== 'native_result_list' ||
    !previous.queryVisible || !frame.queryVisible || before.left !== after.left || before.right !== after.right || before.bottom !== after.bottom || Math.abs(before.top - after.top) > 2 ||
    !previous.anchors?.length || !frame.anchors?.length) return null;
  const height = after.bottom - after.top;
  const matches: number[] = [];
  const texts = new Set<string>();
  for (const a of previous.anchors) {
    const candidates = frame.anchors.filter(b => b.text === a.text && Math.abs(b.bounds.left - a.bounds.left) <= 4 && Math.abs(b.bounds.right - a.bounds.right) <= 4 &&
      b.bounds.top - a.bounds.top <= (frame.afterBackwardCorrection ? height * 0.5 : 2) && b.bounds.top - a.bounds.top >= -height * MAX_ANCHORED_ADVANCE);
    // A text that appears twice in either frame cannot anchor anything.
    if (candidates.length !== 1 || previous.anchors.filter(other => other.text === a.text).length !== 1 || texts.has(a.text)) continue;
    texts.add(a.text); matches.push(candidates[0]!.bounds.top - a.bounds.top);
  }
  if (matches.length < 2) return null;
  const delta = matches[0]!;
  // RecyclerView items re-measure independently by a few pixels (probe 8: 86 vs 90 px).
  return matches.every(moved => Math.abs(moved - delta) <= 12) ? delta : null;
}

/** With anchored continuity, a first card whose name is hidden under the sheet header is
 * the previous frame's last card when its rating line kept the same geometry and moved by
 * the anchored amount, and its rating, review count and visible distance agree. */
function anchoredClippedJoin(previous: ScreenFrame, row: RankedListing | undefined, frame: ScreenFrame, delta: number): boolean {
  // Identity comes from the row already verified for that card (it may itself have
  // been joined as a clipped header); geometry comes from the previous frame's card.
  const a = previous.cards.at(-1), b = frame.cards[0];
  if (!a || !b || !row || row.name === null || (row.nameConfidence ?? 0) < 40 || row.resultType === 'unknown' ||
    row.warnings.includes('low_rating_confidence') || a.warnings.includes('low_rating_confidence') || (b.name !== null && ((b.nameConfidence ?? 0) < 40 || nameKey(b.name) !== nameKey(row.name))) || b.resultType !== 'unknown' ||
    !b.warnings.some(warning => ['name_clipped_at_top', 'card_header_clipped'].includes(warning)) ||
    b.warnings.some(warning => !['name_clipped_at_top', 'card_header_clipped'].includes(warning)) ||
    a.rating === null || a.reviewCount === null || a.rating !== b.rating || a.reviewCount !== b.reviewCount ||
    (a.distanceText !== null && b.distanceText !== null && a.distanceText !== b.distanceText) || !a.ratingBounds || !b.ratingBounds ||
    Math.abs(b.ratingBounds.left - a.ratingBounds.left) > 4 || Math.abs(b.ratingBounds.right - a.ratingBounds.right) > 4) return false;
  return Math.abs((b.ratingBounds.top - a.ratingBounds.top) - delta) <= 12;
}

/** Progress is measured from a named card moving upward in the same native
 * viewport, not from a different PNG hash or an assumed successful gesture. */
export function hasMeasuredScreenProgress(previous: ScreenFrame | undefined, frame: ScreenFrame): boolean {
  const before = previous?.nativeListBounds, after = frame.nativeListBounds;
  if (!previous || !before || !after || previous.sheetBoundarySource !== 'native_result_list' || frame.sheetBoundarySource !== 'native_result_list' ||
    !previous.queryVisible || !frame.queryVisible || before.left !== after.left || before.right !== after.right || before.bottom !== after.bottom || Math.abs(before.top - after.top) > 2) return false;
  const anchored = anchoredContinuity(previous, frame);
  if (anchored !== null && anchored <= -2) return true;
  // Probe 10 (q0001 frames 4-7): inside the tall photo-discovery module only one OCR line
  // ("discover through photos") reads identically between frames, so the two-anchor rule
  // cannot see the steady upward movement and the query stalled. This check only feeds the
  // stall counter; ranking continuity still needs card overlap or two anchors. One unique
  // line of at least 16 characters, same horizontal span, moving up by less than 70% of the
  // list counts as progress.
  const height = after.bottom - after.top;
  if ((previous.anchors ?? []).some(a => a.text.length >= 16 && previous.anchors!.filter(o => o.text === a.text).length === 1 && (() => {
    const same = (frame.anchors ?? []).filter(b => b.text === a.text);
    return same.length === 1 && Math.abs(same[0]!.bounds.left - a.bounds.left) <= 4 && Math.abs(same[0]!.bounds.right - a.bounds.right) <= 4 &&
      same[0]!.bounds.top < a.bounds.top - 2 && same[0]!.bounds.top > a.bounds.top - height * MAX_ANCHORED_ADVANCE;
  })())) return true;
  return previous.cards.some(card => card.name !== null && card.ratingBounds && frame.cards.some(next =>
    next.name !== null && next.ratingBounds && sameCard(card, next) && nameKey(card.name!) === nameKey(next.name) &&
    next.ratingBounds.top < card.ratingBounds!.top - 2 && next.ratingBounds.top > card.ratingBounds!.top - (after.bottom - after.top) * 0.5 &&
    Math.abs(next.ratingBounds.left - card.ratingBounds!.left) <= 3 && Math.abs(next.ratingBounds.right - card.ratingBounds!.right) <= 3));
}

/** Keep each card occurrence; only a suffix/prefix overlap of adjacent frames can join it. */
export function reconcileScreenFrames(frames: ScreenFrame[], maxDisplayedResults: number): ScreenReconciliation {
  const listings: RankedListing[] = [];
  const warnings: string[] = [];
  let previous: ScreenFrame | undefined;
  let previousRows: RankedListing[] = [];
  // The last frame that showed cards, with its rows (probe 10 q0003: a frame whose only card name
  // was not recognised leaves no cards; the next frames still overlap the frame before it).
  let lastWithCards: { frame: ScreenFrame; rows: RankedListing[] } | undefined;
  let continuous = frames[0]?.topStateVerified === true;
  const match = (before: ScreenFrame, beforeRows: RankedListing[], frame: ScreenFrame) => {
    const out = { overlap: 0, clipped: false, drift: false, anchoredJoin: false, resolved: new Set<number>(), delta: anchoredContinuity(before, frame) };
    for (let count = Math.min(before.cards.length, frame.cards.length); count > 0; count--) {
      const pairs = frame.cards.slice(0, count).map((card, i) => [before.cards[before.cards.length - count + i]!, card] as const);
      if (pairs.every(([a, b]) => sameCard(a, b))) { out.overlap = count; return out; }
      if (pairs.every(([a, b]) => sameCard(a, b) || anchoredIdentity(a, b, out.delta))) {
        out.overlap = count; pairs.forEach(([a, b], i) => { if (!sameCard(a, b)) out.resolved.add(i); }); return out;
      }
      if (clippedPrefixOverlap(before, frame, count)) { out.overlap = count; out.clipped = true; return out; }
      if (measuredDriftOverlap(before, frame, count)) { out.overlap = count; out.drift = true; return out; }
    }
    if (out.delta !== null && anchoredClippedJoin(before, beforeRows.at(-1), frame, out.delta)) { out.overlap = 1; out.anchoredJoin = true; }
    return out;
  };
  if (frames.length && !continuous) warnings.push('list_top_unverified');
  for (const frame of frames) {
    if (frame.warnings.includes('native_ad_evidence_unresolved')) {
      continuous = false; warnings.push('native_ad_evidence_unresolved');
    }
    let overlap = 0;
    let clippedOverlap = false, driftOverlap = false, anchoredJoin = false, acrossEmpty = false;
    let resolved = new Set<number>();
    let joinRows = previousRows;
    const placed = new Map<number, RankedListing>();
    const edgeCorrected = new Set<number>();
    if (previous) {
      let m = match(previous, previousRows, frame);
      if (!m.overlap && m.delta === null && frame.cards.length && !previous.cards.length && lastWithCards) {
        const fallback = match(lastWithCards.frame, lastWithCards.rows, frame);
        if (fallback.overlap) { m = fallback; joinRows = lastWithCards.rows; acrossEmpty = true; }
      }
      ({ overlap, resolved } = m); clippedOverlap = m.clipped; driftOverlap = m.drift; anchoredJoin = m.anchoredJoin;
      if (!overlap && m.delta === null && frame.cards.length) { continuous = false; warnings.push(`ordered_overlap_missing: ${previous.frameId} -> ${frame.frameId}`); }
      // Candidate12 (probe 11 q0004 frames 20-21, q0001 23-24): with anchored movement known and no ordered
      // overlap, every card whose rating line was already inside the previous viewport must be a card of that
      // frame at the shifted position; it is never a new merchant. Only cards that were below it are new.
      if (!overlap && m.delta !== null) {
        const before = acrossEmpty ? lastWithCards!.frame : previous, list = before.nativeListBounds;
        const used = new Set<number>();
        frame.cards.forEach((card, i) => {
          if (!card.ratingBounds || !list) return;
          const expected = card.ratingBounds.top - m.delta!;
          if (expected > list.bottom - 40) {
            // Probe 12 (q0004 frames 25-26): a rating line at the very bottom edge of the previous frame was
            // read as 239 reviews, the full reading below shows 339. Such an edge reading identifies by
            // position and name only; the complete reading replaces its metadata.
            if (expected > list.bottom + 20 || card.name === null || (card.nameConfidence ?? 0) < 40) return;
            const edge = before.cards.findIndex((a, k) => !used.has(k) && !!a.ratingBounds && a.ratingBounds.top > list.bottom - 40 &&
              Math.abs(a.ratingBounds.top - expected) <= 12 && a.name !== null && (a.nameConfidence ?? 0) >= 40 &&
              (nameKey(a.name) === nameKey(card.name!) || similarNames(a.name, card.name!)));
            if (edge >= 0 && joinRows[edge]) { used.add(edge); placed.set(i, joinRows[edge]!); edgeCorrected.add(i); }
            return;
          }
          const geometric = ['low_name_confidence', 'name_clipped_at_top', 'card_header_clipped', 'status_line_clipped'];
          if (!card.warnings.every(warning => geometric.includes(warning))) { continuous = false; warnings.push(`anchored_card_unmatched: ${before.frameId} -> ${frame.frameId}`); return; }
          const at = before.cards.findIndex((a, k) => !used.has(k) && a.ratingBounds !== null && a.ratingBounds !== undefined &&
            a.warnings.every(warning => geometric.includes(warning)) && compatibleNames(a, card) &&
            Math.abs(a.ratingBounds.top - expected) <= 12 && Math.abs(a.ratingBounds.left - card.ratingBounds!.left) <= 4 &&
            a.rating !== null && a.reviewCount !== null && a.rating === card.rating && a.reviewCount === card.reviewCount &&
            !(a.distanceText !== null && card.distanceText !== null && a.distanceText !== card.distanceText) &&
            !(a.resultType !== 'unknown' && card.resultType !== 'unknown' && a.resultType !== card.resultType));
          if (at < 0 || joinRows[at] === undefined) { continuous = false; warnings.push(`anchored_card_unmatched: ${before.frameId} -> ${frame.frameId}`); return; }
          used.add(at); placed.set(i, joinRows[at]!);
        });
        // The converse: a previous card whose rating line now lies well inside this viewport must be here.
        const now = frame.nativeListBounds;
        if (now) before.cards.forEach((a, k) => {
          // An edge reading at the bottom of the previous frame is not evidence that a card must be here.
          if (used.has(k) || !a.ratingBounds || (list && a.ratingBounds.top > list.bottom - 40)) return;
          const shifted = a.ratingBounds.top + m.delta!;
          if (shifted >= now.top + 40 && shifted <= now.bottom - 40) { continuous = false; warnings.push(`anchored_card_missing: ${before.frameId} -> ${frame.frameId}`); }
        });
      }
    }
    const rows: RankedListing[] = [];
    for (let i = 0; i < frame.cards.length; i++) {
      const card = frame.cards[i]!;
      if (placed.has(i)) {
        const existing = placed.get(i)!;
        if (!existing.frameIds.includes(frame.frameId)) existing.frameIds.push(frame.frameId);
        if (existing.resultType === 'unknown' && card.resultType !== 'unknown' && card.name !== null && (card.nameConfidence ?? 0) >= 40) { existing.resultType = card.resultType; existing.adLabel = card.adLabel; }
        if (card.name !== null && (card.nameConfidence ?? 0) > (existing.nameConfidence ?? 0)) { existing.name = card.name; existing.nameConfidence = card.nameConfidence; }
        if ((existing.nameConfidence ?? 0) >= 40 && existing.name !== null && existing.resultType !== 'unknown') existing.warnings = existing.warnings.filter(warning => warning !== 'low_name_confidence');
        if (!existing.warnings.includes('joined_by_anchored_geometry')) existing.warnings.push('joined_by_anchored_geometry');
        if (edgeCorrected.has(i)) {
          existing.rating = card.rating; existing.reviewCount = card.reviewCount;
          if (card.distanceText !== null) { existing.distanceText = card.distanceText; existing.distanceMeters = card.distanceMeters; }
          if (!existing.warnings.includes('edge_reading_corrected_by_full_reading')) existing.warnings.push('edge_reading_corrected_by_full_reading');
        }
        rows.push(existing);
      } else if (i < overlap) {
        const existing = joinRows[joinRows.length - overlap + i]!;
        if (acrossEmpty && !existing.warnings.includes('overlap_verified_across_cardless_frame')) existing.warnings.push('overlap_verified_across_cardless_frame');
        if (!existing.frameIds.includes(frame.frameId)) existing.frameIds.push(frame.frameId);
        if (clippedOverlap && i === 0) existing.warnings.push('clipped_prefix_verified_by_ordered_overlap');
        if (driftOverlap && !existing.warnings.includes('name_drift_joined_by_measured_overlap')) existing.warnings.push('name_drift_joined_by_measured_overlap');
        if (anchoredJoin && !existing.warnings.includes('clipped_prefix_verified_by_line_anchors')) existing.warnings.push('clipped_prefix_verified_by_line_anchors');
        if (resolved.has(i)) {
          if (existing.resultType === 'unknown' && card.resultType !== 'unknown') { existing.resultType = card.resultType; existing.adLabel = card.adLabel; }
          if ((card.nameConfidence ?? 0) > (existing.nameConfidence ?? 0)) { existing.name = card.name; existing.nameConfidence = card.nameConfidence; }
          if ((existing.nameConfidence ?? 0) >= 40) existing.warnings = existing.warnings.filter(warning => warning !== 'low_name_confidence');
          if (!existing.warnings.includes('name_joined_by_line_anchors')) existing.warnings.push('name_joined_by_line_anchors');
        }
        if ((card.nameConfidence ?? 0) > (existing.nameConfidence ?? 0)) { existing.name = card.name; existing.nameConfidence = card.nameConfidence; }
        if (existing.warnings.includes('status_line_clipped') && !card.warnings.includes('status_line_clipped')) {
          if (existing.distanceText === null && card.distanceText !== null) {
            existing.distanceText = card.distanceText; existing.distanceMeters = card.distanceMeters;
          }
          if (existing.openText === null) existing.openText = card.openText;
        }
        rows.push(existing);
      } else {
        const row: RankedListing = { displayPosition: listings.length + 1, organicRank: null, name: card.name, nameConfidence: card.nameConfidence, rating: card.rating, reviewCount: card.reviewCount,
          priceText: card.priceText, category: card.category, distanceText: card.distanceText, distanceMeters: card.distanceMeters, openText: card.openText,
          resultType: card.resultType, adLabel: card.adLabel, frameIds: [frame.frameId], warnings: [...card.warnings, ...(!continuous ? ['sequence_unverified'] : [])] };
        listings.push(row); rows.push(row);
      }
    }
    // Empty photo-module frames do not prove a connection across the next swipe.
    previous = frame; previousRows = rows;
    if (frame.cards.length) lastWithCards = { frame, rows };
  }
  const trimmed = listings.slice(0, maxDisplayedResults);
  let organic = 0, rankingReliable = frames.length > 0 && frames[0]?.topStateVerified === true &&
    !frames.some(frame => frame.warnings.includes('native_ad_evidence_unresolved')) &&
    // A geometric contradiction (candidate12) leaves no new row to carry 'sequence_unverified'.
    !warnings.some(warning => warning.startsWith('anchored_card_unmatched') || warning.startsWith('anchored_card_missing'));
  for (const listing of trimmed) {
    if (listing.resultType === 'unknown' || listing.name === null || (listing.nameConfidence ?? 0) < 40 ||
      listing.warnings.includes('low_rating_confidence') || listing.warnings.includes('native_ad_evidence_unresolved') || listing.warnings.includes('sequence_unverified')) rankingReliable = false;
    if (listing.resultType === 'organic') { organic++; listing.organicRank = rankingReliable ? organic : null; }
  }
  if (trimmed.some(listing => listing.resultType === 'unknown')) warnings.push('unknown_cards_precede_organic_ranks');
  return { listings: trimmed, adCount: trimmed.filter(l => l.resultType === 'ad').length, organicCount: organic,
    unknownCount: trimmed.filter(l => l.resultType === 'unknown').length, rankingReliable, sequenceVerified: continuous, truncatedCount: listings.length - trimmed.length, warnings: [...new Set(warnings)] };
}

export function targetAliases(task: { storeName: string; aliases?: string[] }): string[] {
  const aliases = (task.aliases?.length ? task.aliases : [task.storeName]).map(alias => alias.trim()).filter(Boolean);
  return [...new Set(aliases)];
}
export function matchTarget(listings: RankedListing[], aliases: string[]): { match: TargetMatch | null; matches: TargetMatch[] } {
  const keys = aliases.map(alias => ({ alias, key: nameKey(alias) })).filter(entry => entry.key.length >= 3 || /^[一-鿿]{2}$/u.test(entry.key));
  const matches: TargetMatch[] = [];
  for (const listing of listings) {
    if (listing.name === null || (listing.nameConfidence ?? 0) < 40 || listing.resultType === 'unknown') continue;
    const key = nameKey(listing.name);
    const hit = keys.find(entry => key.includes(entry.key));
    if (hit) matches.push({ displayPosition: listing.displayPosition, organicRank: listing.organicRank, name: listing.name, alias: hit.alias });
  }
  return { match: matches.find(match => match.organicRank !== null) ?? matches[0] ?? null, matches };
}

/** Local bounded process: Tesseract over the whole screenshot; no shell, no remote OCR. */
export const recognizeScreen: ScreenRecognizer = request => new Promise((resolve, reject) => {
  const child = execFile('python3', [fileURLToPath(new URL('../../deploy/android/linux/screen_ocr.py', import.meta.url))], {
    timeout: request.timeoutMs, maxBuffer: 16 * 1024 * 1024, killSignal: 'SIGKILL', ...(request.signal ? { signal: request.signal } : {}),
  }, (error, stdout, stderr) => {
    if (error) { reject(new Error(`OCR process failed: ${error.message}; ${stderr.slice(0, 500)}`)); return; }
    try { resolve(JSON.parse(stdout) as ScreenOcr); } catch { reject(new Error('OCR process returned invalid JSON')); }
  });
  child.stdin?.on('error', error => reject(error));
  child.stdin?.end(JSON.stringify({ pngBase64: request.png.toString('base64'), timeoutMs: request.timeoutMs, languages: request.languages, scale: request.scale ?? 2 }));
});

export function validateScreenOcr(value: unknown): asserts value is ScreenOcr {
  const ocr = value as ScreenOcr;
  if (!ocr || typeof ocr !== 'object' || ocr.schemaVersion !== 'android-screen-ocr/v1' || !/^[a-f0-9]{64}$/u.test(ocr.imageSha256 ?? '')
    || !Number.isInteger(ocr.imageWidth) || !Number.isInteger(ocr.imageHeight) || !Array.isArray(ocr.lines)) throw new Error('Invalid screen OCR payload');
  for (const line of ocr.lines) {
    if (typeof line.text !== 'string' || !Number.isFinite(line.confidence) || line.confidence < 0 || line.confidence > 100 || !line.bounds
      || ![line.bounds.left, line.bounds.top, line.bounds.right, line.bounds.bottom].every(Number.isFinite)
      || line.bounds.right < line.bounds.left || line.bounds.bottom < line.bounds.top) throw new Error('Invalid screen OCR line');
  }
}
