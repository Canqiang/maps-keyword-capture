import { describe, expect, it } from 'vitest';
import { classifyFeedChildren } from '../src/core/feed-model.js';
import type { RawFeedChild } from '../src/core/types.js';

function child(index: number, over: Partial<RawFeedChild> = {}): RawFeedChild {
  return {
    index, tag: 'DIV', heightPx: 210,
    bounds: { x: 72, y: 80 + index * 100, width: 408, height: 210 },
    placeHref: null, placeAriaLabel: null, ratingAriaLabel: null, text: '', sponsoredLabels: [],
    ...over,
  };
}
function card(index: number, name: string, extra: Partial<RawFeedChild> = {}): RawFeedChild {
  return child(index, {
    placeHref: `https://www.google.com/maps/place/${encodeURIComponent(name)}/data=!4m7!3m6!1s0x89c2:0x${index}`,
    placeAriaLabel: name, ratingAriaLabel: '4.8 stars', text: `${name} 4.8 (100) Cafe · 1 Main St Closed`, ...extra,
  });
}
function separator(index: number): RawFeedChild { return child(index, { heightPx: 1, text: '' }); }

const observed: RawFeedChild[] = [
  child(0, { heightPx: 0, text: 'Rating Hours All filters' }),
  child(1, { heightPx: 48, text: 'Results Share' }),
  card(2, 'Gong Cha'), separator(3), card(4, 'Kyuramen'), separator(5), card(6, 'Boba Baar'),
  child(7, { heightPx: 120, text: '' }),
  child(8, { heightPx: 104, text: "You're seeing a limited view of Google Maps. Learn more" }),
];

describe('classifyFeedChildren', () => {
  it('recognizes the observed header / card / separator / trailer structure', () => {
    const r = classifyFeedChildren(observed);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.layout.firstCardIndex).toBe(2);
    expect(r.layout.stride).toBe(2);
    expect(r.layout.cards.map((c) => c.index)).toEqual([2, 4, 6]);
    expect(r.layout.kinds.get(0)).toBe('header');
    expect(r.layout.kinds.get(3)).toBe('separator');
    expect(r.layout.kinds.get(7)).toBe('trailer');
    expect(r.layout.kinds.get(8)).toBe('trailer');
  });

  it('fails closed on a text block between cards', () => {
    const withBanner = [...observed];
    withBanner[3] = child(3, { heightPx: 90, text: 'Ad · Sponsored results' });
    const r = classifyFeedChildren(withBanner);
    expect(r).toEqual({ ok: false, reason: 'unsupported_layout', detail: expect.stringContaining('index 3') });
  });

  it('fails closed on an irregular stride', () => {
    const r = classifyFeedChildren([card(2, 'A'), separator(3), card(4, 'B'), separator(5), separator(6), card(7, 'C')]);
    expect(r.ok).toBe(false);
  });

  it('reports no cards', () => {
    expect(classifyFeedChildren([child(0), child(1)])).toEqual({ ok: false, reason: 'no_cards', detail: expect.any(String) });
  });

  it('infers stride for a single card', () => {
    const r = classifyFeedChildren([card(2, 'A'), separator(3), child(4, { heightPx: 120 })]);
    expect(r.ok && r.layout.stride).toBe(2);
    const r1 = classifyFeedChildren([card(0, 'A')]);
    expect(r1.ok && r1.layout.stride).toBe(1);
  });
});
