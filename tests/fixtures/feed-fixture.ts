import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface FixtureCard {
  name: string; ad?: boolean; placeId?: string; rating?: string; reviews?: number; category?: string; address?: string; tall?: boolean;
  /** Render the live card's icon-font glyphs (private-use characters) around the action links, as the entry page does. */
  iconGlyphs?: boolean;
  /** Omit the rating line, as a business with no reviews renders. */
  noRating?: boolean;
  /** Extra description line after the category/address line. */
  description?: string;
}
export interface FixtureOptions {
  title?: string; query: string; cards: FixtureCard[]; moreCards?: FixtureCard[];
  endOfList?: boolean; noResults?: boolean; jitterMs?: number;
  /** Which selector carries the query. The live `?api=1&query=` entry page uses `name="q"`. */
  queryInputName?: 'searchboxinput' | 'q';
  /** Render the feed first and fill in the query field and the title only after this delay, as the live entry page does. */
  deferQueryMs?: number;
  /** Live cards that show a review count label the rating "4.8 stars 97 Reviews" rather than "4.8 stars". */
  ratingLabelStyle?: 'stars' | 'stars_reviews';
  /** Replace an already mounted card's name and href when `moreCards` load, as a reordered feed would. */
  replaceCardAtOnScroll?: { index: number; name: string };
  /** Keep repainting the map area every N ms, as unloaded tiles arriving would. */
  mapAnimateMs?: number;
  /** Show Google's first-visit "Collapse side panel" hint over the map and remove it after N ms. */
  transientHintMs?: number;
  /** After N ms, put the map view into the URL the way the live page rewrites it (`@lat,lng,zoomz`). */
  viewInUrlAfterMs?: number;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export function cardHtml(c: FixtureCard, i: number, ratingLabelStyle: 'stars' | 'stars_reviews' = 'stars'): string {
  const placeId = c.placeId ?? `0x89c2000000000${i.toString(16)}:0x${(i + 1).toString(16).padStart(4, '0')}`;
  const rating = c.rating ?? '4.5';
  const reviews = c.reviews ?? 100 + i;
  const category = c.category ?? 'Bubble tea store';
  const address = c.address ?? `${100 + i} Main St`;
  const href = `https://www.google.com/maps/place/${encodeURIComponent(c.name)}/data=!4m7!3m6!1s${placeId}!8m2!3d40.7!4d-73.6`;
  const label = c.ad ? `<div aria-label="Sponsored" class="lbl"><span>Sponsored</span>${c.iconGlyphs ? ' <span>\ue5d4</span>' : ''}</div>` : '';
  const ratingLine = c.noRating
    ? '<div>No reviews</div>'
    : `<div><span role="img" aria-label="${rating} stars${ratingLabelStyle === 'stars_reviews' ? ` ${reviews.toLocaleString('en-US')} Reviews` : ''}">${rating}</span> (${reviews.toLocaleString('en-US')})</div>`;
  const actions = c.iconGlyphs ? '<div><span>\ue80b</span> Website <span>\ue52e</span> Directions</div>' : '';
  return `<div class="card${c.tall ? ' tall' : ''}">
    <a href="${esc(href)}" aria-label="${esc(c.name)}"></a>
    ${label}
    <div class="name">${esc(c.name)}</div>
    ${ratingLine}
    <div>${esc(category)} · ${esc(address)}</div>
    ${c.description ? `<div>${esc(c.description)}</div>` : ''}
    <div>Closed · Opens 9 AM</div>
    ${actions}
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
  const ratingLabelStyle = o.ratingLabelStyle ?? 'stars';
  const initial = o.cards.map((c, i) => cardHtml(c, i, ratingLabelStyle)).join('\n');
  const more = JSON.stringify((o.moreCards ?? []).map((c, i) => cardHtml(c, o.cards.length + i, ratingLabelStyle)));
  const inputHtml = o.queryInputName === 'q'
    ? `<input name="q" type="text" value="${esc(o.query)}">`
    : `<input id="searchboxinput" value="${esc(o.query)}">`;
  const defer = o.deferQueryMs ?? 0;
  const swap = o.replaceCardAtOnScroll
    ? JSON.stringify({
        index: o.replaceCardAtOnScroll.index,
        name: o.replaceCardAtOnScroll.name,
        href: `https://www.google.com/maps/place/${encodeURIComponent(o.replaceCardAtOnScroll.name)}/data=!4m7!3m6!1s0x89c2ffffffffffff:0xffff!8m2!3d40.7!4d-73.6`,
      })
    : 'null';
  return `<!doctype html><html><head><title>${esc(defer ? 'Google Maps' : title)}</title>
<style>
  body { margin: 0; width: 1440px; height: 1000px; font: 14px sans-serif; position: relative; }
  #searchboxinput, input[name="q"] { position: absolute; left: 88px; top: 16px; width: 360px; }
  #feed { position: absolute; left: 72px; top: 80px; width: 408px; height: 875px; overflow-y: auto; }
  .card { height: 210px; box-sizing: border-box; padding: 16px; }
  .card.tall { height: 1200px; }
  .sep { height: 1px; }
  .hdr0 { height: 0; overflow: hidden; } .hdr1 { height: 48px; }
  .trail0 { height: 120px; } .trail1 { height: 104px; }
  .lbl span { font-weight: bold; }
  #map { position: absolute; left: 480px; top: 0; width: 960px; height: 1000px; background: #dfe9d8; }
</style></head><body>
${defer ? '' : inputHtml}
<div id="feed" role="feed">
  <div class="hdr0">Rating Hours All filters</div>
  <div class="hdr1">Results Share</div>
  ${initial}
  <div class="trail0"></div>
  <div class="trail1">You're seeing a limited view of Google Maps. Learn more</div>
</div>
<div id="map"></div>
${o.transientHintMs ? '<span id="hint" style="position:absolute;left:520px;top:490px;background:#000;color:#fff">Collapse side panel</span>' : ''}
<script>
  const feed = document.getElementById('feed');
  const more = ${more};
  const endOfList = ${o.endOfList ? 'true' : 'false'};
  const swap = ${swap};
  const applySwap = () => {
    if (!swap) return;
    const el = feed.querySelectorAll('.card')[swap.index];
    if (!el) return;
    const link = el.querySelector('a');
    link.setAttribute('aria-label', swap.name);
    link.setAttribute('href', swap.href);
    el.querySelector('.name').textContent = swap.name;
  };
  let ended = false, pending = false;
  feed.addEventListener('scroll', () => {
    if (pending) return;
    if (feed.scrollTop + feed.clientHeight < feed.scrollHeight - 300) return;
    const trailer = feed.querySelector('.trail0');
    if (more.length > 0) {
      pending = true;
      setTimeout(() => { trailer.insertAdjacentHTML('beforebegin', more.splice(0, more.length).join('')); applySwap(); pending = false; }, 150);
    } else if (endOfList && !ended) {
      ended = true;
      trailer.insertAdjacentHTML('beforebegin', '<div class="end">You\\'ve reached the end of the list.</div>');
    }
  });
  ${defer ? `setTimeout(() => { document.title = ${JSON.stringify(title)}; document.body.insertAdjacentHTML('afterbegin', ${JSON.stringify(inputHtml)}); }, ${defer});` : ''}
  ${o.transientHintMs ? `setTimeout(() => { const h = document.getElementById('hint'); if (h) h.remove(); }, ${o.transientHintMs});` : ''}
  ${o.viewInUrlAfterMs ? `setTimeout(() => { location.hash = '@40.7336673,-73.648544,14z'; }, ${o.viewInUrlAfterMs});` : ''}
  ${o.mapAnimateMs ? `let hue = 0; const mapEl = document.getElementById('map'); setInterval(() => { hue = (hue + 37) % 360; mapEl.style.background = 'hsl(' + hue + ', 60%, 80%)'; }, ${o.mapAnimateMs});` : ''}
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
