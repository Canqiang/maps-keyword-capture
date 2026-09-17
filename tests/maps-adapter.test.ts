import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyFeedChildren } from '../src/core/feed-model.js';
import { classifyCard } from '../src/core/classify.js';
import {
  END_OF_LIST_TEXT, buildSearchUrl, detectPageState, hasQuerySignal, nextScrollTop, openSearch, pageFunctionSource, queryMatches, readSnapshot, scrollFeedTo, waitForFeedChange,
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
});

describe('page reading against the fixture', () => {
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
