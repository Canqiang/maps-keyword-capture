import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { onlyPendingLowConfidence, parseScreenFrame, reconcileScreenFrames, type ScreenFrame, type ScreenOcr } from '../src/android/screen-reader.js';
import { analyzeScreen, inspectNativeResultList } from '../src/android/ui.js';

// Byte-for-byte probe 12 artifacts (run_20261022T074629Z_360bfb, source a24215d). See
// fixtures/android/repair-probe-20261021/provenance-candidate12-probe12.json.
const root = new URL('./fixtures/android/repair-probe-20261021/', import.meta.url);
const read = (stem: string, ext: string): string => readFileSync(new URL(`candidate12-${stem}.${ext}`, root), 'utf8');
function frame(query: string, index: number, keyword: string): ScreenFrame {
  const stem = `${query}-${String(index).padStart(2, '0')}`;
  return parseScreenFrame(JSON.parse(read(stem, 'ocr.json')) as ScreenOcr, keyword, `${query}:frame-${String(index).padStart(3, '0')}`, '2026-10-22', read(stem, 'xml'));
}

describe('candidate13: a rating line read at the bottom edge (probe 12 q0004 frames 25-26)', () => {
  const pair = () => { const f = [frame('q0004', 25, 'hot pot near me'), frame('q0004', 26, 'hot pot near me')]; f[0]!.topStateVerified = true; return f; };
  it('joins the edge reading by position and name and corrects its review count from the full reading', () => {
    const f = pair();
    expect(f[0]!.cards.at(-1)).toMatchObject({ name: 'Zhang Liang Spicy Hot Pot', reviewCount: 239 });
    expect(f[1]!.cards[0]).toMatchObject({ name: 'Zhang Liang Spicy Hot Pot', reviewCount: 339 });
    const result = reconcileScreenFrames(f, 20);
    expect(result).toMatchObject({ sequenceVerified: true, rankingReliable: true });
    expect(result.listings.map(row => [row.name, row.reviewCount, row.frameIds.length])).toEqual([['Mt. ShooTao Hot Pot 蜀 道 山 火锅', 1174, 1], ['Zhang Liang Spicy Hot Pot', 339, 2]]);
    expect(result.listings[1]?.warnings).toContain('edge_reading_corrected_by_full_reading');
  });
  it('does not join an edge reading to a different name', () => {
    const f = pair(); f[1]!.cards[0]!.name = 'Little Sheep Hot Pot';
    expect(reconcileScreenFrames(f, 20).listings.map(row => row.name)).toEqual(['Mt. ShooTao Hot Pot 蜀 道 山 火锅', 'Zhang Liang Spicy Hot Pot', 'Little Sheep Hot Pot']);
  });
});

describe('candidate13: one card above a photo module with a complete Directions / Share / Save row (probe 12 q0005 frame 2)', () => {
  it('is an exact-query result list', () => {
    const xml = read('q0005-02', 'xml');
    expect(analyzeScreen(xml, 'bakery').kind).toBe('results');
    expect(inspectNativeResultList(xml, 'bakery')?.resourceId).toBe('com.google.android.apps.maps:id/search_list_layout');
    expect(analyzeScreen(xml.replace('content-desc="Share"', 'content-desc="Promote"'), 'bakery').kind).not.toBe('results');
  });
});

describe('candidate13: a newest card whose name was not recognised (probe 12 q0001 frames 29-30)', () => {
  it('keeps the query going for further readings', () => {
    const f = [frame('q0001', 29, '卤味'), frame('q0001', 30, '卤味')]; f[0]!.topStateVerified = true;
    const result = reconcileScreenFrames(f, 20);
    expect(result.listings.at(-1)).toMatchObject({ name: null, resultType: 'unknown' });
    expect(result.listings.at(-1)?.warnings).toContain('name_not_recognized');
    expect(onlyPendingLowConfidence(result, f)).toBe(true);
  });
});
