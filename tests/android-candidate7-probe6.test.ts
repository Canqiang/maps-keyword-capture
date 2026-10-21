import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { anchoredContinuity, hasMeasuredScreenProgress, parseScreenFrame, reconcileScreenFrames, type ScreenFrame, type ScreenOcr } from '../src/android/screen-reader.js';
import { analyzeScreen, inspectNativeResultList } from '../src/android/ui.js';

// Byte-for-byte probe 6 artifacts (run_20261021T040041Z_172916, source df3bab1, OCR scale 3,
// 720x1280). See fixtures/android/repair-probe-20261021/provenance-candidate6-probe6.json.
const root = new URL('./fixtures/android/repair-probe-20261021/', import.meta.url);
const read = (stem: string, ext: string): string => readFileSync(new URL(`candidate6-${stem}.${ext}`, root), 'utf8');
function frame(query: string, index: number, keyword: string): ScreenFrame {
  const stem = `${query}-${String(index).padStart(2, '0')}`;
  const ocr = JSON.parse(read(stem, 'ocr.json')) as ScreenOcr;
  return parseScreenFrame(ocr, keyword, `${query}:frame-${String(index).padStart(3, '0')}`, '2026-10-21', read(stem, 'xml'));
}

// q0002 frame 3 is itself a clipped header joined to frame 2, so its slice starts at frame 2.
describe.each([['q0001', '卤味', 'Er Hou Roast Chicken', 3], ['q0002', 'chinese food', 'Hwa Lung Kitchen', 2]])('candidate7: probe 6 photo-module transition (%s)', (query, keyword, name, first) => {
  const prefix = (): ScreenFrame[] => { const frames = first === 3 ? [] : [frame(query, 2, keyword)]; return frames; };
  it('measures continuity from the sheet lines and joins the name-clipped first card', () => {
    const f3 = frame(query, 3, keyword), f4 = frame(query, 4, keyword);
    const lead = prefix(); (lead[0] ?? f3).topStateVerified = true; // earlier frames were a verified prefix
    expect(f4.cards[0]).toMatchObject({ name: null, resultType: 'unknown' });
    const delta = anchoredContinuity(f3, f4);
    expect(delta).not.toBeNull(); expect(delta!).toBeLessThan(-50); expect(delta!).toBeGreaterThan(-200);
    expect(hasMeasuredScreenProgress(f3, f4)).toBe(true);
    const result = reconcileScreenFrames([...lead, f3, f4], 20);
    expect(result).toMatchObject({ sequenceVerified: true, rankingReliable: true, organicCount: 1, unknownCount: 0 });
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]).toMatchObject({ name, organicRank: 1 });
    expect(result.listings[0]?.frameIds.slice(-2)).toEqual([`${query}:frame-003`, `${query}:frame-004`]);
    expect(result.listings[0]?.warnings).toContain('clipped_prefix_verified_by_line_anchors');
  });
  it.each(['one-anchor', 'inconsistent-anchors', 'different-reviews', 'rating-line-moved', 'named-card', 'other-warning'])('refuses the join without the full anchored evidence: %s', variant => {
    const f3 = frame(query, 3, keyword), f4 = frame(query, 4, keyword); const lead = prefix(); (lead[0] ?? f3).topStateVerified = true;
    const card = f4.cards[0]!;
    const shared = f4.anchors!.filter(anchor => f3.anchors!.some(other => other.text === anchor.text));
    expect(shared.length).toBeGreaterThanOrEqual(2);
    if (variant === 'one-anchor') f4.anchors = [shared[0]!];
    if (variant === 'inconsistent-anchors') shared[0]!.bounds.top += 30;
    if (variant === 'different-reviews') card.reviewCount = (card.reviewCount ?? 0) + 1;
    if (variant === 'rating-line-moved') { card.ratingBounds!.top += 20; card.ratingBounds!.bottom += 20; }
    if (variant === 'named-card') { card.name = 'Somebody Else'; card.nameConfidence = 90; card.warnings = ['card_header_clipped']; }
    if (variant === 'other-warning') card.warnings.push('low_rating_confidence');
    const result = reconcileScreenFrames([...lead, f3, f4], 20);
    expect(result.rankingReliable).toBe(false);
    expect(result.listings).toHaveLength(2);
  });
  it('does not claim continuity across a pitch-sized jump or a different native list', () => {
    const f3 = frame(query, 3, keyword), f4 = frame(query, 4, keyword);
    for (const anchor of f4.anchors!) anchor.bounds.top -= 600;
    expect(anchoredContinuity(f3, f4)).toBeNull();
    const g4 = frame(query, 4, keyword); g4.nativeListBounds!.bottom -= 10;
    expect(anchoredContinuity(f3, g4)).toBeNull();
  });
});

describe('candidate7: probe 6 photo-discovery module beside merchant cards (q0005 bakery)', () => {
  const f6 = (): string => read('q0005-06', 'xml');
  it('accepts the scrolled exact-query list whose second child is the photo module', () => {
    expect(analyzeScreen(f6(), 'bakery')).toMatchObject({ kind: 'results', queryVisible: true });
    expect(inspectNativeResultList(f6(), 'bakery')).toMatchObject({ bounds: { left: 0, top: 274, right: 720, bottom: 1232 }, canScrollBackward: true, canScrollForward: true });
    expect(inspectNativeResultList(f6(), 'bakeries')).toBeNull();
    const parsed = frame('q0005', 6, 'bakery');
    expect(parsed).toMatchObject({ sheetBoundarySource: 'native_result_list', nativeListBounds: { top: 274, bottom: 1232 } });
    expect(parsed.cards.map(card => card.name)).toEqual(['Croissant et Cafe']);
  });
  it('still needs a complete merchant card and refuses a module that carries action controls', () => {
    expect(inspectNativeResultList(f6().replaceAll('content-desc="Directions"', 'content-desc="Unknown action"'), 'bakery')).toBeNull();
    const moduleWithActions = f6().replace(/<android\.widget\.ImageView[^>]*content-desc="Image result for bakery posted by Mano W"[^>]*>/u, tag =>
      tag.replace('content-desc="Image result for bakery posted by Mano W"', 'content-desc="Directions"').replace('clickable="false"', 'clickable="true"'));
    expect(moduleWithActions).not.toBe(f6());
    expect(inspectNativeResultList(moduleWithActions, 'bakery')).toBeNull();
    expect(inspectNativeResultList(f6().replaceAll(',ACTION_SCROLL_TO_POSITION', ''), 'bakery')).toBeNull();
  });
});
