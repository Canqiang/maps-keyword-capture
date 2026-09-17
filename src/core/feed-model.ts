import type { FeedChildKind, FeedLayout, FeedLayoutResult, RawFeedChild } from './types.js';

export function isCard(child: RawFeedChild): boolean {
  return child.placeHref !== null && child.placeAriaLabel !== null && child.placeAriaLabel.trim().length > 0;
}

/**
 * A group-level ad marker: "Sponsored", "Ads", "Ad". Section 7 of the design requires the adapter to
 * establish which cards a marker covers, so a marker on a header or trailer child, where ownership
 * cannot be resolved from the card itself, fails closed instead of leaving the cards below organic.
 */
const GROUP_AD_LABEL = /\b(sponsored|ads?)\b/i;

export function classifyFeedChildren(children: RawFeedChild[]): FeedLayoutResult {
  const cards = children.filter(isCard);
  const first = cards[0];
  const last = cards[cards.length - 1];
  if (!first || !last) return { ok: false, reason: 'no_cards', detail: `no business cards among ${children.length} feed children` };

  const kinds = new Map<number, FeedChildKind>();
  for (const c of children) {
    if (isCard(c)) { kinds.set(c.index, 'card'); continue; }
    if (c.index < first.index) {
      const header = c.placeHref === null && !GROUP_AD_LABEL.test(c.text);
      kinds.set(c.index, header ? 'header' : 'unsupported');
    } else if (c.index > last.index) {
      const separator = c.heightPx <= 2 && c.text.trim() === '' && c.index === last.index + 1;
      kinds.set(c.index, separator ? 'separator' : GROUP_AD_LABEL.test(c.text) ? 'unsupported' : 'trailer');
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
