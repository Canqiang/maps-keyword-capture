import { describe, expect, it } from 'vitest';
import {
  classifyCard, isAd, parseCategoryAndAddress, parsePlaceIdentity, parseRating, parseReviewCount,
} from '../src/core/classify.js';
import type { RawFeedChild } from '../src/core/types.js';

const pane = { x: 72, y: 80, width: 408, height: 875 };
const gongChaHref = 'https://www.google.com/maps/place/Gong+Cha/data=!4m7!3m6!1s0x89c27d7c24719ab1:0x39bbfdecff1952fe!8m2!3d40.738531!4d-73.613626!16s%2Fg%2F11g6';

function raw(over: Partial<RawFeedChild>): RawFeedChild {
  return {
    index: 4, tag: 'DIV', heightPx: 230, bounds: { x: 72, y: 300, width: 408, height: 230 },
    placeHref: 'https://www.google.com/maps/place/Kyuramen+x+TBAAR+-+Garden+City/data=!4m7!3m6!1s0x89c27d2e04771bd1:0xfbb18eba1ef9912f!8m2!3d40.7292853!4d-73.6',
    placeAriaLabel: 'Kyuramen x TBAAR - Garden City', ratingAriaLabel: '4.8 stars',
    text: 'Kyuramen x TBAAR - Garden City Kyuramen x TBAAR - Garden City 4.8 (1,592) Bubble tea store · · 988 Franklin Ave Closed · Opens 11 AM Thu · (516) 385-8887 Order online',
    sponsoredLabels: [],
    ...over,
  };
}

describe('parsers', () => {
  it('extracts place identity from the href', () => {
    expect(parsePlaceIdentity(gongChaHref)).toEqual({ placeId: '0x89c27d7c24719ab1:0x39bbfdecff1952fe', placeKey: '0x89c27d7c24719ab1:0x39bbfdecff1952fe' });
    expect(parsePlaceIdentity('https://www.google.com/maps/place/X/data=!19sChIJabc_DEF-123')).toEqual({ placeId: 'ChIJabc_DEF-123', placeKey: 'ChIJabc_DEF-123' });
    expect(parsePlaceIdentity('https://www.google.com/maps/place/Only+Name/')).toEqual({ placeId: null, placeKey: '/maps/place/Only+Name/' });
  });

  it('parses rating, review count, category, and address', () => {
    expect(parseRating('4.8 stars')).toBe(4.8);
    expect(parseRating('5.0 stars')).toBe(5);
    expect(parseRating(null)).toBeNull();
    expect(parseRating('Wheelchair accessible entrance')).toBeNull();
    expect(parseReviewCount('Gong Cha 3.9 (217) Bubble tea store')).toBe(217);
    expect(parseReviewCount('Name 4.8 (1,592) Cafe')).toBe(1592);
    expect(parseReviewCount('Name 4.8 Cafe · (516) 690-8378')).toBeNull();
    expect(parseCategoryAndAddress(raw({}).text, 'Kyuramen x TBAAR - Garden City')).toEqual({ category: 'Bubble tea store', address: '988 Franklin Ave' });
    expect(parseCategoryAndAddress('Chai Shop 4.6 (81) Bubble tea store · 751 Hillside Ave. Closed · Opens 12 PM Thu', 'Chai Shop')).toEqual({ category: 'Bubble tea store', address: '751 Hillside Ave.' });
    expect(parseCategoryAndAddress('Nothing useful', 'Nothing useful')).toEqual({ category: null, address: null });
  });
});

describe('classifyCard', () => {
  it('classifies a Sponsored card as an ad with evidence and no organic rank', () => {
    const card = classifyCard(raw({
      index: 2, placeHref: gongChaHref, placeAriaLabel: 'Gong Cha', ratingAriaLabel: '3.9 stars',
      text: 'Gong Cha Sponsored Gong Cha 3.9 (217) Bubble tea store · 630 Old Country Road Closed · Opens 11 AM Thu',
      sponsoredLabels: [{ text: 'Sponsored', ownerAriaLabel: 'Sponsored', depth: 6 }],
    }), pane, 'qa01_obs001');
    expect(card.classification).toEqual({ resultType: 'ad', adLabel: 'Sponsored', organicRank: null });
    expect(card.classificationEvidence.source).toBe('card_label');
    expect(card.classificationEvidence.owner).toBe('feed-child:2');
    expect(card.classificationEvidence.observationIds).toEqual(['qa01_obs001']);
    expect(card.businessKey).toBe('0x89c27d7c24719ab1:0x39bbfdecff1952fe');
    expect(card.parsed).toEqual({ placeId: '0x89c27d7c24719ab1:0x39bbfdecff1952fe', rating: 3.9, reviewCount: 217, category: 'Bubble tea store', address: '630 Old Country Road' });
    expect(isAd(card)).toBe(true);
  });

  it('classifies a recognized card without label as organic', () => {
    const card = classifyCard(raw({}), pane, 'qa01_obs001');
    expect(card.classification).toEqual({ resultType: 'organic', adLabel: null, organicRank: null });
    expect(card.classificationEvidence.source).toBe('supported_layout');
    expect(card.name).toBe('Kyuramen x TBAAR - Garden City');
    expect(card.parsed.reviewCount).toBe(1592);
    expect(card.fullyVisible).toBe(true);
  });

  it('marks a card with missing name or unparseable layout as unknown', () => {
    const card = classifyCard(raw({ placeAriaLabel: null, ratingAriaLabel: null, text: '' }), pane, 'qa01_obs001');
    expect(card.classification.resultType).toBe('unknown');
    expect(card.classificationEvidence.source).toBe('unresolved');
  });

  it('gives the same business different occurrence ids as ad and organic', () => {
    const ad = classifyCard(raw({ index: 2, placeHref: gongChaHref, placeAriaLabel: 'Gong Cha', sponsoredLabels: [{ text: 'Sponsored', ownerAriaLabel: 'Sponsored', depth: 6 }] }), pane, 'o1');
    const organic = classifyCard(raw({ index: 22, placeHref: gongChaHref, placeAriaLabel: 'Gong Cha' }), pane, 'o1');
    expect(ad.occurrenceId).not.toBe(organic.occurrenceId);
    expect(ad.businessKey).toBe(organic.businessKey);
    expect(ad.fingerprint).not.toBe(organic.fingerprint);
  });

  it('computes fullyVisible against the pane', () => {
    const cut = classifyCard(raw({ bounds: { x: 72, y: 900, width: 408, height: 230 } }), pane, 'o1');
    expect(cut.fullyVisible).toBe(false);
  });
});
