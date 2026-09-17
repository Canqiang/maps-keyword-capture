import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface FixtureCard { name: string; ad?: boolean; placeId?: string; rating?: string; reviews?: number; category?: string; address?: string; tall?: boolean }
export interface FixtureOptions {
  title?: string; query: string; cards: FixtureCard[]; moreCards?: FixtureCard[];
  endOfList?: boolean; noResults?: boolean; jitterMs?: number;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export function cardHtml(c: FixtureCard, i: number): string {
  const placeId = c.placeId ?? `0x89c2000000000${i.toString(16)}:0x${(i + 1).toString(16).padStart(4, '0')}`;
  const rating = c.rating ?? '4.5';
  const reviews = c.reviews ?? 100 + i;
  const category = c.category ?? 'Bubble tea store';
  const address = c.address ?? `${100 + i} Main St`;
  const href = `https://www.google.com/maps/place/${encodeURIComponent(c.name)}/data=!4m7!3m6!1s${placeId}!8m2!3d40.7!4d-73.6`;
  const label = c.ad ? '<div aria-label="Sponsored" class="lbl"><span>Sponsored</span></div>' : '';
  return `<div class="card${c.tall ? ' tall' : ''}">
    <a href="${esc(href)}" aria-label="${esc(c.name)}"></a>
    ${label}
    <div class="name">${esc(c.name)}</div>
    <div><span role="img" aria-label="${rating} stars">${rating}</span> (${reviews.toLocaleString('en-US')})</div>
    <div>${esc(category)} · ${esc(address)}</div>
    <div>Closed · Opens 9 AM</div>
  </div>
  <div class="sep"></div>`;
}

export function buildFeedFixtureHtml(o: FixtureOptions): string {
  const title = o.title ?? `${o.query} - Google Maps`;
  if (o.noResults) {
    return `<!doctype html><html><head><title>${esc(title)}</title></head><body>
      <input id="searchboxinput" value="${esc(o.query)}">
      <div>Google Maps can't find ${esc(o.query)}</div></body></html>`;
  }
  const initial = o.cards.map(cardHtml).join('\n');
  const more = JSON.stringify((o.moreCards ?? []).map((c, i) => cardHtml(c, o.cards.length + i)));
  return `<!doctype html><html><head><title>${esc(title)}</title>
<style>
  body { margin: 0; width: 1440px; height: 1000px; font: 14px sans-serif; position: relative; }
  #searchboxinput { position: absolute; left: 88px; top: 16px; width: 360px; }
  #feed { position: absolute; left: 72px; top: 80px; width: 408px; height: 875px; overflow-y: auto; }
  .card { height: 210px; box-sizing: border-box; padding: 16px; }
  .card.tall { height: 1200px; }
  .sep { height: 1px; }
  .hdr0 { height: 0; overflow: hidden; } .hdr1 { height: 48px; }
  .trail0 { height: 120px; } .trail1 { height: 104px; }
  .lbl span { font-weight: bold; }
  #map { position: absolute; left: 480px; top: 0; width: 960px; height: 1000px; background: #dfe9d8; }
</style></head><body>
<input id="searchboxinput" value="${esc(o.query)}">
<div id="feed" role="feed">
  <div class="hdr0">Rating Hours All filters</div>
  <div class="hdr1">Results Share</div>
  ${initial}
  <div class="trail0"></div>
  <div class="trail1">You're seeing a limited view of Google Maps. Learn more</div>
</div>
<div id="map"></div>
<script>
  const feed = document.getElementById('feed');
  const more = ${more};
  const endOfList = ${o.endOfList ? 'true' : 'false'};
  let ended = false, pending = false;
  feed.addEventListener('scroll', () => {
    if (pending) return;
    if (feed.scrollTop + feed.clientHeight < feed.scrollHeight - 300) return;
    const trailer = feed.querySelector('.trail0');
    if (more.length > 0) {
      pending = true;
      setTimeout(() => { trailer.insertAdjacentHTML('beforebegin', more.splice(0, more.length).join('')); pending = false; }, 150);
    } else if (endOfList && !ended) {
      ended = true;
      trailer.insertAdjacentHTML('beforebegin', '<div class="end">You\\'ve reached the end of the list.</div>');
    }
  });
  ${o.jitterMs ? `let jitter = 0; const nameEl = feed.querySelector('.card .name'); const baseName = nameEl ? nameEl.textContent : ''; setInterval(() => { if (nameEl) nameEl.textContent = baseName + ' ' + (++jitter); }, ${o.jitterMs});` : ''}
</script></body></html>`;
}

export async function writeFixture(o: FixtureOptions): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mkc-fixture-'));
  const file = join(dir, 'feed.html');
  await writeFile(file, buildFeedFixtureHtml(o), 'utf8');
  return pathToFileURL(file).toString();
}

export function namedCards(count: number, startAt = 0): FixtureCard[] {
  return Array.from({ length: count }, (_, i) => ({ name: `Shop ${String(startAt + i + 1).padStart(2, '0')}` }));
}
