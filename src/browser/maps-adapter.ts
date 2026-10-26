import type { Page } from 'playwright';
import type { PlaceDetailsEvidence } from '../contracts.js';
import type { FeedLayout, FeedSnapshot } from '../core/types.js';
import { readFeedSnapshotInPage } from './page-script.js';

export const END_OF_LIST_TEXT = "You've reached the end of the list";

export type PageState =
  | { kind: 'results' } | { kind: 'captcha' } | { kind: 'consent' }
  | { kind: 'no_results' }
  | { kind: 'place_redirect'; placeDetails?: PlaceDetailsEvidence; observedQueryText?: string | null }
  | { kind: 'unknown'; detail: string };

export interface MapView { latitude: number; longitude: number; zoom: number }

/**
 * Query-only search uses the `?api=1&query=` entry URL. A map view uses the coordinate-bearing
 * `/maps/search/<keyword>/@lat,lng,<zoom>z` URL to request a camera position. Camera coordinates
 * do not prove backend search locality: the 2026-10-26 OnlyBear near-me sample returned Flushing
 * listings with a Garden City camera. Keep geographic acceptance separate from capture success.
 */
export function buildSearchUrl(keyword: string, locale: string, mapView?: MapView): string {
  const hl = locale.split('-')[0] ?? 'en';
  if (mapView) {
    const coordinate = (value: number): string => value.toFixed(7).replace(/0+$/u, '').replace(/\.$/u, '');
    return `https://www.google.com/maps/search/${encodeURIComponent(keyword)}/@${coordinate(mapView.latitude)},${coordinate(mapView.longitude)},${mapView.zoom}z?hl=${encodeURIComponent(hl)}`;
  }
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', keyword);
  url.searchParams.set('hl', hl);
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
  type Probe = { feed: boolean; noResults: boolean; detail: Omit<PlaceDetailsEvidence, 'mapsUrl'> | null; observedQueryText: string | null };
  // Serialize through the helper because this probe has local functions (tsx keepNames).
  const probe = await page.evaluate<Probe>(pageFunctionSource(() => {
    const visible = (e: Element): boolean => {
      const box = e.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0 || box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth) return false;
      for (let ancestor: Element | null = e; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (ancestor.hasAttribute('hidden') || ancestor.getAttribute('aria-hidden') === 'true' || ancestor.hasAttribute('inert') || style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const clean = (value: string | null) => (value ?? '').replace(/\s+/g, ' ').trim();
    const paneSelector = 'main, [role="main"]';
    const candidates: Array<Omit<PlaceDetailsEvidence, 'mapsUrl'>> = [];
    for (const pane of Array.from(document.querySelectorAll(paneSelector)).filter(visible)) {
      if (pane.closest('[aria-busy="true"]') || Array.from(pane.querySelectorAll('[aria-busy="true"], [role="progressbar"]')).some(visible)) continue;
      const owned = (selector: string) => Array.from(pane.querySelectorAll(selector)).filter(e => e.closest(paneSelector) === pane && visible(e));
      const headings = owned('h1').filter(e => clean((e as HTMLElement).innerText));
      if (headings.length !== 1) continue;
      const name = clean((headings[0] as HTMLElement).innerText);
      if (/^loading(?:[.\s…]|$)/i.test(name)) continue;
      const signals: PlaceDetailsEvidence['signals'] = ['visible_heading'];
      const directions = owned('button[aria-label^="Directions"], [data-value="Directions"]').length > 0;
      const address = owned('button[data-item-id="address"]').length > 0;
      if (directions) signals.push('directions');
      if (address) signals.push('address');
      if (directions || address) {
        candidates.push({ name, recognition: 'standard_actions', signals });
        continue;
      }
      // A sparse merchant detail can legitimately omit Directions/address. Require the
      // actual named Google actions region and contact controls, all in this same pane.
      // Generic toolbar labels, heading+URL and a limited-view footer alone are insufficient.
      if (clean(pane.getAttribute('aria-label')) !== name) continue;
      const actionRegions = owned('[role="region"]').filter(e => clean(e.getAttribute('aria-label')) === `Actions for ${name}`);
      if (actionRegions.length !== 1) continue;
      const actions = actionRegions[0]!;
      const action = (label: string) => owned('button').some(e => actions.contains(e) && clean(e.getAttribute('aria-label')) === label && e.getAttribute('data-value') === label && !(e as HTMLButtonElement).disabled && e.getAttribute('aria-disabled') !== 'true');
      if (!action('Save') || !action('Send to phone') || !action('Share')) continue;
      const website = owned('a[data-item-id="authority"]').some(e => {
        try {
          const href = new URL(e.getAttribute('href') ?? '');
          return /^Website:\s*\S/.test(e.getAttribute('aria-label') ?? '') && ['http:', 'https:'].includes(href.protocol) && !href.username && !href.password;
        } catch { return false; }
      });
      const phone = owned('button[data-item-id^="phone:tel:"]').some(e => {
        const itemId = e.getAttribute('data-item-id') ?? '';
        const label = e.getAttribute('aria-label') ?? '';
        const digits = itemId.replace(/\D/g, '');
        return /^phone:tel:\+?[\d ()-]+$/.test(itemId) && /^Phone:\s*\+?[\d ()-]+\s*$/.test(label) &&
          /^\d{7,15}$/.test(digits) && digits === label.replace(/\D/g, '') &&
          !(e as HTMLButtonElement).disabled && e.getAttribute('aria-disabled') !== 'true';
      });
      if (!website && !phone) continue;
      signals.push('named_pane', 'named_actions', 'save', 'send_to_phone', 'share');
      if (website) signals.push('website');
      if (phone) signals.push('phone');
      candidates.push({ name, recognition: 'limited_actions', signals });
    }
    const input = Array.from(document.querySelectorAll<HTMLInputElement>('input#searchboxinput, input[name="q"], input[aria-label*="Search" i]')).find(visible);
    return {
      feed: Array.from(document.querySelectorAll('div[role="feed"]')).some(visible),
      detail: candidates.length === 1 ? candidates[0]! : null,
      observedQueryText: input?.value ?? null,
      // Incidental review text such as "I can't find a better bakery" is not no-results.
      noResults: (document.body?.innerText ?? '').split(/\r?\n/).some(line => /^Google Maps can['’]t find\s+\S/i.test(line.trim())),
    };
  })).catch((): Probe => ({ feed: false, noResults: false, detail: null, observedQueryText: null }));
  // A place URL may still carry a ranked results feed. Prefer the visible surface, and do not
  // classify an unloaded/failed page as a known detail result merely because its URL changed.
  if (probe.feed) return { kind: 'results' };
  const supportedPlaceUrl = url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    ['google.com', 'www.google.com', 'maps.google.com'].includes(url.hostname) && /^\/maps\/place\/[^/]+/.test(url.pathname);
  if (supportedPlaceUrl && probe.detail) return { kind: 'place_redirect', placeDetails: { ...probe.detail, mapsUrl: page.url() }, observedQueryText: probe.observedQueryText };
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
