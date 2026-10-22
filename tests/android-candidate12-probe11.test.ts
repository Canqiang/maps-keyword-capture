import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { onlyPendingLowConfidence, parseScreenFrame, reconcileScreenFrames, type ScreenFrame, type ScreenOcr } from '../src/android/screen-reader.js';

// Byte-for-byte probe 11 artifacts (run_20261022T071047Z_e8834f, source ed7ee0d). See
// fixtures/android/repair-probe-20261021/provenance-candidate11-probe11.json.
const root = new URL('./fixtures/android/repair-probe-20261021/', import.meta.url);
const read = (stem: string, ext: string): string => readFileSync(new URL(`candidate11-${stem}.${ext}`, root), 'utf8');
function frame(query: string, index: number, keyword: string): ScreenFrame {
  const stem = `${query}-${String(index).padStart(2, '0')}`;
  return parseScreenFrame(JSON.parse(read(stem, 'ocr.json')) as ScreenOcr, keyword, `${query}:frame-${String(index).padStart(3, '0')}`, '2026-10-22', read(stem, 'xml'));
}

describe('candidate12: cards already visible in the previous frame are placed by the anchored movement (probe 11 q0004 frames 20-21)', () => {
  const pair = () => { const f = [frame('q0004', 20, 'hot pot near me'), frame('q0004', 21, 'hot pot near me')]; f[0]!.topStateVerified = true; return f; };
  it('joins the clipped KPOT card and Mt. ShooTao instead of appending a duplicate', () => {
    const f = pair();
    expect(f[1]!.cards.map(c => [c.name, c.resultType])).toEqual([[null, 'unknown'], ['Mt. ShooTao Hot Pot 蜀 道 山 火 锅', 'organic']]);
    const result = reconcileScreenFrames(f, 20);
    // Frame 20 is the first frame here, so its clipped KPOT header stays 'unknown'; in the run it joins the earlier KPOT row.
    expect(result.warnings.filter(w => w.startsWith('anchored_card_unmatched') || w.startsWith('ordered_overlap_missing'))).toEqual([]);
    expect(result.sequenceVerified).toBe(true);
    expect(result.listings.map(row => [row.name, row.frameIds.length])).toEqual([['KPOT Korean BBQ & Hot Pot', 2], ['Mt. ShooTao Hot Pot 蜀 道 山 火 锅', 2]]);
    expect(result.listings.every(row => row.warnings.includes('joined_by_anchored_geometry'))).toBe(true);
  });
  it('refuses to invent a new merchant where the previous frame showed a different card', () => {
    const f = pair(); f[1]!.cards[1]!.reviewCount = 1175;
    const result = reconcileScreenFrames(f, 20);
    expect(result.warnings).toContain('anchored_card_unmatched: q0004:frame-020 -> q0004:frame-021');
    expect(result.rankingReliable).toBe(false);
  });
});

describe('candidate12: an unreadable CJK name keeps the query going for up to three readings (probe 11 q0001 frames 23-24)', () => {
  it('places both cards, keeps the low-confidence row unresolved and lets the query continue', () => {
    const f = [frame('q0001', 23, '卤味'), frame('q0001', 24, '卤味')]; f[0]!.topStateVerified = true;
    const result = reconcileScreenFrames(f, 20);
    expect(result.listings.map(row => [row.name, row.resultType, row.frameIds.length])).toEqual([['一 间 小 店', 'organic', 2], ['SRE RRs', 'unknown', 2]]);
    expect(result.rankingReliable).toBe(false);
    expect(onlyPendingLowConfidence(result, f)).toBe(true);
  });
  it('stops once the unresolved card has been read in more than three frames', () => {
    const f = [frame('q0001', 23, '卤味'), frame('q0001', 24, '卤味')]; f[0]!.topStateVerified = true;
    const result = reconcileScreenFrames(f, 20);
    result.listings[1]!.frameIds.push('q0001:frame-025', 'q0001:frame-026');
    expect(onlyPendingLowConfidence(result, [...f, { ...f[1]!, frameId: 'q0001:frame-026' }])).toBe(false);
  });
});
