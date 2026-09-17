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
    // Cards that show a review count label the rating "4.8 stars 97 Reviews", so an
    // aria-label suffix match misses them. Pick the first role=img whose label starts with a rating.
    const rating = Array.from(el.querySelectorAll('span[role="img"]'))
      .find((s) => /^\d(?:\.\d)?\s+stars?\b/.test(s.getAttribute('aria-label') || '')) ?? null;
    // Icon fonts render as private-use characters inside innerText (menu, website, directions glyphs);
    // they are not content and would otherwise glue onto neighbouring words.
    const clean = (s: string) => s.replace(/[\ue000-\uf8ff]/g, '').replace(/\s+/g, ' ').trim();
    const rawInner = (el as HTMLElement).innerText || '';
    const text = clean(rawInner);
    const lines = rawInner.split(/\r?\n/).map(clean).filter((l) => l.length > 0);
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
      text, lines, sponsoredLabels,
    };
  });
  const feedText = feed.innerText || '';
  // The `?api=1&query=` entry page carries the query in `input[name="q"]` and never renders
  // `input#searchboxinput`; the interactive `/maps/search/<query>` layout uses the latter.
  const input = document.querySelector('input#searchboxinput, input[name="q"], input[aria-label*="Search" i]') as HTMLInputElement | null;
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
