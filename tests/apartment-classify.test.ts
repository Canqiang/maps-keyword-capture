import { describe, expect, it } from 'vitest';
import { classifyCard } from '../src/core/classify.js';
import { apartmentName, apartmentRaw, apartmentText } from './fixtures/apartment-fixture.js';

const pane = { x: 72, y: 80, width: 408, height: 875 };
describe('verified Apartment vacation-rental card shape', () => {
  it('recognizes the actual persisted text without inventing reviews, rating or address', () => {
    const card = classifyCard(apartmentRaw(), pane, 'o1');
    expect(card.classification).toEqual({ resultType: 'organic', adLabel: null, organicRank: null });
    expect(card.parsed).toEqual({ placeId: '0x871345a0c25ab8b5:0x817a05bd5661a2e9', category: 'Apartment', rating: null, reviewCount: null, address: null });
  });
  it('recognizes equivalent rendered lines and a single business name', () => {
    const lines = [apartmentName, 'Apartment', 'Sleeps 4 • 2 bedrooms • 2 beds', 'Directions', 'Pool', 'Hot tub', 'Free parking', 'Air-conditioned'];
    expect(classifyCard(apartmentRaw({ text: lines.join(' '), lines }), pane, 'o1').classification.resultType).toBe('organic');
  });
  it('keeps card-owned Sponsored precedence and the supported category', () => {
    const raw = apartmentRaw({ text: `Sponsored ${apartmentText}`, sponsoredLabels: [{ text: 'Sponsored', ownerAriaLabel: 'Sponsored', depth: 3 }] });
    const card = classifyCard(raw, pane, 'o1');
    expect(card.classification).toEqual({ resultType: 'ad', adLabel: 'Sponsored', organicRank: null });
    expect(card.parsed.category).toBe('Apartment');
  });
  it.each([
    `${apartmentName} Apartment`,
    `${apartmentName} Apartment Sleeps 4`,
    `${apartmentName} Apartment Sleeps 4 • 2 bedrooms • 2 beds`,
    apartmentText.replace('Sleeps 4', 'Sleeps 0'),
    apartmentText.replace('2 bedrooms', '0 bedrooms'),
    apartmentText.replace('Apartment', 'House'),
    apartmentText.replace(apartmentName, 'Another Business'),
    apartmentText.replace('Apartment', 'Apartment Sponsored'),
    apartmentText.replace('Directions', 'Ad Directions'),
    `${apartmentText} Advertisement`,
    `${apartmentText} Unverified metadata`,
    `${apartmentText} Free breakfast`,
  ])('keeps unsupported or ambiguous text unknown: %s', text => expect(classifyCard(apartmentRaw({ text }), pane, 'o1').classification.resultType).toBe('unknown'));
  it.each([null, '', 'not a URL', 'http://www.google.com/maps/place/Apartment/', 'https://evil.test/maps/place/Apartment/', 'https://www.google.com.evil.test/maps/place/Apartment/', 'https://user:pass@google.com/maps/place/Apartment/', 'https://www.google.com/maps/search/Apartment/', 'https://www.google.com/maps/place/'])('rejects invalid place links %s', placeHref => {
    expect(classifyCard(apartmentRaw({ placeHref }), pane, 'o1').classification.resultType).toBe('unknown');
  });
  it.each([null, '', 'Different Business', 'Apartment'])('requires the matching distinct business name %s', placeAriaLabel => {
    expect(classifyCard(apartmentRaw({ placeAriaLabel }), pane, 'o1').classification.resultType).toBe('unknown');
  });
  it('keeps unowned or contradictory label observations unresolved', () => {
    expect(classifyCard(apartmentRaw({ sponsoredLabels: [{ text: 'Advertisement', ownerAriaLabel: null, depth: 1 }] }), pane, 'o1').classification.resultType).toBe('unknown');
    expect(classifyCard(apartmentRaw({ lines: [apartmentName, 'Sponsored', 'Apartment', 'Sleeps 4 • 2 bedrooms • 2 beds', 'Directions', 'Pool'] }), pane, 'o1').classification.resultType).toBe('unknown');
    expect(classifyCard(apartmentRaw({ lines: [apartmentName, 'Apartment', 'Sleeps 4 • 2 bedrooms • 2 beds', 'Directions', 'Unverified metadata'] }), pane, 'o1').classification.resultType).toBe('unknown');
  });
});
