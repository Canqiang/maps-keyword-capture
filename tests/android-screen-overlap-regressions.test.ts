import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasMeasuredScreenProgress, parseScreenFrame, reconcileScreenFrames, type ScreenOcr } from '../src/android/screen-reader.js';

const root = new URL('./fixtures/android/repair-probe-20261021/', import.meta.url);
function frames(query: number, keyword: string, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const stem = `q${String(query).padStart(4, '0')}-frame${String(i + 1).padStart(2, '0')}`;
    const ocr = JSON.parse(readFileSync(new URL(`${stem}.ocr.json`, root), 'utf8')) as ScreenOcr;
    const xml = readFileSync(new URL(`${stem}.xml`, root), 'utf8');
    return parseScreenFrame(ocr, keyword, stem, '2026-10-21', xml);
  });
}
describe('real native scrolling overlap and pending advertisement headers', () => {
  it('uses the intact following merchant and matching vertical movement to retain a clipped ad occurrence', () => {
    const observed = frames(2, 'chinese food', 4);
    expect(observed[3]?.cards[0]).toMatchObject({ name: 'Yummy House Chinese', resultType: 'unknown' });
    const result = reconcileScreenFrames(observed, 20);
    expect(result).toMatchObject({ sequenceVerified: true, rankingReliable: true, adCount: 2, organicCount: 0 });
    expect(result.listings.map(row => row.name)).toEqual(['Yummy House Chinese', 'Wonder Bayside']);
  });
  it('retains a clipped first merchant only with the unchanged next full header and consistent movement', () => {
    const observed = frames(3, 'bubble tea near me', 4);
    expect(observed[3]?.cards[0]).toMatchObject({ name: null, resultType: 'unknown' });
    const result = reconcileScreenFrames(observed, 20);
    expect(result).toMatchObject({ sequenceVerified: true, rankingReliable: true, organicCount: 2 });
    expect(result.listings.map(row => [row.name, row.organicRank])).toEqual([['Only Bear Chicken & Boba', 1], ['Tea Magic', 2]]);
  });
  it.each(['no-anchor', 'wrong-rating', 'different-movement', 'unknown-native-context'])('does not repair clipping using weak metadata alone: %s', variant => {
    const observed = frames(3, 'bubble tea near me', 4), last = observed.at(-1)!;
    if (variant === 'no-anchor') last.cards.pop();
    if (variant === 'wrong-rating') last.cards[0]!.rating = 3;
    if (variant === 'different-movement') { last.cards[0]!.ratingBounds!.top += 50; last.cards[0]!.ratingBounds!.bottom += 50; }
    if (variant === 'unknown-native-context') last.sheetBoundarySource = null;
    expect(reconcileScreenFrames(observed, 20).rankingReliable).toBe(false);
  });
  it('does not use an uncertain following header to qualify a clipped overlap', () => {
    const observed = frames(3, 'bubble tea near me', 4);
    for (const frame of observed) for (const card of frame.cards) if (card.name === 'Tea Magic') {
      card.resultType = 'unknown'; card.warnings.push('low_rating_confidence');
    }
    const result = reconcileScreenFrames(observed, 20);
    // Candidate7 may still measure continuity from the sheet lines, but the uncertain header
    // keeps the ranking unreliable and never qualifies the ordered-overlap join itself.
    expect(result.rankingReliable).toBe(false);
    expect(result.listings.every(row => !row.warnings.includes('clipped_prefix_verified_by_ordered_overlap'))).toBe(true);
  });
  it('defers an ad header entering only the bottom edge without invalidating the preceding complete prefix', () => {
    const observed = frames(5, 'bakery', 2);
    const last = observed.at(-1)!;
    expect(last.warnings).toContain('native_trailing_ad_header_pending');
    expect(last.warnings).not.toContain('native_ad_evidence_unresolved');
    expect(last.endOfResults).toBe(false);
    expect(reconcileScreenFrames(observed, 20)).toMatchObject({ sequenceVerified: true, rankingReliable: true, adCount: 1 });
  });
  it('distinguishes measured scrolling from a fresh screenshot with unchanged card geometry', () => {
    const observed = frames(3, 'bubble tea near me', 4);
    expect(hasMeasuredScreenProgress(observed[2], observed[3]!)).toBe(true);
    const same = structuredClone(observed[2]!); same.imageSha256 = 'a'.repeat(64);
    expect(hasMeasuredScreenProgress(observed[2], same)).toBe(false);
    same.cards = []; expect(hasMeasuredScreenProgress(observed[2], same)).toBe(false);
  });
});
