import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectPageState } from '../src/browser/maps-adapter.js';
import { limitedDetailHtml, limitedDetailName, limitedDetailUrl } from './fixtures/limited-details-fixture.js';

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
});
afterAll(async () => { await browser.close(); });

async function readSurface(html: string, url = limitedDetailUrl) {
  await page.route(url, route => route.fulfill({ contentType: 'text/html', body: html }));
  try {
    await page.goto(url);
    return await detectPageState(page);
  } finally { await page.unroute(url); }
}

describe('limited place details', () => {
  it('recognizes an evidenced limited merchant detail without Directions or address', async () => {
    expect(await readSurface(limitedDetailHtml)).toMatchObject({
      kind: 'place_redirect', placeDetails: {
        name: limitedDetailName, mapsUrl: limitedDetailUrl, recognition: 'limited_actions',
        signals: expect.arrayContaining(['visible_heading', 'save', 'send_to_phone', 'share', 'website', 'phone']),
      },
    });
  });

  it.each([
    ['missing Save', limitedDetailHtml.replace('<button aria-label="Save" data-value="Save">Save</button>', '')],
    ['hidden Save', limitedDetailHtml.replace('aria-label="Save"', 'hidden aria-label="Save"')],
    ['hidden ancestor actions', limitedDetailHtml.replace('<div role="region"', '<div style="opacity:0" role="region"')],
    ['no contacts', limitedDetailHtml.replace(/<a data-item-id="authority"[\s\S]*?<\/a>/, '').replace(/<button data-item-id="phone:[\s\S]*?<\/button>/, '')],
    ['loading pane', limitedDetailHtml.replace('<main ', '<main aria-busy="true" ')],
    ['hidden pane', limitedDetailHtml.replace('<main ', '<main hidden ')],
    ['heading outside actions pane', limitedDetailHtml.replace('<h1>She-Joy\'s Sweet Treats</h1>', '').replace('<main ', '<h1>She-Joy\'s Sweet Treats</h1><main ')],
    ['actions outside heading pane', limitedDetailHtml.replace('</main>', '</main><main><h1>Unrelated</h1></main>').replace('<h1>She-Joy\'s Sweet Treats</h1>', '')],
    ['wrong actions owner', limitedDetailHtml.replace("Actions for She-Joy's Sweet Treats", 'Actions for Another place')],
    ['missing control data', limitedDetailHtml.replace('data-value="Share"', '')],
    ['contradictory control data', limitedDetailHtml.replace('data-value="Share"', 'data-value="Search"')],
    ['multiple detail headings', limitedDetailHtml.replace('</h1>', '</h1><h1>Another place</h1>')],
  ])('does not recognize %s', async (_name, html) => {
    expect((await readSurface(html)).kind).toBe('unknown');
  });

  it.each([
    'http://www.google.com/maps/place/Example',
    'https://evil.test/maps/place/Example',
    'https://www.google.com.evil.test/maps/place/Example',
    'https://www.google.com:444/maps/place/Example',
    'https://www.google.com/maps/search/Example',
    'https://www.google.com/maps/place/',
  ])('does not trust a limited detail at unsupported URL %s', async url => {
    expect((await readSurface(limitedDetailHtml, url)).kind).toBe('unknown');
  });

  it('recognizes the same fully evidenced controls without optional category, rating or footer', async () => {
    const html = limitedDetailHtml.replace('<button jsaction="pane.rating.category">Bakery</button>', '').replace('<span role="img" aria-label="5.0 stars">5.0</span>', '').replace("<p>You're seeing a limited view of Google Maps.</p>", '');
    expect((await readSurface(html)).kind).toBe('place_redirect');
  });

  it.each([
    ['no digits', 'phone:tel:() -', 'Phone: ('],
    ['too few digits', 'phone:tel:12', 'Phone: 12'],
    ['contradictory numbers', 'phone:tel:15551234567', 'Phone: +1 555-987-6543'],
  ])('rejects a phone-only contact with %s', async (_name, itemId, label) => {
    const html = limitedDetailHtml.replace(/<a data-item-id="authority"[\s\S]*?<\/a>/, '').replace('phone:tel:15551234567', itemId).replace('Phone: +1 555-123-4567', label);
    expect((await readSurface(html)).kind).toBe('unknown');
  });

  it.each(['website', 'phone'])('accepts the complete action triad with a real %s contact', async contact => {
    const html = contact === 'phone'
      ? limitedDetailHtml.replace(/<a data-item-id="authority"[\s\S]*?<\/a>/, '')
      : limitedDetailHtml.replace(/<button data-item-id="phone:[\s\S]*?<\/button>/, '');
    expect(await readSurface(html)).toMatchObject({ kind: 'place_redirect', placeDetails: { signals: expect.arrayContaining([contact]) } });
  });

  it('prefers a visible ranked feed even with a limited detail pane', async () => {
    expect(await readSurface(limitedDetailHtml.replace('</body>', '<div role="feed">Ranked places</div></body>'))).toEqual({ kind: 'results' });
  });

  it('gives CAPTCHA and consent priority over otherwise recognizable details', async () => {
    expect(await readSurface(limitedDetailHtml, 'https://www.google.com/sorry/index')).toEqual({ kind: 'captcha' });
    expect(await readSurface(limitedDetailHtml, 'https://consent.google.com/maps/place/Example')).toEqual({ kind: 'consent' });
  });
});
