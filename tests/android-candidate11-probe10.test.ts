import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasMeasuredScreenProgress, parseScreenFrame, reconcileScreenFrames, type ScreenFrame, type ScreenOcr } from '../src/android/screen-reader.js';

// Byte-for-byte probe 10 artifacts (run_20261022T063939Z_3f8f10, source 2944c8d). See
// fixtures/android/repair-probe-20261021/provenance-candidate10-probe10.json.
const root = new URL('./fixtures/android/repair-probe-20261021/', import.meta.url);
const read = (stem: string, ext: string): string => readFileSync(new URL(`candidate10-${stem}.${ext}`, root), 'utf8');
function frame(query: string, index: number, keyword: string): ScreenFrame {
  const stem = `${query}-${String(index).padStart(2, '0')}`;
  return parseScreenFrame(JSON.parse(read(stem, 'ocr.json')) as ScreenOcr, keyword, `${query}:frame-${String(index).padStart(3, '0')}`, '2026-10-22', read(stem, 'xml'));
}

describe('candidate11: steady movement through the photo-discovery module (probe 10 q0001 frames 4-7)', () => {
  it('counts one long unique line moving up as progress so the query does not stall', () => {
    const f = [4, 5, 6, 7].map(n => frame('q0001', n, '卤味'));
    expect(f.slice(1).map(x => x.cards.length)).toEqual([0, 0, 0]);
    expect([0, 1, 2].map(i => hasMeasuredScreenProgress(f[i], f[i + 1]))).toEqual([true, true, true]);
  });
  it('does not count a line that stayed put or moved down', () => {
    const f5 = frame('q0001', 5, '卤味'), still = structuredClone(f5), down = structuredClone(f5);
    for (const a of down.anchors ?? []) { a.bounds.top += 40; a.bounds.bottom += 40; }
    expect(hasMeasuredScreenProgress(f5, still)).toBe(false);
    expect(hasMeasuredScreenProgress(f5, down)).toBe(false);
  });
});

describe('candidate11: one card read as Maman / miamian / maman / Maman (probe 10 q0005 frames 40-43)', () => {
  const frames = () => { const f = [40, 41, 42, 43].map(n => frame('q0005', n, 'bakery')); f[0]!.topStateVerified = true; return f; };
  it('keeps one row identified by rating, reviews, distance and the anchored movement', () => {
    const f = frames();
    expect(f.map(x => x.cards.map(c => c.name))).toEqual([['Delice Macarons', 'Maman'], ['miamian'], ['maman'], ['Maman', 'Mille-feuille Bakery Cafe']]);
    const result = reconcileScreenFrames(f, 20);
    expect(result).toMatchObject({ sequenceVerified: true, rankingReliable: true, organicCount: 3, unknownCount: 0 });
    expect(result.listings.map(row => [row.name, row.organicRank, row.frameIds.length])).toEqual([['Delice Macarons', 1, 1], ['maman', 2, 4], ['Mille-feuille Bakery Cafe', 3, 1]]);
    expect(result.listings[1]?.warnings).toEqual(['name_joined_by_line_anchors']);
  });
  it('refuses the join when the review count differs', () => {
    const f = frames(); f[1]!.cards[0]!.reviewCount = 986;
    const result = reconcileScreenFrames(f, 20);
    expect(result.listings.map(row => row.name)).toContain('miamian');
    expect(result.listings.length).toBeGreaterThan(3);
  });
});

describe('candidate11: a frame whose only card name was not recognised (probe 10 q0003 frames 41-44)', () => {
  it('joins the next frame to the last frame that showed cards', () => {
    const f = [41, 42, 43].map(n => frame('q0003', n, 'bubble tea near me')); f[0]!.topStateVerified = true;
    expect(f[1]!.cards).toEqual([]);
    const result = reconcileScreenFrames(f, 20);
    expect(result.warnings).toEqual([]);
    expect(result.listings.map(row => [row.name, row.frameIds])).toEqual([['Jericho Toke Food Court', ['q0003:frame-041']], ['Gong Cha', ['q0003:frame-041', 'q0003:frame-043']]]);
  });
  it('joins the corrected frame back without duplicating its cards', () => {
    const f = [41, 42, 44].map(n => frame('q0003', n, 'bubble tea near me')); f[0]!.topStateVerified = true; f[2]!.afterBackwardCorrection = true;
    const result = reconcileScreenFrames(f, 20);
    expect(result).toMatchObject({ sequenceVerified: true, rankingReliable: true, organicCount: 2 });
  });
  it('still reports a gap when the following cards do not overlap the last card frame', () => {
    const f = [41, 42, 43].map(n => frame('q0003', n, 'bubble tea near me')); f[0]!.topStateVerified = true;
    f[2]!.cards[0]!.name = 'Another Tea'; f[2]!.cards[0]!.reviewCount = 5;
    const result = reconcileScreenFrames(f, 20);
    expect(result.warnings).toContain('ordered_overlap_missing: q0003:frame-042 -> q0003:frame-043');
    expect(result.rankingReliable).toBe(false);
  });
});
