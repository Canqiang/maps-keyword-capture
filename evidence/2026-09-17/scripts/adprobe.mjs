// THROWAWAY: inspect ad card structure and feed children types
import { chromium } from '/Users/xander/git_repo/maps-keyword-capture/node_modules/playwright/index.mjs';
const kw = process.argv[2] ?? 'bubble tea garden city';
const url = `https://www.google.com/maps/search/${encodeURIComponent(kw)}/@40.7268,-73.6343,13z?hl=en`;
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', timezoneId: 'America/New_York' });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.locator('div[role="feed"]').waitFor({ timeout: 15000 });
await page.waitForTimeout(3000);
const info = await page.evaluate(() => {
  const feed = document.querySelector('div[role="feed"]');
  const kids = [...feed.children];
  const rows = kids.map((el, i) => {
    const a = el.querySelector('a[href*="/maps/place/"]');
    const txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
    const spons = [...el.querySelectorAll('*')].filter(n => n.children.length === 0 && /^Sponsored$/i.test((n.textContent||'').trim()));
    return { i, tag: el.tagName, cls: el.className.slice(0,40), role: el.getAttribute('role'), h: Math.round(el.getBoundingClientRect().height),
      name: a?.getAttribute('aria-label') ?? null, href: a ? a.getAttribute('href').slice(0, 140) : null,
      sponsoredEls: spons.map(n => ({ tag: n.tagName, aria: n.getAttribute('aria-label'), parentAria: n.parentElement?.getAttribute('aria-label'), depth: (()=>{let d=0,p=n;while(p&&p!==el){d++;p=p.parentElement;}return d;})() })),
      textHead: txt.slice(0, 120) };
  });
  return rows;
});
for (const r of info) console.log(JSON.stringify(r));
// rating aria-label sample from first organic card
const rating = await page.evaluate(() => {
  const feed = document.querySelector('div[role="feed"]');
  const el = [...feed.children].find(c => c.querySelector('a[href*="/maps/place/"]') && !/Sponsored/.test(c.innerText));
  const imgs = [...el.querySelectorAll('span[role="img"]')].map(s => s.getAttribute('aria-label'));
  return imgs;
});
console.log('rating aria-labels on first organic card:', rating);
await browser.close();
