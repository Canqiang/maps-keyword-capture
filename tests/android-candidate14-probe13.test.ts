import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { anchoredContinuity, cardPairContinuity, parseScreenFrame, reconcileScreenFrames, type ScreenFrame, type ScreenOcr } from '../src/android/screen-reader.js';
import { analyzeScreen, inspectNativeResultList } from '../src/android/ui.js';

// Byte-for-byte probe 13 artifacts (run_20261022T081138Z_3d1b4c, source 29d8ae7). See
// fixtures/android/repair-probe-20261021/provenance-candidate13-probe13.json.
const root = new URL('./fixtures/android/repair-probe-20261021/', import.meta.url);
const read = (stem: string, ext: string): string => readFileSync(new URL(`candidate13-${stem}.${ext}`, root), 'utf8');
function frame(query: string, index: number, keyword: string): ScreenFrame {
  const stem = `${query}-${String(index).padStart(2, '0')}`;
  return parseScreenFrame(JSON.parse(read(stem, 'ocr.json')) as ScreenOcr, keyword, `${query}:frame-${String(index).padStart(3, '0')}`, '2026-10-22', read(stem, 'xml'));
}

describe('candidate14: continuity from two cards when too few OCR lines repeat (probe 13 q0001 frames 23-24)', () => {
  const pair = () => { const f = [frame('q0001', 23, '卤味'), frame('q0001', 24, '卤味')]; f[0]!.topStateVerified = true; return f; };
  it('measures the movement from the two cards and places both, resolving the unreadable name', () => {
    const f = pair();
    expect(anchoredContinuity(f[0], f[1]!)).toBeNull();
    const delta = cardPairContinuity(f[0], f[1]!);
    expect(delta).not.toBeNull(); expect(Math.abs(delta! + 77)).toBeLessThanOrEqual(2);
    const result = reconcileScreenFrames(f, 20);
    expect(result.warnings).toEqual([]);
    expect(result).toMatchObject({ sequenceVerified: true, rankingReliable: true, unknownCount: 0 });
    expect(result.listings.map(row => [row.name, row.frameIds.length])).toEqual([['一 间 小 店', 2], ['浮 香 居 傳統 次 發', 2]]);
  });
  it('needs two consistent cards: one pair, or two pairs that moved differently, is not enough', () => {
    const one = pair(); one[1]!.cards[1]!.reviewCount = 56;
    expect(cardPairContinuity(one[0], one[1]!)).toBeNull();
    const split = pair(); split[1]!.cards[1]!.ratingBounds!.top += 40;
    expect(cardPairContinuity(split[0], split[1]!)).toBeNull();
    expect(reconcileScreenFrames(split, 20).rankingReliable).toBe(false);
  });
});

describe('candidate14: scrolled bakery card above the photo module with the squashed filter row (probe 13 q0005 frame 3)', () => {
  it('ignores only the 1 px filter residue and accepts the complete static action row', () => {
    const xml = read('q0005-03', 'xml');
    expect(analyzeScreen(xml, 'bakery').kind).toBe('results');
    expect(inspectNativeResultList(xml, 'bakery')).toMatchObject({ resourceId: 'com.google.android.apps.maps:id/search_list_layout', canScrollBackward: true });
  });
  it('rejects a residue carrying any other label', () => {
    const xml = read('q0005-03', 'xml');
    expect(analyzeScreen(xml.replace('content-desc="Top rated"', 'content-desc="Sponsored offer"'), 'bakery').kind).not.toBe('results');
  });
});
