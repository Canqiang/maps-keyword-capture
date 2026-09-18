import { buildFeedFixtureHtml, cardHtml, type FixtureCard } from './feed-fixture.js';

/**
 * Constructed DOM fixture, not captured Google HTML. The second card's visible
 * fields come from the 2026-09-18 spa screenshot/normalized observation; the
 * remaining 14 cards, layout and control labels are synthetic test data.
 */
export function buildLodgingFeedFixture(variant: 'organic' | 'ad' | 'unresolved'): string {
  const cards: FixtureCard[] = Array.from({ length: 15 }, (_, i) => ({ name: `Spa fixture shop ${i + 1}`, category: 'Spa' }));
  const name = 'Blue Stone Chateau Yosemite Pool Spa Secluded - Deluxe Villa';
  const label = variant === 'ad' ? '<div aria-label="Sponsored"><span>Sponsored</span></div>' : variant === 'unresolved' ? '<div>Advertisement</div>' : '';
  const replacement = `<div class="card">
    <a href="https://www.google.com/maps/place/Blue+Stone+Chateau/data=!1s0x8740000000003871:0x455c5fb70faed4eb" aria-label="${name}"></a>
    ${label}<div class="name">${name}</div><div>Lodging</div>
  </div>
  <div class="sep"></div>`;
  return buildFeedFixtureHtml({ query: 'spa', cards, endMarkerInitially: true })
    .replace(cardHtml(cards[1]!, 1), replacement);
}
