import type { FeedSnapshot } from '../core/types.js';

/**
 * Runs inside the page via page.evaluate. Must stay self-contained:
 * no imports used at runtime, no references to module-scope values.
 */
export function readFeedSnapshotInPage(): FeedSnapshot | null {
  const feed = document.querySelector('div[role="feed"]') as HTMLElement | null;
  if (!feed) return null;
  const pane = feed.getBoundingClientRect();
  const box = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const children = Array.from(feed.children).map((el, index) => {
    const r = el.getBoundingClientRect();
    const link = el.querySelector('a[href*="/maps/place/"]');
    const rating = el.querySelector('span[role="img"][aria-label$=" stars"], span[role="img"][aria-label$=" star"]');
    const text = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
    const sponsoredLabels: { text: string; ownerAriaLabel: string | null; depth: number }[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode() as Element | null;
    while (node) {
      if (node.children.length === 0 && (node.textContent || '').trim() === 'Sponsored') {
        let depth = 0;
        let p: Element | null = node;
        while (p && p !== el) { depth += 1; p = p.parentElement; }
        sponsoredLabels.push({ text: 'Sponsored', ownerAriaLabel: node.parentElement?.getAttribute('aria-label') ?? null, depth });
      }
      node = walker.nextNode() as Element | null;
    }
    return {
      index, tag: el.tagName, heightPx: Math.round(r.height), bounds: box(r),
      placeHref: link?.getAttribute('href') ?? null,
      placeAriaLabel: link?.getAttribute('aria-label') ?? null,
      ratingAriaLabel: rating?.getAttribute('aria-label') ?? null,
      text, sponsoredLabels,
    };
  });
  const feedText = feed.innerText || '';
  const input = document.querySelector('input#searchboxinput, input[aria-label*="Search" i]') as HTMLInputElement | null;
  return {
    children,
    paneBounds: box(pane),
    scrollTop: feed.scrollTop,
    scrollHeight: feed.scrollHeight,
    clientHeight: feed.clientHeight,
    endOfList: /reached the end of the list/i.test(feedText),
    observedQueryText: input ? input.value : null,
    pageTitle: document.title,
    url: location.href,
  };
}
