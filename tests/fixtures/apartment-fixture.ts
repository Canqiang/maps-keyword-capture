import type { RawFeedChild } from '../../src/core/types.js';
import { buildFeedFixtureHtml, cardHtml, type FixtureCard } from './feed-fixture.js';

/**
 * Reconstructed from the 2026-09-23 10:07:44 +08:00 UAT `float` query's
 * screenshot __02 and persisted collapsed text, not captured Google DOM.
 * Evidence: run_20260923T020724Z_b74050 / att_9a923f60 / q0002 / qa01,
 * result SHA-256 fb6c83cb1ce0a9864e68268d76b443632fac2f964767cc973d3061101a4dfaa5,
 * screenshot SHA-256 7b5501124a842be6bcc4a281044213d050e84c0ddf855c5659edfcda9b9fa6e3.
 * Observations retained normalized rawText but not raw DOM or rendered lines.
 */
export const apartmentName = 'Urban Float - Private Heated Pool HotTub Firepit';
export const apartmentHref = 'https://www.google.com/maps/place/Urban+Float+-+Private+Heated+Pool+HotTub+Firepit/data=!4m11!3m10!1s0x871345a0c25ab8b5:0x817a05bd5661a2e9!5m2!4m1!1i2!8m2!3d38.8450203!4d-104.7968064!16s%2Fg%2F11xc__8ccw!17BQ0FF!19sChIJtbhawqBFE4cR6aJhVr0FeoE';
export const apartmentText = `${apartmentName} ${apartmentName} Apartment Sleeps 4 • 2 bedrooms • 2 beds Directions Pool Hot tub Free parking Air-conditioned`;
export function apartmentRaw(over: Partial<RawFeedChild> = {}): RawFeedChild {
  return { index: 20, tag: 'DIV', heightPx: 140, bounds: { x: 72, y: 660, width: 408, height: 140 }, placeHref: apartmentHref, placeAriaLabel: apartmentName, ratingAriaLabel: null, text: apartmentText, sponsoredLabels: [], ...over };
}
/** Other rows, card wrapper/DOM and all ad variants are synthetic test data. */
export function buildApartmentFeedFixture(variant: 'organic' | 'ad' | 'unresolved'): string {
  const cards: FixtureCard[] = Array.from({ length: 15 }, (_, i) => ({ name: `Float fixture shop ${i + 1}`, category: 'Spa' }));
  const label = variant === 'ad' ? '<div aria-label="Sponsored"><span>Sponsored</span></div>' : variant === 'unresolved' ? '<div>Advertisement</div>' : '';
  const replacement = `<div class="card">
    <a href="${apartmentHref}" aria-label="${apartmentName}"></a>
    ${label}<div class="name">${apartmentName}</div><div>Apartment</div>
    <div>Sleeps 4 • 2 bedrooms • 2 beds</div><div>Directions</div>
    <div>Pool</div><div>Hot tub</div><div>Free parking</div><div>Air-conditioned</div>
  </div><div class="sep"></div>`;
  return buildFeedFixtureHtml({ query: 'float', cards, endMarkerInitially: true }).replace(cardHtml(cards[9]!, 9), replacement);
}
