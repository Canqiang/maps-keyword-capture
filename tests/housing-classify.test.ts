import { describe, expect, it } from 'vitest';
import { classifyCard } from '../src/core/classify.js';
import { housingFixtures, housingRaw } from './fixtures/housing-fixture.js';

const pane = { x: 72, y: 80, width: 408, height: 875 };
describe.each([0, 1] as const)('evidenced housing result %s', index => {
  const item = housingFixtures[index];
  const classify = (over = {}) => classifyCard(housingRaw(index, over), pane, 'o1');
  it('recognizes persisted text with its actual visible category and no invented fields', () => {
    const card = classify();
    expect(card.classification).toEqual({ resultType: 'organic', adLabel: null, organicRank: null });
    expect(card.parsed).toEqual({ placeId: item.placeId, category: item.category, rating: null, reviewCount: null, address: null });
  });
  it('accepts matching reconstructed lines and repeated or single business-name prefixes', () => {
    expect(classify({ lines: [...item.lines] }).classification.resultType).toBe('organic');
    expect(classify({ text: item.lines.join(' '), lines: [...item.lines] }).classification.resultType).toBe('organic');
  });
  it('keeps owned Sponsored labels as ads with their observed categories', () => {
    expect(classify({ text: `Sponsored ${item.text}`, lines: ['Sponsored', ...item.lines], sponsoredLabels: [{ text: 'Sponsored', ownerAriaLabel: 'Sponsored', depth: 3 }] })).toMatchObject({ classification: { resultType: 'ad', adLabel: 'Sponsored', organicRank: null }, parsed: { category: item.category } });
  });
  it.each(['Sponsored', 'Ad', 'Advertisement', 'Unverified metadata', 'Free breakfast'])('leaves unrecognized or unowned %s text unknown', suffix => {
    expect(classify({ text: `${item.text} ${suffix}` }).classification.resultType).toBe('unknown');
    expect(classify({ lines: [...item.lines, suffix] }).classification.resultType).toBe('unknown');
  });
  it('does not bypass contradictory rendered category, amenities or label evidence', () => {
    expect(classify({ lines: item.lines.map(line => line === item.category ? 'Cottage' : line) }).classification.resultType).toBe('unknown');
    expect(classify({ lines: [...item.lines.slice(0, -1)] }).classification.resultType).toBe('unknown');
    expect(classify({ lines: [item.name, item.category] }).classification.resultType).toBe('unknown');
    expect(classify({ sponsoredLabels: [{ text: 'Advertisement', ownerAriaLabel: null, depth: 2 }] }).classification.resultType).toBe('unknown');
  });
  it.each([null, '', 'not a URL', 'http://www.google.com/maps/place/test/', 'https://evil.test/maps/place/test/', 'https://www.google.com.evil.test/maps/place/test/', 'https://user:pass@google.com/maps/place/test/', 'https://www.google.com:444/maps/place/test/', 'https://www.google.com/maps/search/test/', 'https://www.google.com/maps/place/'])('requires a valid Google place URL %s', placeHref => {
    expect(classify({ placeHref }).classification.resultType).toBe('unknown');
  });
  it.each([null, '', 'Different business', 'House', 'Lodging'])('requires a distinct matching business name %s', placeAriaLabel => {
    expect(classify({ placeAriaLabel }).classification.resultType).toBe('unknown');
  });
});

it.each([
  'House', 'House Sleeps 5', 'House Sleeps 5 • 2 bedrooms • 3 beds',
  'House Sleeps 0 • 2 bedrooms • 3 beds Directions Pool',
  'House Sleeps 5 • 0 bedrooms • 3 beds Directions Pool',
  'House Sleeps 5 • 2 bedrooms • 0 beds Directions Pool',
  'House Sleeps 5 • 2 bedrooms • 3 beds Directions',
  'House Sleeps 5 • 2 bedrooms • 3 beds Website Pool',
  'Cottage Sleeps 5 • 2 bedrooms • 3 beds Directions Pool',
  'House Sleeps 5 • 2 bedrooms • 3 beds Directions Free Wi-Fi',
])('requires evidenced House occupancy, actions and amenity vocabulary: %s', body => {
  const text = `${housingFixtures[0].name} ${body}`;
  expect(classifyCard(housingRaw(0, { text }), pane, 'o1').classification.resultType).toBe('unknown');
});

it('accepts the House action without Website but never infers category from its Apartment name', () => {
  const raw = housingRaw(0, { text: housingFixtures[0].text.replace('Website ', '') });
  expect(classifyCard(raw, pane, 'o1')).toMatchObject({ classification: { resultType: 'organic' }, parsed: { category: 'House' } });
});

it.each(['Lodging Directions', 'Lodging Free parking', 'Lodging Website Directions Free parking', 'Lodging Directions Kitchen', 'Cottage Directions Free Wi-Fi'])('requires evidenced Lodging actions and amenity vocabulary: %s', body => {
  const text = `${housingFixtures[1].name} ${body}`;
  expect(classifyCard(housingRaw(1, { text }), pane, 'o1').classification.resultType).toBe('unknown');
});
