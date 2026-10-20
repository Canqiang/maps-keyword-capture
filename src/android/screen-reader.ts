import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
}
export interface ScreenFrame {
  frameId: string; capturedAt: string; imageSha256: string;
  queryVisible: boolean; sheetTop: number | null;
  topStateVerified: boolean; endOfResults: boolean;
  cards: ScreenCard[]; warnings: string[];
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
const RATING = /^\s*([1-5](?:[.,]\d)?)\s*[^\da-z一-鿿(]{0,4}\s*\(\s*(\d[\d,.]*)\s*([km])?\s*\)/iu;
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
export function parseScreenFrame(ocr: ScreenOcr, keyword: string, frameId: string, capturedAt: string): ScreenFrame {
  const frame: ScreenFrame = { frameId, capturedAt, imageSha256: ocr.imageSha256, queryVisible: false, sheetTop: null, topStateVerified: false, endOfResults: false, cards: [], warnings: [] };
  const lines = [...ocr.lines].sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left);
  const query = normalizeText(keyword);
  // The result sheet starts at its own copy of the query. Map labels above it are never results.
  const headers = lines.filter(line => {
    const text = normalizeText(line.text).replace(/[^a-z0-9一-鿿 ]/gu, '').trim();
    return line.confidence >= 40 && text.startsWith(query.replace(/[^a-z0-9一-鿿 ]/gu, '').trim()) && text.length <= query.length + 4;
  });
  const header = headers.at(-1);
  if (header) { frame.queryVisible = true; frame.sheetTop = header.bounds.bottom; }
  else frame.warnings.push('query_header_not_recognized: the result sheet header was not found by OCR; all lines were considered.');
  const sheet = lines.filter(line => frame.sheetTop === null || line.bounds.top >= frame.sheetTop);
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
  sheet.forEach((line, index) => {
    const lineKind = kinds[index]!;
    if (lineKind !== 'rating' && lineKind !== 'no_reviews') return;
    const normalized = normalizeText(line.text);
    const card: ScreenCard = { cardIndex: frame.cards.length, frameId, name: null, nameConfidence: null, rating: null, reviewCount: null, priceText: null, category: null,
      distanceText: null, distanceMeters: null, openText: null, resultType: 'unknown', adLabel: null, bounds: { ...line.bounds }, ratingLineText: line.text, warnings: [] };
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
    if (status && kinds[index + 1] !== 'rating' && status.bounds.top - line.bounds.bottom <= 80) {
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
    if (card.name !== null && card.bounds.top - (frame.sheetTop ?? 0) < 35) card.warnings.push('card_header_clipped');
    if (card.warnings.some(warning => ['low_name_confidence', 'low_rating_confidence', 'uncertain_ad_label', 'sheet_header_unverified', 'card_header_clipped'].includes(warning))) card.resultType = 'unknown';
    else if (card.resultType !== 'ad' && card.name !== null && (card.rating !== null || lineKind === 'no_reviews')) card.resultType = 'organic';
    frame.cards.push(card);
  });
  frame.topStateVerified = frame.queryVisible && sheet.some(line => line.confidence >= 40 && /\brelevance\b/iu.test(line.text) && line.bounds.bottom <= (frame.cards[0]?.bounds.top ?? Infinity));
  frame.endOfResults = frame.queryVisible && sheet.some(line => line.confidence >= 60 && /^(?:you['’]ve reached the end of the list[.!]?|no more results[.!]?)$/iu.test(line.text.trim()) && line.bounds.top >= (frame.cards.at(-1)?.bounds.bottom ?? Infinity));
  if (!frame.cards.length) frame.warnings.push('no_cards_recognized');
  return frame;
}

function similarNames(a: string, b: string): boolean {
  const ka = nameKey(a), kb = nameKey(b);
  if (!ka || !kb) return false;
  if (ka === kb || ka.includes(kb) || kb.includes(ka)) return true;
  const bigrams = (text: string): Set<string> => { const out = new Set<string>(); for (let i = 0; i + 1 < text.length; i++) out.add(text.slice(i, i + 2)); return out; };
  const ba = bigrams(ka), bb = bigrams(kb);
  let shared = 0;
  for (const bigram of ba) if (bb.has(bigram)) shared++;
  const union = ba.size + bb.size - shared;
  return union > 0 && shared / union >= 0.5;
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

/** Keep each card occurrence; only a suffix/prefix overlap of adjacent frames can join it. */
export function reconcileScreenFrames(frames: ScreenFrame[], maxDisplayedResults: number): ScreenReconciliation {
  const listings: RankedListing[] = [];
  const warnings: string[] = [];
  let previous: ScreenFrame | undefined;
  let previousRows: RankedListing[] = [];
  let continuous = frames[0]?.topStateVerified === true;
  if (frames.length && !continuous) warnings.push('list_top_unverified');
  for (const frame of frames) {
    let overlap = 0;
    if (previous) {
      for (let count = Math.min(previous.cards.length, frame.cards.length); count > 0; count--) {
        if (frame.cards.slice(0, count).every((card, i) => sameCard(previous!.cards[previous!.cards.length - count + i]!, card))) { overlap = count; break; }
      }
      if (!overlap && frame.cards.length) { continuous = false; warnings.push(`ordered_overlap_missing: ${previous.frameId} -> ${frame.frameId}`); }
    }
    const rows: RankedListing[] = [];
    for (let i = 0; i < frame.cards.length; i++) {
      const card = frame.cards[i]!;
      if (i < overlap) {
        const existing = previousRows[previousRows.length - overlap + i]!;
        if (!existing.frameIds.includes(frame.frameId)) existing.frameIds.push(frame.frameId);
        if ((card.nameConfidence ?? 0) > (existing.nameConfidence ?? 0)) { existing.name = card.name; existing.nameConfidence = card.nameConfidence; }
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
  }
  const trimmed = listings.slice(0, maxDisplayedResults);
  let organic = 0, rankingReliable = frames.length > 0 && frames[0]?.topStateVerified === true;
  for (const listing of trimmed) {
    if (listing.resultType === 'unknown' || listing.name === null || (listing.nameConfidence ?? 0) < 40 || listing.warnings.includes('sequence_unverified')) rankingReliable = false;
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
