import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { anchoredContinuity, onlyPendingLowConfidence, parseScreenFrame, reconcileScreenFrames, type ScreenFrame, type ScreenOcr } from '../src/android/screen-reader.js';
import { analyzeScreen, inspectNativeResultList, nativeLayoutSignature } from '../src/android/ui.js';

// Byte-for-byte probe 9 artifacts (run_20261021T080153Z_05bdb7, source b3f05cf). See
// fixtures/android/repair-probe-20261021/provenance-candidate9-probe9.json.
const root = new URL('./fixtures/android/repair-probe-20261021/', import.meta.url);
const read = (stem: string, ext: string): string => readFileSync(new URL(`candidate9-${stem}.${ext}`, root), 'utf8');
function frame(query: string, index: number, keyword: string): ScreenFrame {
  const stem = `${query}-${String(index).padStart(2, '0')}`;
  return parseScreenFrame(JSON.parse(read(stem, 'ocr.json')) as ScreenOcr, keyword, `${query}:frame-${String(index).padStart(3, '0')}`, '2026-10-21', read(stem, 'xml'));
}
const shift = (f: ScreenFrame, dy: number, frameId: string): ScreenFrame => {
  const g = structuredClone(f); g.frameId = frameId;
  for (const a of g.anchors ?? []) { a.bounds.top += dy; a.bounds.bottom += dy; }
  for (const c of g.cards) { c.bounds.top += dy; c.bounds.bottom += dy; if (c.ratingBounds) { c.ratingBounds.top += dy; c.ratingBounds.bottom += dy; } }
  return g;
};

describe('candidate10: a merchant photo finishing loading is not a source change (probe 9, all eight refusals)', () => {
  it('ignores empty leaf images and ordering attributes but still sees a real list movement', () => {
    expect(read('q0003-26', 'xml')).not.toBe(read('q0003-27', 'xml'));
    expect(nativeLayoutSignature(read('q0003-26', 'xml'))).toBe(nativeLayoutSignature(read('q0003-27', 'xml')));
    expect(nativeLayoutSignature(read('q0004-10', 'xml'))).not.toBe(nativeLayoutSignature(read('q0004-11', 'xml')));
  });
  it('keeps labelled images and text changes significant', () => {
    const xml = read('q0003-26', 'xml');
    const labelled = xml.replace('<android.widget.ImageView ', '<android.widget.ImageView content-desc="Sponsored" ');
    expect(nativeLayoutSignature(labelled)).not.toBe(nativeLayoutSignature(xml));
    const retexted = xml.replace(/text="([^"]{4,})"/u, 'text="$1 changed"');
    expect(nativeLayoutSignature(retexted)).not.toBe(nativeLayoutSignature(xml));
  });
});

describe('candidate10: corrected frame 53% of the list below the kept frame (probe 9 q0002 frames 50 -> 52)', () => {
  it('bridges the move through two unique consistent line anchors', () => {
    const f50 = frame('q0002', 50, 'chinese food'), f52 = frame('q0002', 52, 'chinese food');
    f50.topStateVerified = true; f52.afterBackwardCorrection = true;
    const delta = anchoredContinuity(f50, f52);
    expect(delta).not.toBeNull(); expect(delta!).toBeLessThan(-479); expect(delta!).toBeGreaterThan(-958 * 0.7);
    const result = reconcileScreenFrames([f50, f52], 20);
    expect(result.warnings).not.toContain('ordered_overlap_missing: q0002:frame-050 -> q0002:frame-052');
    expect(result).toMatchObject({ sequenceVerified: true, rankingReliable: true, organicCount: 2 });
    expect(result.listings.map(row => row.name)).toEqual(['Fortune Garden', 'Legend of Taste']);
  });
  it('still refuses a move beyond 70% of the list', () => {
    const f50 = frame('q0002', 50, 'chinese food'), f52 = shift(frame('q0002', 52, 'chinese food'), -250, 'q0002:frame-052');
    f50.topStateVerified = true; f52.afterBackwardCorrection = true;
    expect(anchoredContinuity(f50, f52)).toBeNull();
  });
});

describe('candidate10: CJK name read below the confidence floor (probe 9 q0001 frame 19)', () => {
  const kept = () => { const f = frame('q0001', 19, '卤味'); f.topStateVerified = true; return f; };
  // The next frame after a forward gesture: same content 380 px higher, the trailing card read legibly.
  const next = (mutate?: (card: ScreenFrame['cards'][number]) => void) => {
    const f = shift(kept(), -380, 'q0001:frame-020'); f.topStateVerified = false;
    f.cards = f.cards.filter(card => card.bounds.top >= (f.nativeListBounds?.top ?? 0));
    const card = f.cards.find(c => c.name?.startsWith('Braised Canaan'))!;
    Object.assign(card, { name: 'Braised Canaan 迦 南 地 滷 味', nameConfidence: 88, resultType: 'organic', warnings: [] });
    mutate?.(card);
    return f;
  };
  it('lets the query continue while the only uncertainty is the newest trailing card', () => {
    const f19 = kept();
    const result = reconcileScreenFrames([f19], 20);
    expect(result.rankingReliable).toBe(false);
    expect(result.listings.map(row => [row.name, row.resultType, row.warnings])).toEqual([['Er Hou Roast Chicken', 'organic', []], ['Braised Canaan WIR db ipglk', 'unknown', ['low_name_confidence']]]);
    expect(onlyPendingLowConfidence(result, [f19])).toBe(true);
  });
  it('resolves the card from the next legible reading at the anchored overlap', () => {
    const result = reconcileScreenFrames([kept(), next()], 20);
    expect(result).toMatchObject({ sequenceVerified: true, rankingReliable: true, unknownCount: 0 });
    expect(result.listings.at(-1)).toMatchObject({ name: 'Braised Canaan 迦 南 地 滷 味', resultType: 'organic', organicRank: 2 });
    expect(result.listings.at(-1)?.warnings).toEqual(['name_joined_by_line_anchors']);
  });
  it('refuses the resolution when the metadata or the movement disagrees, and stops once the card is no longer the newest', () => {
    expect(reconcileScreenFrames([kept(), next(card => { card.ratingBounds!.top += 40; })], 20).rankingReliable).toBe(false);
    const f19 = kept(), later = next(card => { card.reviewCount = 76; });
    const result = reconcileScreenFrames([f19, later], 20);
    expect(result.rankingReliable).toBe(false);
    expect(onlyPendingLowConfidence(result, [f19, later])).toBe(false);
  });
  it('treats a confident but different reading with identical metadata and movement as the same occurrence (candidate11)', () => {
    const result = reconcileScreenFrames([kept(), next(card => { card.name = 'Another Deli'; })], 20);
    expect(result).toMatchObject({ rankingReliable: true, organicCount: 2 });
    expect(result.listings.at(-1)).toMatchObject({ name: 'Another Deli', warnings: ['name_joined_by_line_anchors'] });
  });
});

describe('candidate10: complete Directions + Save action row (probe 9 q0005 frame 1)', () => {
  it('classifies the half sheet as an exact-query result list with a gesture-grade native list', () => {
    const xml = read('q0005-01', 'xml');
    expect(analyzeScreen(xml, 'bakery').kind).toBe('results');
    expect(inspectNativeResultList(xml, 'bakery')).toMatchObject({ resourceId: 'com.google.android.apps.maps:id/search_list_layout', canScrollBackward: false, canScrollForward: true });
    expect(frame('q0005', 1, 'bakery').cards.map(card => [card.name, card.resultType])).toEqual([['Croissant et Cafe', 'organic']]);
  });
  it('still rejects an unknown control or a row that does not lead with Directions', () => {
    const xml = read('q0005-01', 'xml');
    expect(analyzeScreen(xml.replace('content-desc="Save"', 'content-desc="Promote"'), 'bakery').kind).not.toBe('results');
    expect(analyzeScreen(xml.replace('content-desc="Directions"', 'content-desc="Save2"'), 'bakery').kind).not.toBe('results');
  });
});
