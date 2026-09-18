import type { Page } from 'playwright';
import type { FeedLayout, FeedSnapshot } from '../core/types.js';
import { readFeedSnapshotInPage } from './page-script.js';

export const END_OF_LIST_TEXT = "You've reached the end of the list";

export type PageState =
  | { kind: 'results' } | { kind: 'captcha' } | { kind: 'consent' }
  | { kind: 'no_results' } | { kind: 'place_redirect' } | { kind: 'unknown'; detail: string };

export function buildSearchUrl(keyword: string, locale: string): string {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', keyword);
  url.searchParams.set('hl', locale.split('-')[0] ?? 'en');
  return url.toString();
}

/**
 * The inline `page.evaluate` closures below must contain no named inner functions: the tsx/esbuild
 * transform rewrites those to `__name(fn, "…")`, which does not exist in the page. Anything that
 * needs a helper goes through `pageFunctionSource`.
 */
export async function detectPageState(page: Page): Promise<PageState> {
  const url = new URL(page.url());
  if (url.pathname.includes('/sorry/')) return { kind: 'captcha' };
  if (page.frames().some((f) => /recaptcha/i.test(f.url()))) return { kind: 'captcha' };
  if (url.hostname === 'consent.google.com') return { kind: 'consent' };
  const probe = await page.evaluate(() => ({
    feed: Array.from(document.querySelectorAll('div[role="feed"]')).some(e =>
      e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden'),
    detailHeading: Array.from(document.querySelectorAll('h1')).some(e =>
      (e.textContent ?? '').trim().length > 0 && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden'),
    detailAction: Array.from(document.querySelectorAll('button[aria-label^="Directions"], [data-value="Directions"], button[data-item-id="address"]')).some(e =>
      e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden'),
    // The empty-search message has an explicit product prefix. Incidental review
    // text such as "I can't find a better bakery" is not an empty result set.
    noResults: (document.body?.innerText ?? '').split(/\r?\n/).some(line => /^Google Maps can['’]t find\s+\S/i.test(line.trim())),
  })).catch(() => ({ feed: false, noResults: false, detailHeading: false, detailAction: false }));
  // A place URL may still carry a ranked results feed. Prefer the visible surface, and do not
  // classify an unloaded/failed page as a known detail result merely because its URL changed.
  if (probe.feed) return { kind: 'results' };
  if (url.pathname.startsWith('/maps/place/') && probe.detailHeading && probe.detailAction) return { kind: 'place_redirect' };
  if (probe.noResults) return { kind: 'no_results' };
  return { kind: 'unknown', detail: `no feed at ${page.url()}` };
}

/** One absolute deadline covers navigation and the readiness poll, so a slow page cannot spend the
 * navigation budget and then a second, full polling budget on top of it. */
export async function openSearch(page: Page, url: string, timeoutMs: number): Promise<{ state: PageState; finalUrl: string }> {
  const deadline = Date.now() + timeoutMs;
  const remaining = () => deadline - Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.max(1, remaining()) });
  let state = await detectPageState(page);
  while (state.kind === 'unknown' && remaining() > 0) {
    await page.waitForTimeout(Math.min(250, remaining()));
    state = await detectPageState(page);
  }
  return { state, finalUrl: page.url() };
}

/**
 * Serializes a page function for `page.evaluate` inside a scope that defines `__name`.
 * Bundlers that keep function names (esbuild via tsx, which `npm run capture` uses) rewrite inner
 * functions to `__name(fn, "box")`. Playwright ships only the function source to the page, where
 * that helper does not exist, so the call fails with `ReferenceError: __name is not defined`.
 * The real helper only stamps `fn.name`, so identity is a safe stand-in.
 */
/**
 * UI hints Google paints over a fresh, signed-out session (measured on 2026-09-17: the
 * "Collapse side panel" hint shows from ~0.3 s to ~8.4 s after the results feed appears).
 * They are not results; screenshots wait for them to clear instead of removing them.
 */
export const TRANSIENT_HINT_TEXTS: readonly string[] = ['Collapse side panel'];

export async function transientHintVisible(page: Page): Promise<boolean> {
  return page.evaluate((texts) => Array.from(document.querySelectorAll('span, div'))
    .some((e) => e.children.length === 0 && texts.includes((e.textContent || '').trim()) && e.getBoundingClientRect().width > 0),
  [...TRANSIENT_HINT_TEXTS]).catch(() => false);
}

export function pageFunctionSource(fn: (() => unknown) | string): string {
  return `(() => { const __name = (target) => target; return (${String(fn)})(); })()`;
}

export async function readSnapshot(page: Page): Promise<FeedSnapshot | null> {
  return page.evaluate<FeedSnapshot | null>(pageFunctionSource(readFeedSnapshotInPage));
}

/** Title the entry page carries before it fills in the searched query (English desktop profile). */
export const PLACEHOLDER_TITLE = 'google maps';

/**
 * Whether the page has produced any query evidence yet. The `?api=1&query=` entry page renders the
 * results feed about 0.8s before it fills in the query field and the document title, so an absent
 * signal means "not yet", which must not be read as a mismatch.
 */
export function hasQuerySignal(snapshot: FeedSnapshot): boolean {
  if ((snapshot.observedQueryText ?? '').trim() !== '') return true;
  const title = snapshot.pageTitle.trim().toLowerCase();
  return title !== '' && title !== PLACEHOLDER_TITLE;
}

export function queryMatches(snapshot: FeedSnapshot, keyword: string): boolean {
  const want = keyword.trim().toLowerCase();
  const seen = snapshot.observedQueryText?.trim().toLowerCase();
  if (seen === want) return true;
  return snapshot.pageTitle.trim().toLowerCase().startsWith(want);
}

export function nextScrollTop(snapshot: FeedSnapshot, layout: FeedLayout): number | null {
  const pane = snapshot.paneBounds;
  const paneBottom = pane.y + pane.height;
  const cards = layout.cards;
  if (cards.length === 0) return null;
  const partial = cards.find((c) => c.bounds.y < paneBottom && c.bounds.y + c.bounds.height > paneBottom);
  if (partial) {
    if (partial.bounds.height > pane.height && partial.bounds.y <= pane.y + 0.5) {
      return snapshot.scrollTop + pane.height;      // oversized card: page through it
    }
    return snapshot.scrollTop + (partial.bounds.y - pane.y);
  }
  // Loaded cards can extend several viewports below the pane. At a separator-sized
  // gap no card crosses the lower edge: only an actually visible card is a safe overlap.
  const lastVisible = cards.filter((c) => c.bounds.y < paneBottom && c.bounds.y + c.bounds.height > pane.y).at(-1);
  if (!lastVisible) return null;
  return Math.max(snapshot.scrollTop, snapshot.scrollTop + lastVisible.bounds.y - pane.y);
}

export async function scrollFeedTo(page: Page, scrollTop: number): Promise<number> {
  return page.evaluate((top) => {
    const feed = Array.from(document.querySelectorAll<HTMLElement>('div[role="feed"]')).find(e =>
      e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden') ?? null;
    if (!feed) return -1;
    feed.scrollTop = top;
    return feed.scrollTop;
  }, scrollTop);
}

export async function waitForFeedChange(page: Page, previous: { childCount: number; scrollHeight: number }, timeoutMs: number): Promise<'changed' | 'end' | 'unchanged'> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const probe = await page.evaluate(() => {
      const feed = Array.from(document.querySelectorAll<HTMLElement>('div[role="feed"]')).find(e =>
        e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden') ?? null;
      if (!feed) return null;
      return { childCount: feed.children.length, scrollHeight: feed.scrollHeight, end: /reached the end of the list/i.test(feed.innerText || '') };
    });
    if (probe) {
      if (probe.end) return 'end';
      if (probe.childCount !== previous.childCount || probe.scrollHeight !== previous.scrollHeight) return 'changed';
    }
    if (Date.now() >= deadline) return 'unchanged';
    await page.waitForTimeout(100);
  }
}
