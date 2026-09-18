import { describe, expect, it } from 'vitest';
import type { ExpectedArea } from '../src/contracts.js';

import { assessGeographicRelevance as assess } from '../src/core/geography.js';

const area: ExpectedArea = { label: 'Mineola, NY', latitude: 40.75, longitude: -73.64, radiusKm: 10, source: 'Verified test registry' };
const place = (latitude: number, longitude: number) => `https://www.google.com/maps/place/Store/@0,0,2z/data=!4m2!3d${latitude}!4d${longitude}`;
const inside = place(40.75, -73.64);
const outside = place(32.66, -95.49);

describe('passive geographic relevance', () => {
  it('stays unverified without an expected area even when a place is geolocated', () => {
    expect(assess(undefined, [inside], 'observed_listings')).toMatchObject({ status: 'unverified', expectedArea: null, reason: 'expected_area_not_configured' });
  });
  it('compares actual place coordinates rather than the unrelated @ map viewport', () => {
    expect(assess(area, [inside], 'observed_listings')).toEqual({ status: 'matched', expectedArea: area, scope: 'observed_listings', checkedCount: 1, insideCount: 1, outsideCount: 0, unknownCount: 0, reason: 'all_observed_places_inside' });
    expect(assess(area, [outside], 'detail_place')).toMatchObject({ status: 'outside', scope: 'detail_place', checkedCount: 1, outsideCount: 1 });
  });
  it('reports proven mixed geography while preserving unknown listings', () => {
    expect(assess(area, [inside, outside, null], 'observed_listings')).toMatchObject({ status: 'mixed', checkedCount: 2, insideCount: 1, outsideCount: 1, unknownCount: 1 });
  });
  it.each([inside, outside])('does not generalize a partial coordinate sample to the whole list', url => {
    expect(assess(area, [url, null], 'observed_listings')).toMatchObject({ status: 'unverified', checkedCount: 1, unknownCount: 1, reason: 'incomplete_coordinates' });
  });
  it('does not turn zero observations into a geographic match', () => {
    expect(assess(area, [], 'observed_listings')).toMatchObject({ status: 'unverified', checkedCount: 0, reason: 'no_observations' });
  });
  it.each([
    null, '', 'not a URL', 'https://www.google.com/maps/place/Store/@40.75,-73.64,15z',
    'https://www.google.com/maps/search/Store/data=!3d40.75!4d-73.64',
    'https://www.google.com.evil.test/maps/place/Store/data=!3d40.75!4d-73.64',
    'https://evil.test/maps/place/Store/data=!3d40.75!4d-73.64',
    'https://user:pass@www.google.com/maps/place/Store/data=!3d40.75!4d-73.64',
    'http://www.google.com/maps/place/Store/data=!3d40.75!4d-73.64',
    'https://www.google.com/maps/place/Store?unrelated=!3d40.75!4d-73.64',
    'https://www.google.com/maps/place/Store%213d40.75%214d-73.64',
    `${inside}!3d32.66!4d-95.49`, `${inside}!3d91!4d-73.64`,
    'https://www.google.com/maps/place/Store/data=!3dNaN!4d-73.64',
    'https://www.google.com/maps/place/Store/data=!3d40.75!4d-181',
  ])('leaves unsafe, absent, viewport-only or ambiguous coordinates unverified: %s', url => {
    expect(assess(area, [url], 'observed_listings')).toMatchObject({ status: 'unverified', checkedCount: 0, unknownCount: 1, reason: 'incomplete_coordinates' });
  });
  it('accepts identical repeated coordinate pairs without inventing ambiguity', () => {
    expect(assess(area, [`${inside}!3d40.750!4d-73.640`], 'observed_listings').status).toBe('matched');
  });
  it('handles the date line and polar distances as distances on a sphere', () => {
    const dateline = { ...area, latitude: 0, longitude: 179.99, radiusKm: 5 };
    expect(assess(dateline, [place(0, -179.99)], 'observed_listings').status).toBe('matched');
    const polar = { ...area, latitude: 89.99, longitude: 0, radiusKm: 5 };
    expect(assess(polar, [place(89.99, 180)], 'observed_listings').status).toBe('matched');
  });
  it('distinguishes nearby places beyond a small radius', () => {
    expect(assess({ ...area, radiusKm: 1 }, [place(40.77, -73.64)], 'observed_listings').status).toBe('outside');
  });
});
