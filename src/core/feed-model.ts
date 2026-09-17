import type { FeedChildKind, FeedLayout, FeedLayoutResult, RawFeedChild } from './types.js';

export function isCard(child: RawFeedChild): boolean {
  return child.placeHref !== null && child.placeAriaLabel !== null && child.placeAriaLabel.trim().length > 0;
}

export function classifyFeedChildren(children: RawFeedChild[]): FeedLayoutResult {
  const cards = children.filter(isCard);
  const first = cards[0];
  const last = cards[cards.length - 1];
  if (!first || !last) return { ok: false, reason: 'no_cards', detail: `no business cards among ${children.length} feed children` };

  const kinds = new Map<number, FeedChildKind>();
  for (const c of children) {
    if (isCard(c)) { kinds.set(c.index, 'card'); continue; }
    if (c.index < first.index) {
      kinds.set(c.index, c.placeHref === null ? 'header' : 'unsupported');
    } else if (c.index > last.index) {
      kinds.set(c.index, c.heightPx <= 2 && c.text.trim() === '' && c.index === last.index + 1 ? 'separator' : 'trailer');
    } else {
      kinds.set(c.index, c.heightPx <= 2 && c.text.trim() === '' ? 'separator' : 'unsupported');
    }
  }
  const unsupported = [...kinds.entries()].filter(([, k]) => k === 'unsupported').map(([i]) => i);
  if (unsupported.length > 0) {
    return { ok: false, reason: 'unsupported_layout', detail: `unrecognized feed child at index ${unsupported.join(', index ')}` };
  }

  let stride: number;
  if (cards.length >= 2) {
    const diffs = new Set<number>();
    for (let i = 1; i < cards.length; i++) diffs.add(cards[i]!.index - cards[i - 1]!.index);
    if (diffs.size !== 1) return { ok: false, reason: 'unsupported_layout', detail: `irregular card stride: ${[...diffs].join(',')}` };
    stride = [...diffs][0]!;
  } else {
    stride = kinds.get(first.index + 1) === 'separator' ? 2 : 1;
  }
  const layout: FeedLayout = { firstCardIndex: first.index, stride, kinds, cards };
  return { ok: true, layout };
}
