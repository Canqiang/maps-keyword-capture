import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { anchoredContinuity, parseScreenFrame, reconcileScreenFrames, type ScreenFrame, type ScreenOcr } from '../src/android/screen-reader.js';

// Byte-for-byte probe 8 artifacts (run_20261021T073609Z_835f64, source 5111f09). See
// fixtures/android/repair-probe-20261021/provenance-candidate8-probe8.json.
const root = new URL('./fixtures/android/repair-probe-20261021/', import.meta.url);
const read = (stem: string, ext: string): string => readFileSync(new URL(`candidate8-${stem}.${ext}`, root), 'utf8');
function frame(query: string, index: number, keyword: string): ScreenFrame {
  const stem = `${query}-${String(index).padStart(2, '0')}`;
  return parseScreenFrame(JSON.parse(read(stem, 'ocr.json')) as ScreenOcr, keyword, `${query}:frame-${String(index).padStart(3, '0')}`, '2026-10-21', read(stem, 'xml'));
}

describe('candidate9: short CJK name misread by one character (probe 8 q0001 frames 21-22)', () => {
  it('joins 一回小店 / 一间小店 through the measured drift rule', () => {
    const f21 = frame('q0001', 21, '卤味'), f22 = frame('q0001', 22, '卤味'); f21.topStateVerified = true;
    expect(f21.cards.map(c => c.name)).toEqual(['Braised Canaan 迦 南 地 涉 味', '一 回 小 店']);
    expect(f22.cards.map(c => c.name)).toEqual(['一 间 小 店']);
    const result = reconcileScreenFrames([f21, f22], 20);
    expect(result).toMatchObject({ sequenceVerified: true, rankingReliable: true, organicCount: 2 });
    expect(result.listings.map(row => row.frameIds)).toEqual([['q0001:frame-021'], ['q0001:frame-021', 'q0001:frame-022']]);
  });
  it('does not treat two different short CJK names as the same card', () => {
    const f21 = frame('q0001', 21, '卤味'), f22 = frame('q0001', 22, '卤味'); f21.topStateVerified = true;
    f22.cards[0]!.name = '老 王 卤 味';
    expect(reconcileScreenFrames([f21, f22], 20).rankingReliable).toBe(false);
  });
});

describe('candidate9: frames captured after a backward correction (probe 8 q0001 frames 21 -> 23)', () => {
  it('accepts content that moved down relative to the kept frame', () => {
    const f21 = frame('q0001', 21, '卤味'), f23 = frame('q0001', 23, '卤味'); f21.topStateVerified = true;
    expect(anchoredContinuity(f21, f23)).toBeNull();
    f23.afterBackwardCorrection = true;
    const delta = anchoredContinuity(f21, f23);
    expect(delta).not.toBeNull(); expect(delta!).toBeGreaterThan(50); expect(delta!).toBeLessThan(200);
    const result = reconcileScreenFrames([f21, f23], 20);
    expect(result).toMatchObject({ sequenceVerified: true, rankingReliable: true, organicCount: 2 });
    expect(result.listings.map(row => [row.name?.replace('间', '回'), row.frameIds.length])).toEqual([['Braised Canaan 迦 南 地 涉 味', 2], ['一 回 小 店', 2]]);
  });
  it('still refuses a jump larger than half the list even after a correction', () => {
    const f21 = frame('q0001', 21, '卤味'), f23 = frame('q0001', 23, '卤味'); f21.topStateVerified = true; f23.afterBackwardCorrection = true;
    for (const a of f23.anchors!) a.bounds.top += 600;
    for (const c of f23.cards) { c.ratingBounds!.top += 600; c.ratingBounds!.bottom += 600; c.bounds.top += 600; }
    expect(anchoredContinuity(f21, f23)).toBeNull();
  });
});

describe('candidate9: clipped header with a legible identical name but no distance (probe 8 q0004 frames 22-23)', () => {
  it('joins through the anchored continuity and keeps the ranking reliable', () => {
    const f22 = frame('q0004', 22, 'hot pot near me'), f23 = frame('q0004', 23, 'hot pot near me'); f22.topStateVerified = true;
    expect(f23.cards[0]).toMatchObject({ name: '小 龙 坎 Shoo Loong Kan Hot Pot Jersey City', resultType: 'unknown', distanceText: '1.6 mi' });
    const result = reconcileScreenFrames([f22, f23], 20);
    expect(result).toMatchObject({ sequenceVerified: true, rankingReliable: true, organicCount: 2, unknownCount: 0 });
    expect(result.listings.map(row => [row.name, row.frameIds.length])).toEqual([['小 龙 坎 Shoo Loong Kan Hot Pot Jersey City', 2], ['Mt. ShooTao Hot Pot 蜀 道 山 火 锅', 2]]);
    expect(result.listings[0]?.warnings.some(w => ['clipped_prefix_verified_by_line_anchors', 'clipped_prefix_verified_by_ordered_overlap'].includes(w))).toBe(true);
  });
  it('refuses the join when the legible name differs', () => {
    const f22 = frame('q0004', 22, 'hot pot near me'), f23 = frame('q0004', 23, 'hot pot near me'); f22.topStateVerified = true;
    f23.cards[0]!.name = 'Another Hot Pot';
    expect(reconcileScreenFrames([f22, f23], 20).rankingReliable).toBe(false);
  });
});
