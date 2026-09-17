import { describe, expect, it } from 'vitest';
import { classifyCard } from '../src/core/classify.js';
import { classifyFeedChildren } from '../src/core/feed-model.js';
import { applyRound, createReconcileState, lastCommittedIndex, type ReconcileRound } from '../src/core/reconcile.js';
import type { ClassifiedCard, RawFeedChild } from '../src/core/types.js';

const pane = { x: 72, y: 80, width: 408, height: 875 };

function rawCard(index: number, name: string, opts: { ad?: boolean; y?: number; id?: string } = {}): RawFeedChild {
  const id = opts.id ?? `0x${index}:0x${name.length}`;
  return {
    index, tag: 'DIV', heightPx: 200, bounds: { x: 72, y: opts.y ?? 80 + (index / 2) * 200, width: 408, height: 200 },
    placeHref: `https://www.google.com/maps/place/${encodeURIComponent(name)}/data=!1s${id}`,
    placeAriaLabel: name, ratingAriaLabel: '4.5 stars',
    text: `${name}${opts.ad ? ' Sponsored' : ''} ${name} 4.5 (10) Cafe · 1 Main St Closed`,
    sponsoredLabels: opts.ad ? [{ text: 'Sponsored', ownerAriaLabel: 'Sponsored', depth: 6 }] : [],
  };
}
function sep(index: number): RawFeedChild {
  return { index, tag: 'DIV', heightPx: 1, bounds: { x: 72, y: 0, width: 408, height: 1 }, placeHref: null, placeAriaLabel: null, ratingAriaLabel: null, text: '', sponsoredLabels: [] };
}
/** Build a round from card specs [index, name, opts]; separators are inserted automatically at odd indices. */
function round(observationId: string, specs: [number, string, { ad?: boolean; y?: number; id?: string }?][]): ReconcileRound {
  const children: RawFeedChild[] = [];
  for (const [index, name, opts] of specs) {
    if (children.length > 0) children.push(sep(index - 1));
    children.push(rawCard(index, name, opts ?? {}));
  }
  const layoutResult = classifyFeedChildren(children);
  if (!layoutResult.ok) throw new Error(layoutResult.detail);
  const cards: ClassifiedCard[] = layoutResult.layout.cards.map((c) => classifyCard(c, pane, observationId));
  return { observationId, layout: layoutResult.layout, cards };
}

describe('applyRound', () => {
  it('merges three overlapping rounds into an ordered prefix without double counting', () => {
    let s = createReconcileState();
    s = applyRound(s, round('o1', [[2, 'A'], [4, 'B'], [6, 'C'], [8, 'D'], [10, 'E']]), 15);
    s = applyRound(s, round('o2', [[10, 'E'], [12, 'F'], [14, 'G'], [16, 'H'], [18, 'I']]), 15);
    s = applyRound(s, round('o3', [[18, 'I'], [20, 'J'], [22, 'K']]), 15);
    expect(s.failure).toBeNull();
    expect(s.committed.map((c) => c.card.name)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']);
    expect(s.committed[4]!.observationIds).toEqual(['o1', 'o2']);
    expect(lastCommittedIndex(s)).toBe(22);
  });

  it('keeps ad and organic occurrences of one business as two entries', () => {
    let s = createReconcileState();
    s = applyRound(s, round('o1', [[2, 'Gong Cha', { ad: true, id: '0xg:0xc' }], [4, 'B'], [6, 'Gong Cha', { id: '0xg:0xc' }]]), 15);
    expect(s.committed).toHaveLength(3);
    expect(s.committed[0]!.card.classification.resultType).toBe('ad');
    expect(s.committed[2]!.card.classification.resultType).toBe('organic');
    expect(s.committed[0]!.card.businessKey).toBe(s.committed[2]!.card.businessKey);
  });

  it('truncates to the limit', () => {
    const s = applyRound(createReconcileState(), round('o1', [[2, 'A'], [4, 'B'], [6, 'C']]), 2);
    expect(s.committed.map((c) => c.card.name)).toEqual(['A', 'B']);
  });

  it('fails on same-index replacement and keeps the prefix before it', () => {
    let s = createReconcileState();
    s = applyRound(s, round('o1', [[2, 'A'], [4, 'B'], [6, 'C']]), 15);
    s = applyRound(s, round('o2', [[2, 'A'], [4, 'X'], [6, 'C'], [8, 'D']]), 15);
    expect(s.failure).toMatchObject({ reason: 'sequence_ambiguous', atIndex: 4 });
    expect(s.committed.map((c) => c.card.name)).toEqual(['A']);
  });

  it('fails when a committed card changes ad type', () => {
    let s = createReconcileState();
    s = applyRound(s, round('o1', [[2, 'A', { ad: true }], [4, 'B']]), 15);
    s = applyRound(s, round('o2', [[2, 'A'], [4, 'B']]), 15);
    expect(s.failure?.reason).toBe('sequence_ambiguous');
    expect(s.committed).toHaveLength(0);
  });

  it('fails on an index gap and keeps the prefix', () => {
    let s = createReconcileState();
    s = applyRound(s, round('o1', [[2, 'A'], [4, 'B']]), 15);
    s = applyRound(s, round('o2', [[8, 'D'], [10, 'E']]), 15);
    expect(s.failure).toMatchObject({ reason: 'sequence_ambiguous', atIndex: 8 });
    expect(s.committed.map((c) => c.card.name)).toEqual(['A', 'B']);
  });

  it('fails when a known occurrence moves to another index', () => {
    let s = createReconcileState();
    s = applyRound(s, round('o1', [[2, 'A', { id: '0xa:0x1' }], [4, 'B']]), 15);
    s = applyRound(s, round('o2', [[2, 'Z'], [4, 'B'], [6, 'A', { id: '0xa:0x1' }]]), 15);
    expect(s.failure?.reason).toBe('sequence_ambiguous');
  });

  it('fails when visual order disagrees with index order', () => {
    const s = applyRound(createReconcileState(), round('o1', [[2, 'A', { y: 500 }], [4, 'B', { y: 100 }]]), 15);
    expect(s.failure?.reason).toBe('sequence_ambiguous');
    expect(s.committed).toHaveLength(0);
  });

  it('fails when the stride changes between rounds', () => {
    let s = createReconcileState();
    s = applyRound(s, round('o1', [[2, 'A'], [4, 'B']]), 15);
    const odd = round('o2', [[4, 'B'], [6, 'C']]);
    odd.layout = { ...odd.layout, stride: 3 };
    s = applyRound(s, odd, 15);
    expect(s.failure?.reason).toBe('unsupported_layout');
  });

  it('does nothing after a failure', () => {
    let s = createReconcileState();
    s = applyRound(s, round('o1', [[2, 'A', { y: 500 }], [4, 'B', { y: 100 }]]), 15);
    const again = applyRound(s, round('o2', [[2, 'A'], [4, 'B']]), 15);
    expect(again).toBe(s);
  });
});
