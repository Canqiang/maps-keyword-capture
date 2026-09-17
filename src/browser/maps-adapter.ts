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

export async function detectPageState(page: Page): Promise<PageState> {
  const url = new URL(page.url());
  if (url.pathname.includes('/sorry/')) return { kind: 'captcha' };
  if (page.frames().some((f) => /recaptcha/i.test(f.url()))) return { kind: 'captcha' };
  if (url.hostname === 'consent.google.com') return { kind: 'consent' };
  if (url.pathname.startsWith('/maps/place/')) return { kind: 'place_redirect' };
  const probe = await page.evaluate(() => ({
    feed: document.querySelector('div[role="feed"]') !== null,
    noResults: /can't find/i.test(document.body?.innerText ?? ''),
  })).catch(() => ({ feed: false, noResults: false }));
  if (probe.feed) return { kind: 'results' };
  if (probe.noResults) return { kind: 'no_results' };
  return { kind: 'unknown', detail: `no feed at ${page.url()}` };
}

export async function openSearch(page: Page, url: string, timeoutMs: number): Promise<{ state: PageState; finalUrl: string }> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  let state = await detectPageState(page);
  while (state.kind === 'unknown' && Date.now() < deadline) {
    await page.waitForTimeout(250);
    state = await detectPageState(page);
  }
  return { state, finalUrl: page.url() };
}

export async function readSnapshot(page: Page): Promise<FeedSnapshot | null> {
  return page.evaluate(readFeedSnapshotInPage);
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
  const last = cards[cards.length - 1];
  if (!last) return null;
  const partial = cards.find((c) => c.bounds.y < paneBottom && c.bounds.y + c.bounds.height > paneBottom);
  if (partial) {
    if (partial.bounds.height > pane.height && partial.bounds.y <= pane.y + 0.5) {
      return snapshot.scrollTop + pane.height;      // oversized card: page through it
    }
    return snapshot.scrollTop + (partial.bounds.y - pane.y);
  }
  return snapshot.scrollTop + (last.bounds.y - pane.y); // keep the last full card as overlap
}

export async function scrollFeedTo(page: Page, scrollTop: number): Promise<number> {
  return page.evaluate((top) => {
    const feed = document.querySelector('div[role="feed"]') as HTMLElement | null;
    if (!feed) return -1;
    feed.scrollTop = top;
    return feed.scrollTop;
  }, scrollTop);
}

export async function waitForFeedChange(page: Page, previous: { childCount: number; scrollHeight: number }, timeoutMs: number): Promise<'changed' | 'end' | 'unchanged'> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const probe = await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]') as HTMLElement | null;
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
