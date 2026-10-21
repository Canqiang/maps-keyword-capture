import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseScreenFrame, reconcileScreenFrames, type ScreenOcr } from '../src/android/screen-reader.js';

const root = new URL('./fixtures/android/repair-probe-20261021/', import.meta.url);
const sample = (stem: string) => ({
  ocr: JSON.parse(readFileSync(new URL(`${stem}.ocr.json`, root), 'utf8')) as ScreenOcr,
  xml: readFileSync(new URL(`${stem}.xml`, root), 'utf8'),
});

describe('receipt-verified clipped Android status fields', () => {
  it('does not interpret the visibly cut-off distance as 22 miles', () => {
    const { ocr, xml } = sample('candidate3-clipped-status');
    const frame = parseScreenFrame(ocr, 'hot pot near me', 'before', 't', xml);
    const card = frame.cards.at(-1)!;
    expect(card.name).toContain('Mt. ShooTao');
    expect(card).toMatchObject({ rating: 4.9, reviewCount: 1174, distanceText: null, distanceMeters: null, openText: null, resultType: 'organic' });
    expect(card.warnings).toContain('status_line_clipped');
  });

  it('joins the exact same merchant when its distance becomes fully visible, retaining observed 3.3 mi', () => {
    const a = sample('candidate3-clipped-status'), b = sample('candidate3-full-status');
    const before = parseScreenFrame(a.ocr, 'hot pot near me', 'before', 't', a.xml);
    const after = parseScreenFrame(b.ocr, 'hot pot near me', 'after', 't', b.xml);
    // This pair starts halfway down a real list: it must never prove top-of-list ranking.
    const result = reconcileScreenFrames([before, after], 20);
    const matched = result.listings.filter(row => row.name?.includes('Mt. ShooTao'));
    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({ distanceText: '3.3 mi', frameIds: ['before', 'after'], organicRank: null });
    expect(result.warnings.some(w => w.startsWith('ordered_overlap_missing'))).toBe(false);
    expect(result.rankingReliable).toBe(false);
  });
});
