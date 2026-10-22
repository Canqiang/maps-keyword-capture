import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clippedNamesAgree, joinSplitRatingLines, onlyPendingLowConfidence, parseScreenFrame, reconcileScreenFrames, type OcrLine, type ScreenFrame, type ScreenOcr } from '../src/android/screen-reader.js';
import { analyzeScreen, inspectNativeResultList } from '../src/android/ui.js';

// Byte-for-byte artifacts of the first scheduled Android scan (run_20261022T095919Z_83d94f, image from
// 91d3ece) and probe 14 (run_20261022T084417Z_cba25e). See provenance-candidate15-scheduled1.json.
const root = new URL('./fixtures/android/repair-probe-20261021/', import.meta.url);
const read = (stem: string, ext: string): string => readFileSync(new URL(`candidate15-${stem}.${ext}`, root), 'utf8');
type Run = 'sched1' | 'sched2' | 'probe14';
function frame(run: Run, query: string, index: number, keyword: string): ScreenFrame {
  const stem = `${run}-${query}-${String(index).padStart(2, '0')}`;
  return parseScreenFrame(JSON.parse(read(stem, 'ocr.json')) as ScreenOcr, keyword, `${query}:frame-${String(index).padStart(3, '0')}`, '2026-10-22', read(stem, 'xml'));
}
function pair(run: Run, query: string, first: number, keyword: string): ScreenFrame[] {
  const f = [frame(run, query, first, keyword), frame(run, query, first + 1, keyword)];
  f[0]!.topStateVerified = true;
  return f;
}
const rows = (f: ScreenFrame[]) => reconcileScreenFrames(f, 20).listings.map(row => [row.name, row.frameIds.length]);
const line = (text: string, left: number, top: number, right: number, bottom = top + 30): OcrLine => ({ text, confidence: 80, bounds: { left, top, right, bottom } });

describe('candidate15: a rating number read as its own OCR line', () => {
  it('joins it with the review-count line on the same row (q0001 frame 49: "4.6" beside "(39) …")', () => {
    const f = pair('sched1', 'q0001', 49, 'bubble tea near me');
    expect(f[0]!.cards.map(card => [card.name, card.rating, card.reviewCount])).toEqual([['BR Station', 4.6, 39]]);
    const result = reconcileScreenFrames(f, 20);
    expect(result.warnings).toEqual([]);
    expect(rows(f)).toEqual([['BR Station', 2]]);
  });
  it('restores a dropped decimal point and refuses fragments off the row or far away', () => {
    expect(joinSplitRatingLines([line('45', 41, 869, 77), line('(319) - $10-20 - Fried Chicken', 113, 866, 545)]).map(l => l.text)).toEqual(['4.5 ★ (319) - $10-20 - Fried Chicken']);
    expect(joinSplitRatingLines([line('45', 41, 820, 77), line('(319) - Fried Chicken', 113, 866, 545)])).toHaveLength(2);
    expect(joinSplitRatingLines([line('45', 41, 869, 77), line('(319) - Fried Chicken', 300, 866, 545)])).toHaveLength(2);
    expect(joinSplitRatingLines([line('57', 41, 869, 77), line('(319) - Fried Chicken', 113, 866, 545)])).toHaveLength(2);
  });
  it('reads a star misread as a spaced "x" (q0018 frame 19: "5.0 x (1)")', () => {
    const f = pair('sched1', 'q0018', 18, 'matcha latte');
    expect(f[1]!.cards.map(card => [card.name, card.rating, card.reviewCount])).toContainEqual(['Aoko Matcha - Garden City', 5, 1]);
    expect(reconcileScreenFrames(f, 20).warnings).toEqual([]);
  });
});

describe('candidate15: geometric placement', () => {
  it('treats a confirmed native ad label as evidence, not uncertainty (q0005 frames 8-9)', () => {
    const f = pair('sched1', 'q0005', 8, 'boba shops near me');
    const result = reconcileScreenFrames(f, 20);
    expect(result.warnings).toEqual([]);
    expect(rows(f)).toEqual([['Kung Fu Tea Williston Park, New York', 2], ['Rose berry Bubble Tea & Cafe', 2]]);
    expect(result.listings[1]).toMatchObject({ resultType: 'ad' });
  });
  it('measures a rating line cut by the list top from its bottom edge (q0012 frames 5-6)', () => {
    const f = pair('sched1', 'q0012', 5, 'bubble tea');
    expect(reconcileScreenFrames(f, 20).warnings).toEqual([]);
    expect(rows(f)).toEqual([['Kyuramen - Garden City', 2]]);
    const moved = pair('sched1', 'q0012', 5, 'bubble tea'); moved[1]!.cards[0]!.ratingBounds!.bottom += 20;
    expect(reconcileScreenFrames(moved, 20).warnings.some(w => w.startsWith('anchored_card_unmatched'))).toBe(true);
  });
  it('joins two confident readings of a clipped header that share a long start and end (q0013 frames 24-25)', () => {
    const f = pair('sched1', 'q0013', 24, 'fried chicken near me');
    expect(f[1]!.cards[0]).toMatchObject({ name: "Kennedy's nck & Sandwiches", warnings: ['card_header_clipped'] });
    expect(reconcileScreenFrames(f, 20).warnings).toEqual([]);
    expect(rows(f)).toEqual([["Kennedy's Chicken & Sandwiches", 2], ['ATL Wing Spot', 1]]);
  });
  it('keeps refusing extensions, short overlaps and other merchants', () => {
    expect(clippedNamesAgree('kennedyschickensandwiches', 'kennedysncksandwiches')).toBe(true);
    expect(clippedNamesAgree('hwalungkitchen', 'hwalungkitchenii')).toBe(false);
    expect(clippedNamesAgree('goldentea', 'goldenbaketea')).toBe(false);
    expect(clippedNamesAgree('kingofbraised', 'masterofbraised')).toBe(false);
    // The names only have to be compatible: identity still needs the same rating, reviews and moved rating line.
    const f = pair('sched1', 'q0013', 24, 'fried chicken near me'); f[1]!.cards[0]!.reviewCount = 187;
    expect(reconcileScreenFrames(f, 20).rankingReliable).toBe(false);
  });
  it('lets 卤味 continue past the clipped header and the unnamed trailing card (probe 14 frames 35-36)', () => {
    const f = pair('probe14', 'q0001', 35, '卤味');
    const result = reconcileScreenFrames(f, 20);
    expect(result.warnings.filter(w => w.startsWith('anchored_card'))).toEqual([]);
    expect(result.listings.map(row => row.frameIds.length)).toEqual([2, 2]);
    expect(onlyPendingLowConfidence(result, f)).toBe(true);
  });
});

describe('candidate15: result lists continuing past the photo-discovery module', () => {
  it('accepts a trailing merchant without photos whose quote follows the address (q0003 frame 13)', () => {
    const xml = read('sched1-q0003-13', 'xml');
    expect(analyzeScreen(xml, 'bubble tea').kind).toBe('results');
    expect(inspectNativeResultList(xml, 'bubble tea')).toMatchObject({ canScrollBackward: true });
    const f = pair('sched1', 'q0003', 12, 'bubble tea');
    expect(reconcileScreenFrames(f, 20).warnings).toEqual([]);
  });
  it('accepts the "Wheelchair not accessible" icon and nothing else (q0015 frame 18)', () => {
    const xml = read('sched1-q0015-18', 'xml');
    expect(analyzeScreen(xml, 'fried chicken').kind).toBe('results');
    expect(analyzeScreen(xml.replace('Wheelchair not accessible', 'Wheelchair entrance unknown'), 'fried chicken').kind).not.toBe('results');
  });
});

describe('candidate15: held-out second batch and remaining ad evidence', () => {
  it('places a "No reviews" card by its exact confident name (batch 2 q0001 frames 36-37)', () => {
    const f = pair('sched2', 'q0001', 36, 'bubble tea');
    expect(f[1]!.cards[0]).toMatchObject({ name: 'Ugly Dumpling', rating: null, reviewCount: 0 });
    expect(reconcileScreenFrames(f, 20).warnings).toEqual([]);
    expect(rows(f)).toEqual([['Ugly Dumpling', 2]]);
    const renamed = pair('sched2', 'q0001', 36, 'bubble tea'); renamed[1]!.cards[0]!.name = 'Ugly Dumpling House';
    expect(reconcileScreenFrames(renamed, 20).rankingReliable).toBe(false);
  });
  it('keeps a frame whose next ad shows only a 2 px "About this ad" button (batch 2 q0003 frame 8)', () => {
    const f = pair('sched2', 'q0003', 7, 'boba shops near me');
    expect(f[1]!.warnings).toContain('native_trailing_ad_header_pending');
    expect(f[1]!.warnings).not.toContain('native_ad_evidence_unresolved');
    expect(reconcileScreenFrames(f, 20).warnings).toEqual([]);
  });
  it('assigns clipped Sponsored markers at the list top to the one nameless card below them (q0009 frame 3)', () => {
    const f = pair('sched1', 'q0009', 2, 'matcha latte');
    expect(f[1]!.cards[0]).toMatchObject({ name: null, resultType: 'ad', warnings: ['name_clipped_at_top', 'native_ad_label_confirmed'] });
    const result = reconcileScreenFrames(f, 20);
    expect(result.warnings).toEqual([]);
    expect(rows(f)).toEqual([['East Rock Coffee - Garden City', 2], ['Starbucks', 1]]);
  });
});
