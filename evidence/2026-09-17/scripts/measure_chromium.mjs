// THROWAWAY measurement: how many cards per viewport, how many scrolls to reach 15.
import { chromium } from '/Users/xander/git_repo/maps-keyword-capture/node_modules/playwright/index.mjs';
const kw = process.argv[2] ?? 'bubble tea garden city';
const url = `https://www.google.com/maps/search/${encodeURIComponent(kw)}/@40.7268,-73.6343,13z?hl=en`;
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', timezoneId: 'America/New_York' });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
console.log('browser:', browser.version(), 'url:', page.url());
// consent?
if (page.url().includes('consent.google')) { console.log('CONSENT PAGE'); await page.screenshot({ path: 'consent.png' }); await browser.close(); process.exit(0); }
const feed = page.locator('div[role="feed"]');
try { await feed.waitFor({ timeout: 15000 }); } catch { console.log('NO FEED'); await page.screenshot({ path: 'nofeed.png' }); await browser.close(); process.exit(0); }
await page.waitForTimeout(2500);
const snap = async () => page.evaluate(() => {
  const feed = document.querySelector('div[role="feed"]');
  const fr = feed.getBoundingClientRect();
  const kids = [...feed.children];
  const cards = kids.map((el, i) => {
    const a = el.querySelector('a[href*="/maps/place/"]');
    const r = el.getBoundingClientRect();
    const txt = el.innerText || '';
    return { i, h: Math.round(r.height), top: Math.round(r.top), name: a?.getAttribute('aria-label') ?? null, sponsored: /\bSponsored\b/.test(txt), visible: r.bottom > fr.top && r.top < fr.bottom && r.height > 0 };
  });
  const end = /reached the end of the list/i.test(feed.innerText);
  return { feedTop: Math.round(fr.top), feedH: Math.round(fr.height), feedW: Math.round(fr.width), scrollH: feed.scrollHeight, scrollTop: feed.scrollTop, cards, end };
});
let s = await snap();
console.log(`feed: top=${s.feedTop} h=${s.feedH} w=${s.feedW} scrollH=${s.scrollH}`);
const withName = c => c.filter(x => x.name);
console.log('initial cards in DOM:', withName(s.cards).length, 'visible:', withName(s.cards.filter(c => c.visible)).length);
console.log('card heights:', withName(s.cards).slice(0, 8).map(c => c.h).join(','));
console.log('ads in initial:', withName(s.cards).filter(c => c.sponsored).map(c => c.i + ':' + c.name));
await page.screenshot({ path: 'cr_shot_00.png' });
const seen = new Set(withName(s.cards).map(c => c.name + '|' + c.i));
for (let n = 1; n <= 8; n++) {
  await feed.evaluate(el => el.scrollBy(0, el.clientHeight));
  await page.waitForTimeout(2000);
  s = await snap();
  const vis = withName(s.cards.filter(c => c.visible));
  const all = withName(s.cards);
  console.log(`scroll ${n}: scrollTop=${s.scrollTop} dom=${all.length} visible idx=[${vis.map(c=>c.i).join(',')}] end=${s.end}`);
  await page.screenshot({ path: `cr_shot_${String(n).padStart(2,'0')}.png` });
  if (s.end || all.length >= 20 && n >= 3) break;
}
console.log('final names:'); withName(s.cards).forEach(c => console.log(`  ${c.i}\t${c.sponsored ? 'AD ' : '   '}\th=${c.h}\t${c.name}`));
await browser.close();
