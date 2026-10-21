import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseScreenFrame, reconcileScreenFrames, type ScreenFrame, type ScreenOcr } from '../src/android/screen-reader.js';
import { analyzeScreen, inspectNativeResultList } from '../src/android/ui.js';

// Byte-for-byte probe 5 artifacts (run_20261021T032723Z_c779a2, source af0bc7f, OCR scale 3,
// 720x1280). See fixtures/android/repair-probe-20261021/provenance-candidate5-probe5.json and
// evidence/2026-10-21/android-ranking-repair/candidate5-live-verification.json.
const root = new URL('./fixtures/android/repair-probe-20261021/', import.meta.url);
const read = (stem: string, ext: string): string => readFileSync(new URL(`candidate5-${stem}.${ext}`, root), 'utf8');
function frame(query: string, index: number, keyword: string): ScreenFrame {
  const stem = `${query}-${String(index).padStart(2, '0')}`;
  const ocr = JSON.parse(read(stem, 'ocr.json')) as ScreenOcr;
  return parseScreenFrame(ocr, keyword, `${query}:frame-${String(index).padStart(3, '0')}`, '2026-10-21', read(stem, 'xml'));
}

describe('candidate6: probe 5 star glyph (q0004 hot pot near me)', () => {
  it('reads the rating line whose star was OCR\'d as 丙 and keeps the ordered overlap f14 -> f15', () => {
    const f14 = frame('q0004', 14, 'hot pot near me'), f15 = frame('q0004', 15, 'hot pot near me');
    // Frames 1-13 of the probe were a verified prefix; this slice starts mid-list.
    f14.topStateVerified = true;
    expect(f15.cards.map(card => [card.name, card.rating, card.reviewCount, card.resultType])).toEqual([
      ['Mt. ShooTao Hot Pot 蜀 道 山 火 锅', 4.9, 1174, 'organic'],
      ['小 龙 坎 Shoo Loong Kan Hot Pot Jersey City', 4.7, 546, 'organic'],
    ]);
    const result = reconcileScreenFrames([f14, f15], 20);
    expect(result).toMatchObject({ sequenceVerified: true, rankingReliable: true, organicCount: 2, unknownCount: 0 });
    // The merged row keeps the higher-confidence f14 name (88.84 > 88.11).
    expect(result.listings.map(row => [row.name, row.organicRank, row.frameIds])).toEqual([
      ['Mt. ShooTao Hot Pot 蜀 道 山 火 锅 |', 1, ['q0004:frame-014', 'q0004:frame-015']],
      ['小 龙 坎 Shoo Loong Kan Hot Pot Jersey City', 2, ['q0004:frame-015']],
    ]);
  });
  it('still rejects letters, digits or prose in the star slot', () => {
    const base = JSON.parse(read('q0004-15', 'ocr.json')) as ScreenOcr;
    for (const text of ['4.9 ab (1174)', '4.9 12 (1174)', '4.9 很好吃的火锅店 (1174)', '4.9 公里 (1174)', '4.9 丙 1174']) {
      const ocr = { ...base, lines: base.lines.map(line => line.text.startsWith('4.9 丙') ? { ...line, text: text + line.text.slice('4.9 丙 (1174)'.length) } : line) };
      expect(parseScreenFrame(ocr, 'hot pot near me', 'q0004:frame-015', '2026-10-21', read('q0004-15', 'xml')).cards.map(card => card.name)).toEqual(['小 龙 坎 Shoo Loong Kan Hot Pot Jersey City']);
    }
  });
});

describe('candidate6: probe 5 one-card clipped prefix (q0002 chinese food)', () => {
  it('joins the single clipped header to the same merchant seen one gesture earlier', () => {
    const observed = [frame('q0002', 2, 'chinese food'), frame('q0002', 3, 'chinese food')];
    expect(observed[1]?.cards[0]).toMatchObject({ name: 'Hwa Lung Kitchen', resultType: 'unknown', warnings: ['card_header_clipped'] });
    const result = reconcileScreenFrames(observed, 20);
    expect(result).toMatchObject({ sequenceVerified: true, rankingReliable: true, organicCount: 1, unknownCount: 0 });
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]).toMatchObject({ name: 'Hwa Lung Kitchen', organicRank: 1, resultType: 'organic', frameIds: ['q0002:frame-002', 'q0002:frame-003'] });
    expect(result.listings[0]?.warnings).toContain('clipped_prefix_verified_by_ordered_overlap');
  });
  // Candidate7 measures continuity from the sheet lines as well, so the frames may still be
  // continuous; the card itself must nevertheless stay a separate, unreliable occurrence.
  it.each(['different-name', 'different-reviews', 'moved-down', 'other-warning'])('does not join a lone clipped header on weak evidence: %s', variant => {
    const observed = [frame('q0002', 2, 'chinese food'), frame('q0002', 3, 'chinese food')], card = observed[1]!.cards[0]!;
    if (variant === 'different-name') card.name = 'Hwa Lung Kitchen II';
    if (variant === 'different-reviews') card.reviewCount = 60;
    if (variant === 'moved-down') { card.ratingBounds!.top += 200; card.ratingBounds!.bottom += 200; }
    if (variant === 'other-warning') card.warnings.push('low_rating_confidence');
    const result = reconcileScreenFrames(observed, 20);
    expect(result.rankingReliable).toBe(false);
    expect(result.listings).toHaveLength(2);
    expect(result.listings[1]).toMatchObject({ resultType: 'unknown', organicRank: null });
  });
});

describe('candidate6: probe 5 OCR name drift (q0001 卤味)', () => {
  it('joins the drifted CJK name through measured geometry and keeps the better-confidence name', () => {
    const observed = [frame('q0001', 1, '卤味'), frame('q0001', 2, '卤味')];
    expect(observed[0]?.cards[0]).toMatchObject({ name: '可 可 小 鹵 KEKE BRAISED DELI', distanceText: '0 mi' });
    expect(observed[1]?.cards[0]).toMatchObject({ name: 'By AJ/)\\pq KEKE BRAISED DELI', distanceText: null });
    expect(observed.map(f => f.nativeListBounds?.top)).toEqual([456, 272]);
    const result = reconcileScreenFrames(observed, 20);
    expect(result).toMatchObject({ sequenceVerified: true, rankingReliable: true, organicCount: 1 });
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]).toMatchObject({ name: '可 可 小 鹵 KEKE BRAISED DELI', nameConfidence: 81.95, organicRank: 1, frameIds: ['q0001:frame-001', 'q0001:frame-002'] });
    expect(result.listings[0]?.warnings).toContain('name_drift_joined_by_measured_overlap');
  });
  it.each(['dissimilar-name', 'different-reviews', 'different-rating', 'moved-down', 'shifted-left', 'different-type', 'different-list', 'low-confidence'])('does not join drifted names without the full measured evidence: %s', variant => {
    const observed = [frame('q0001', 1, '卤味'), frame('q0001', 2, '卤味')], card = observed[1]!.cards[0]!;
    if (variant === 'dissimilar-name') card.name = 'Golden Dragon Palace';
    if (variant === 'different-reviews') card.reviewCount = 19;
    if (variant === 'different-rating') card.rating = 4.5;
    if (variant === 'moved-down') { card.ratingBounds!.top += 30; card.ratingBounds!.bottom += 30; }
    if (variant === 'shifted-left') { card.ratingBounds!.left -= 10; card.ratingBounds!.right -= 10; }
    if (variant === 'different-type') card.resultType = 'ad';
    if (variant === 'different-list') observed[1]!.nativeListBounds!.bottom -= 40;
    if (variant === 'low-confidence') card.nameConfidence = 39;
    const result = reconcileScreenFrames(observed, 20);
    expect(result.rankingReliable).toBe(false);
    expect(result.warnings).toContain('ordered_overlap_missing: q0001:frame-001 -> q0001:frame-002');
  });
});

describe('candidate6: probe 5 trailing photo-module head in the native list (q0005 bakery)', () => {
  const f6 = (): string => read('q0005-06', 'xml');
  const f7 = (): string => read('q0005-07', 'xml');
  it('accepts the scrolled list whose third direct child is the clipped, unlabeled module head', () => {
    for (const xml of [f6(), f7()]) {
      expect(analyzeScreen(xml, 'bakery')).toMatchObject({ kind: 'results', queryVisible: true });
      expect(inspectNativeResultList(xml, 'bakery')).toMatchObject({ bounds: { left: 0, top: 274, right: 720, bottom: 1232 }, canScrollBackward: true, canScrollForward: true });
    }
    expect(inspectNativeResultList(f7(), 'bakeries')).toBeNull();
  });
  it('still requires two distinct clickable native action controls inside a card', () => {
    expect(inspectNativeResultList(f7().replaceAll('content-desc="Directions"', 'content-desc="Unknown action"'), 'bakery')).toBeNull();
    expect(inspectNativeResultList(f7().replaceAll('content-desc="Call"', 'content-desc="Unknown"').replaceAll('content-desc="Website"', 'content-desc="Unknown"').replaceAll('content-desc="Save"', 'content-desc="Unknown"'), 'bakery')).toBeNull();
  });
  it('does not accept an action-less child between two cards', () => {
    // Move the module head off the list edge: its bottom no longer touches the list bottom.
    const moved = f7().replace('bounds="[0,1131][720,1232]"', 'bounds="[0,1131][720,1200]"');
    expect(moved).not.toBe(f7());
    expect(inspectNativeResultList(moved, 'bakery')).toBeNull();
  });
});
