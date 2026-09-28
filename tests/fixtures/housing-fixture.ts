import type { RawFeedChild } from '../../src/core/types.js';
import { buildFeedFixtureHtml, cardHtml, type FixtureCard } from './feed-fixture.js';

/**
 * Visible field reconstruction from 2026-09-28 17:33:21 +08:00 UAT float,
 * run_20260928T093303Z_af5793 / att_fc6e8f0e / q0002 / qa01.
 * JSON SHA-256 211171e276ffcae849817996840116547788c11183e1f2cbeaf286244831a804;
 * screenshot __03 SHA-256 3fb90acbeab00a2344f2cfe1d9c91b365c1205b7d8a1fe68b3eed1046438f38c.
 * Normalized rawText and original screenshot independently read back from Azure.
 * Raw DOM/rendered lines were not persisted; the DOM below is reconstructed.
 * Other rows and every advertisement variant are synthetic test data.
 */
export const housingFixtures = [
  {
    "name": "Urban Float - Two-Bedroom Apartment with Private Pool",
    "href": "https://www.google.com/maps/place/Urban+Float+-+Two-Bedroom+Apartment+with+Private+Pool/data=!4m11!3m10!1s0x871345a0c24487a1:0x81201cf7b1c2729f!5m2!4m1!1i2!8m2!3d38.8450317!4d-104.7968216!16s%2Fg%2F11nw53vb3n!17BQ0FF!19sChIJoYdEwqBFE4cRn3LCsfccIIE?authuser=0&hl=en&g_ep=EgoyMDI2MDkyMy4wIJJjKgBIAVAD&rclk=1",
    "text": "Urban Float - Two-Bedroom Apartment with Private Pool Urban Float - Two-Bedroom Apartment with Private Pool House Sleeps 5 • 2 bedrooms • 3 beds Website Directions Pool Free parking Air-conditioned Kitchen",
    "lines": [
      "Urban Float - Two-Bedroom Apartment with Private Pool",
      "House",
      "Sleeps 5 • 2 bedrooms • 3 beds",
      "Website Directions",
      "Pool",
      "Free parking",
      "Air-conditioned",
      "Kitchen"
    ],
    "category": "House",
    "position": 8,
    "placeId": "0x871345a0c24487a1:0x81201cf7b1c2729f"
  },
  {
    "name": "Ritz-Carlton Club 2 Bd 04 Float | Ski-in/Ski-out in Aspen Highlands",
    "href": "https://www.google.com/maps/place/Ritz-Carlton+Club+2+Bd+04+Float+%7C+Ski-in%2FSki-out+in+Aspen+Highlands/data=!4m11!3m10!1s0x8740391b1e65695b:0x5d160af13c31ca6!5m2!4m1!1i2!8m2!3d39.1822013!4d-106.8563309!16s%2Fg%2F11zxtpd6j6!17BQ0FF!19sChIJW2llHhs5QIcRphzDE69g0QU?authuser=0&hl=en&g_ep=EgoyMDI2MDkyMy4wIJJjKgBIAVAD&rclk=1",
    "text": "Ritz-Carlton Club 2 Bd 04 Float | Ski-in/Ski-out in Aspen Highlands Ritz-Carlton Club 2 Bd 04 Float | Ski-in/Ski-out in Aspen Highlands Lodging Directions Free parking Free Wi-Fi Air-conditioned Wi-Fi",
    "lines": [
      "Ritz-Carlton Club 2 Bd 04 Float | Ski-in/Ski-out in Aspen Highlands",
      "Lodging",
      "Directions",
      "Free parking",
      "Free Wi-Fi",
      "Air-conditioned",
      "Wi-Fi"
    ],
    "category": "Lodging",
    "position": 11,
    "placeId": "0x8740391b1e65695b:0x5d160af13c31ca6"
  }
] as const;
export function housingRaw(index: 0 | 1, over: Partial<RawFeedChild> = {}): RawFeedChild {
  const item = housingFixtures[index];
  return { index: item.position * 2, tag: 'DIV', heightPx: 200, bounds: { x: 72, y: 200, width: 408, height: 200 }, placeHref: item.href, placeAriaLabel: item.name, ratingAriaLabel: null, text: item.text, sponsoredLabels: [], ...over };
}
function esc(text: string): string { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
export function buildHousingFeedFixture(variant: 'organic' | 'ad' | 'unresolved'): string {
  const cards: FixtureCard[] = Array.from({ length: 15 }, (_, i) => ({ name: `Float housing fixture ${i + 1}`, category: 'Spa' }));
  let html = buildFeedFixtureHtml({ query: 'float', cards, endMarkerInitially: true });
  for (const item of housingFixtures) {
    const label = variant === 'ad' ? '<div aria-label="Sponsored"><span>Sponsored</span></div>' : variant === 'unresolved' ? '<div>Advertisement</div>' : '';
    const replacement = `<div class="card"><a href="${esc(item.href)}" aria-label="${esc(item.name)}"></a>${label}${item.lines.map(line => `<div>${esc(line)}</div>`).join('')}</div><div class="sep"></div>`;
    html = html.replace(cardHtml(cards[item.position - 1]!, item.position - 1), replacement);
  }
  return html;
}
