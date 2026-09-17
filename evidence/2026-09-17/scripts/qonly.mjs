// THROWAWAY: query-only search probe (no coordinates), record final URL and business areas
import { chromium } from '/Users/xander/git_repo/maps-keyword-capture/node_modules/playwright/index.mjs';
const kw = process.argv[2];
const u = new URL('https://www.google.com/maps/search/'); u.searchParams.set('api','1'); u.searchParams.set('query', kw); u.searchParams.set('hl','en');
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', timezoneId: 'America/New_York' });
const page = await ctx.newPage();
await page.goto(u.toString(), { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
if (page.url().includes('consent.google')) { console.log('CONSENT'); await browser.close(); process.exit(0); }
try { await page.locator('div[role="feed"]').waitFor({ timeout: 15000 }); } catch { console.log('NO FEED url=', page.url()); await page.screenshot({ path: `q_${kw.replace(/\W+/g,'_')}_nofeed.png` }); await browser.close(); process.exit(0); }
await page.waitForTimeout(3000);
const s = await page.evaluate(() => {
  const feed = document.querySelector('div[role="feed"]');
  const kids = [...feed.children];
  const cards = kids.map((el, i) => { const a = el.querySelector('a[href*="/maps/place/"]'); if (!a) return null;
    const txt = (el.innerText||'').replace(/\s+/g,' ');
    const addr = (txt.match(/·\s*([^·]+?)\s*(Closed|Open|Opens|Closes|Temporarily)/) || [])[1] ?? null;
    return { i, name: a.getAttribute('aria-label'), ad: /\bSponsored\b/.test(txt), addr }; }).filter(Boolean);
  return { count: cards.length, cards, searchBox: document.querySelector('input#searchboxinput')?.value ?? null };
});
console.log('finalUrl:', page.url());
console.log('searchBox:', s.searchBox, '| cards:', s.count);
s.cards.slice(0, 12).forEach(c => console.log(`  ${c.ad ? 'AD ' : '   '} ${c.name}  |  ${c.addr}`));
await page.screenshot({ path: `q_${kw.replace(/\W+/g,'_')}.png` });
await browser.close();
