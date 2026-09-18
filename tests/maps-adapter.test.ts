import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyFeedChildren } from '../src/core/feed-model.js';
import { classifyCard } from '../src/core/classify.js';
import {
  END_OF_LIST_TEXT, buildSearchUrl, detectPageState, hasQuerySignal, nextScrollTop, openSearch, pageFunctionSource, queryMatches, readSnapshot, scrollFeedTo, waitForFeedChange, transientHintVisible,
} from '../src/browser/maps-adapter.js';
import { namedCards, writeFixture } from './fixtures/feed-fixture.js';

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
});
afterAll(async () => { await browser.close(); });

describe('buildSearchUrl', () => {
  it('encodes the keyword without location parameters', () => {
    expect(buildSearchUrl('bubble tea garden city', 'en-US')).toBe('https://www.google.com/maps/search/?api=1&query=bubble+tea+garden+city&hl=en');
    expect(buildSearchUrl('café & "tea" / 奶茶', 'en-US')).toContain('query=caf%C3%A9+%26+%22tea%22+%2F+%E5%A5%B6%E8%8C%B6');
    expect(buildSearchUrl('x', 'en-US')).not.toMatch(/@|ll=|center=|near/);
  });
});

describe('page function serialization', () => {
  // `npm run capture` runs through tsx, whose esbuild transform hardcodes `keepNames`: inner
  // functions become `__name(fn, "box")`, and the page has no `__name` binding. Vitest's transform
  // does not add the helper, so serializing the real page script here cannot reproduce the failure;
  // assert against the shape esbuild emits instead.
  const keepNamesFn = `function probe(){const count=__name((f)=>f.children.length,"count");return count(document.querySelector('div[role="feed"]'));}`;

  it('runs a keepNames-transformed page function in a page that has no __name helper', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(3) });
    await openSearch(page, url, 5000);
    await expect(page.evaluate(`(${keepNamesFn})()`)).rejects.toThrow(/__name is not defined/);
    await expect(page.evaluate(pageFunctionSource(keepNamesFn))).resolves.toBeGreaterThan(0);
  });

  it('always sends readSnapshot through the __name wrapper', async () => {
    let seen: unknown = null;
    const fake = { evaluate: async (arg: unknown) => { seen = arg; return null; } } as unknown as Page;
    expect(await readSnapshot(fake)).toBeNull();
    expect(typeof seen).toBe('string');
    expect(seen as string).toContain('const __name');
  });
});

describe('openSearch budget', () => {
  it('keeps one absolute deadline across navigation and polling', async () => {
    const timeoutMs = 1200;
    let gotoTimeout = 0;
    const fake = {
      goto: async (_u: string, opts: { timeout: number }) => {
        gotoTimeout = opts.timeout;
        await new Promise((r) => setTimeout(r, 900));
        return null;
      },
      url: () => 'https://www.google.com/maps/search/?api=1&query=x',
      frames: () => [],
      evaluate: async () => ({ feed: false, noResults: false }),
      waitForTimeout: async (ms: number) => { await new Promise((r) => setTimeout(r, ms)); },
    } as unknown as Page;
    const startedAt = Date.now();
    const opened = await openSearch(fake, 'https://www.google.com/maps/search/?api=1&query=x', timeoutMs);
    const elapsed = Date.now() - startedAt;
    expect(opened.state.kind).toBe('unknown');
    expect(gotoTimeout).toBeLessThanOrEqual(timeoutMs);
    expect(elapsed).toBeLessThan(timeoutMs + 300);
  });
});

describe('page reading against the fixture', () => {
  async function openWithHiddenFeedFirst() {
    await openSearch(page, await writeFixture({ query: 'q', cards: namedCards(10) }), 5000);
    await page.evaluate(() => {
      const visible = document.querySelector('div[role="feed"]')!;
      visible.setAttribute('data-visible-results', '');
      const hidden = document.createElement('div');
      hidden.id = 'hidden-results';
      hidden.setAttribute('role', 'feed');
      hidden.style.cssText = 'position:absolute;visibility:hidden;width:408px;height:200px;overflow:auto';
      hidden.innerHTML = '<div style="height:1000px">Stale hidden content</div>';
      visible.before(hidden);
    });
  }

  it('reads the visible results when an earlier feed is hidden', async () => {
    await openWithHiddenFeedFirst();
    expect((await detectPageState(page)).kind).toBe('results');
    const snapshot = (await readSnapshot(page))!;
    expect(snapshot.children.filter(child => child.placeHref)).toHaveLength(10);
    expect(snapshot.paneBounds.height).toBe(875);
  });

  it('scrolls the visible results instead of an earlier hidden feed', async () => {
    await openWithHiddenFeedFirst();
    expect(await scrollFeedTo(page, 300)).toBe(300);
    const scrolls = await page.evaluate(() => ({
      visible: document.querySelector('[data-visible-results]')!.scrollTop,
      hidden: document.getElementById('hidden-results')!.scrollTop,
    }));
    expect(scrolls).toEqual({ visible: 300, hidden: 0 });
  });

  it('waits for the visible results rather than changes in an earlier hidden feed', async () => {
    await openWithHiddenFeedFirst();
    const previous = await page.evaluate(() => {
      const visible = document.querySelector('[data-visible-results]')!;
      const previous = { childCount: visible.children.length, scrollHeight: visible.scrollHeight };
      visible.insertAdjacentHTML('beforeend', '<div>You\'ve reached the end of the list</div>');
      return previous;
    });
    expect(await waitForFeedChange(page, previous, 300)).toBe('end');
  });

  it.each([
    ['visible results at a place URL', '<main><h1>Selected business</h1><div role="feed">Other results</div></main>', 'results'],
    ['loaded details without a result feed', '<main><h1>Only Bear</h1><button aria-label="Directions">Directions</button></main>', 'place_redirect'],
    ['loaded details whose review mentions cannot find', '<main><h1>Only Bear</h1><button aria-label="Directions">Directions</button><p>I can\'t find a better bakery anywhere.</p></main>', 'place_redirect'],
    ['loaded details containing a quoted empty-search message', '<main><h1>Only Bear</h1><button aria-label="Directions">Directions</button><p>Google Maps can\'t find this store, according to a reviewer.</p></main>', 'place_redirect'],
    ['an unknown page with incidental cannot-find text', '<main><p>I can\'t find a better bakery anywhere.</p></main>', 'unknown'],
    ['an unknown page quoting part of an empty-search message', '<main><p>Review: Google Maps can\'t find the old entrance.</p></main>', 'unknown'],
    ['a place URL before its details have loaded', '<main><h1>Loading</h1></main>', 'unknown'],
    ['hidden result and detail skeletons', '<main hidden><h1>Only Bear</h1><button aria-label="Directions">Directions</button><div role="feed">Loading</div></main>', 'unknown'],
  ])('classifies %s from the rendered surface', async (_name, html, kind) => {
    const url = 'https://www.google.com/maps/place/SurfaceFixture';
    await page.route(url, route => route.fulfill({ contentType: 'text/html', body: html }));
    try {
      await page.goto(url);
      expect((await detectPageState(page)).kind).toBe(kind);
    } finally { await page.unroute(url); }
  });

  it('detects the transient collapse-panel hint until the page removes it', async () => {
    await openSearch(page, await writeFixture({ query: 'q', cards: namedCards(3), transientHintMs: 600 }), 5000);
    expect(await transientHintVisible(page)).toBe(true);
    await page.waitForTimeout(900);
    expect(await transientHintVisible(page)).toBe(false);
  });

  it('strips icon-font glyphs from card text and returns the card lines', async () => {
    const url = await writeFixture({ query: 'q', cards: [{ name: 'Gong Cha', ad: true, iconGlyphs: true, address: '630 Old Country Road' }, { name: 'Boba Baar', iconGlyphs: true }] });
    await openSearch(page, url, 5000);
    const snap = (await readSnapshot(page))!;
    const cards = snap.children.filter((c) => c.placeHref);
    expect(cards).toHaveLength(2);
    for (const c of cards) {
      expect(c.text).not.toMatch(/[\ue000-\uf8ff]/);
      expect(c.lines).toBeDefined();
      expect(c.lines!.some((l) => /[\ue000-\uf8ff]/.test(l))).toBe(false);
    }
    expect(cards[0]!.text).toMatch(/^Sponsored Gong Cha /);
    expect(cards[0]!.lines).toEqual(expect.arrayContaining(['Sponsored', 'Gong Cha', 'Bubble tea store · 630 Old Country Road', 'Website Directions']));
  });

  it('detects results, reads the feed, and classifies its children', async () => {
    const url = await writeFixture({ query: 'bubble tea garden city', cards: [{ name: 'Gong Cha', ad: true }, ...namedCards(10)] });
    const opened = await openSearch(page, url, 5000);
    expect(opened.state).toEqual({ kind: 'results' });
    const snap = await readSnapshot(page);
    expect(snap).not.toBeNull();
    if (!snap) return;
    expect(snap.paneBounds).toMatchObject({ x: 72, y: 80, width: 408, height: 875 });
    expect(snap.observedQueryText).toBe('bubble tea garden city');
    expect(queryMatches(snap, 'bubble tea garden city')).toBe(true);
    expect(queryMatches(snap, 'matcha')).toBe(false);
    const layout = classifyFeedChildren(snap.children);
    expect(layout.ok).toBe(true);
    if (!layout.ok) return;
    expect(layout.layout.firstCardIndex).toBe(2);
    expect(layout.layout.stride).toBe(2);
    expect(layout.layout.cards).toHaveLength(11);
    const first = layout.layout.cards[0]!;
    expect(first.placeAriaLabel).toBe('Gong Cha');
    expect(first.sponsoredLabels).toEqual([{ text: 'Sponsored', ownerAriaLabel: 'Sponsored', depth: expect.any(Number) }]);
    expect(first.ratingAriaLabel).toBe('4.5 stars');
    expect(layout.layout.cards[1]!.sponsoredLabels).toEqual([]);
    expect(snap.endOfList).toBe(false);
  });

  it('computes the next scroll position from the first partially visible card', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(12) });
    await openSearch(page, url, 5000);
    const snap = (await readSnapshot(page))!;
    const layout = classifyFeedChildren(snap.children);
    if (!layout.ok) throw new Error(layout.detail);
    const target = nextScrollTop(snap, layout.layout)!;
    // Cards start at y=80+48 and are 211px apiece (210 + 1px separator). The 4th card (top 80+48+3*211=761, bottom 971) is cut by the pane bottom 955, so it moves to the top.
    expect(target).toBe(48 + 3 * 211);
    const applied = await scrollFeedTo(page, target);
    expect(applied).toBe(target);
    const after = (await readSnapshot(page))!;
    const layout2 = classifyFeedChildren(after.children);
    if (!layout2.ok) throw new Error(layout2.detail);
    expect(Math.round(layout2.layout.cards[3]!.bounds.y)).toBe(80);
  });

  it('loads more cards on scroll and then reports the end of the list', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(8), moreCards: namedCards(6, 8), endOfList: true });
    await openSearch(page, url, 5000);
    let snap = (await readSnapshot(page))!;
    expect(snap.children.filter((c) => c.placeHref).length).toBe(8);
    await scrollFeedTo(page, snap.scrollHeight);
    expect(await waitForFeedChange(page, { childCount: snap.children.length, scrollHeight: snap.scrollHeight }, 3000)).toBe('changed');
    snap = (await readSnapshot(page))!;
    expect(snap.children.filter((c) => c.placeHref).length).toBe(14);
    await scrollFeedTo(page, snap.scrollHeight);
    expect(await waitForFeedChange(page, { childCount: snap.children.length, scrollHeight: snap.scrollHeight }, 3000)).toBe('end');
    snap = (await readSnapshot(page))!;
    expect(snap.endOfList).toBe(true);
    expect(snap.children.some((c) => c.text.includes(END_OF_LIST_TEXT))).toBe(true);
    expect(await waitForFeedChange(page, { childCount: snap.children.length, scrollHeight: snap.scrollHeight }, 300)).toBe('end');
  });

  // Measured on the live `?api=1&query=` entry page on 2026-09-17: `input#searchboxinput` never
  // appears, the query sits in `input[name="q"]`, and both that field and the document title are
  // filled in roughly 0.8s after the results feed has already rendered.
  it('reads the query from the entry page field named q', async () => {
    const url = await writeFixture({ query: 'bubble tea garden city', cards: namedCards(3), queryInputName: 'q' });
    await openSearch(page, url, 5000);
    const snap = (await readSnapshot(page))!;
    expect(snap.observedQueryText).toBe('bubble tea garden city');
    expect(hasQuerySignal(snap)).toBe(true);
    expect(queryMatches(snap, 'bubble tea garden city')).toBe(true);
  });

  it('reports no query signal while the entry page has not filled in the field or the title', async () => {
    const url = await writeFixture({ query: 'bubble tea garden city', cards: namedCards(3), queryInputName: 'q', deferQueryMs: 1500 });
    await openSearch(page, url, 5000);
    const early = (await readSnapshot(page))!;
    expect(early.children.length).toBeGreaterThan(0);
    expect(early.observedQueryText).toBeNull();
    expect(early.pageTitle).toBe('Google Maps');
    expect(hasQuerySignal(early)).toBe(false);
    await page.waitForTimeout(1800);
    const late = (await readSnapshot(page))!;
    expect(late.observedQueryText).toBe('bubble tea garden city');
    expect(hasQuerySignal(late)).toBe(true);
    expect(queryMatches(late, 'bubble tea garden city')).toBe(true);
  });

  it('reads the rating label of cards that also show a review count', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(3), ratingLabelStyle: 'stars_reviews' });
    await openSearch(page, url, 5000);
    const snap = (await readSnapshot(page))!;
    const layout = classifyFeedChildren(snap.children);
    expect(layout.ok).toBe(true);
    if (!layout.ok) return;
    expect(layout.layout.cards[0]!.ratingAriaLabel).toBe('4.5 stars 100 Reviews');
    const card = classifyCard(layout.layout.cards[0]!, snap.paneBounds, 'qa01_obs001');
    expect(card.parsed.rating).toBe(4.5);
  });

  it('detects the no-results page', async () => {
    const url = await writeFixture({ query: 'zzz', cards: [], noResults: true });
    const opened = await openSearch(page, url, 3000);
    expect(opened.state).toEqual({ kind: 'no_results' });
    expect(await detectPageState(page)).toEqual({ kind: 'no_results' });
  });
});
