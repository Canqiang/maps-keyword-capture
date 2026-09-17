import { describe, expect, it } from 'vitest';
import { classifyCard } from '../src/core/classify.js';
import { assignRanks, toListing } from '../src/core/ranking.js';
import type { CommittedCard } from '../src/core/reconcile.js';
import type { RawFeedChild } from '../src/core/types.js';

const pane = { x: 72, y: 80, width: 408, height: 875 };
function committed(index: number, name: string, kind: 'ad' | 'organic' | 'unknown'): CommittedCard {
  const raw: RawFeedChild = {
    index, tag: 'DIV', heightPx: 200, bounds: { x: 72, y: 80 + index * 100, width: 408, height: 200 },
    placeHref: kind === 'unknown' ? null : `https://www.google.com/maps/place/${name}/data=!1s0x${index}:0x1`,
    placeAriaLabel: kind === 'unknown' ? null : name, ratingAriaLabel: kind === 'unknown' ? null : '4.0 stars',
    text: kind === 'unknown' ? '' : `${name} 4.0 (12) Cafe · 1 St Closed`,
    sponsoredLabels: kind === 'ad' ? [{ text: 'Sponsored', ownerAriaLabel: 'Sponsored', depth: 6 }] : [],
  };
  return { card: classifyCard(raw, pane, 'o1'), observationIds: ['o1'] };
}

describe('assignRanks', () => {
  it('counts ads in display position but not in organic rank', () => {
    const { ranked, classificationComplete } = assignRanks([
      committed(2, 'A', 'ad'), committed(4, 'B', 'organic'), committed(6, 'C', 'organic'), committed(8, 'D', 'ad'), committed(10, 'E', 'organic'),
    ]);
    expect(ranked.map((r) => [r.displayPosition, r.organicRank])).toEqual([[1, null], [2, 1], [3, 2], [4, null], [5, 3]]);
    expect(classificationComplete).toBe(true);
  });

  it('nulls organic ranks after the first unknown', () => {
    const { ranked, classificationComplete } = assignRanks([
      committed(2, 'A', 'organic'), committed(4, 'B', 'unknown'), committed(6, 'C', 'organic'), committed(8, 'D', 'organic'),
    ]);
    expect(ranked.map((r) => r.organicRank)).toEqual([1, null, null, null]);
    expect(ranked.map((r) => r.displayPosition)).toEqual([1, 2, 3, 4]);
    expect(classificationComplete).toBe(false);
  });

  it('builds listings with the classification variant matching the rank', () => {
    const { ranked } = assignRanks([committed(2, 'A', 'ad'), committed(4, 'B', 'organic')]);
    const ad = toListing(ranked[0]!, ['s1']);
    const organic = toListing(ranked[1]!, ['s1', 's2']);
    expect(ad).toMatchObject({ resultType: 'ad', adLabel: 'Sponsored', organicRank: null, displayPosition: 1, screenshotIds: ['s1'] });
    expect(organic).toMatchObject({ resultType: 'organic', adLabel: null, organicRank: 1, displayPosition: 2, name: 'B', rating: 4, reviewCount: 12, category: 'Cafe', address: '1 St' });
    expect(organic.observationIds).toEqual(['o1']);
  });
});
