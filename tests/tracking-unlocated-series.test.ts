import { describe, expect, it } from 'vitest';
import { createFrontendModel } from '../src/web/frontend-model.js';

const model = createFrontendModel();
const row = (id: string, at: string, extra: Record<string, unknown> = {}) => ({
  observationId: id, observedAt: at, localDate: at.slice(0, 10),
  keyword: '法拉盛 卤味外卖', keywordKey: '法拉盛 卤味外卖',
  storeId: 'keke-flushing', placeId: 'keke-place', surface: 'web', pointId: 'r0c0',
  locationMode: 'query_only', source: { profileHash: 'daily-profile', adapterVersion: 'maps-feed-card/v6' },
  eligible: true, metricOrganicRank: 6, cohortKey: null,
  rank: { status: 'ranked', organicRank: 6 }, ...extra,
});
const a = () => row('a', '2026-11-13T00:00:00Z');
const b = (extra: Record<string, unknown> = {}) => row('b', '2026-11-13T02:00:00Z', extra);
const c = () => row('c', '2026-11-13T04:00:00Z');
const ids = (rows: ReturnType<typeof row>[], maxGapHours?: number) => model.unlocatedSeries(rows, maxGapHours).map(group => group.map(o => o.observationId));

describe('unlocated observational trend segments', () => {
  it('connects same-method intraday observations without qualifying geographic comparisons', () => {
    const rows = [a(), b({ metricOrganicRank: 5, rank: { status: 'ranked', organicRank: 5 } }), c()];
    const before = JSON.stringify(rows);
    expect(ids(rows)).toEqual([['a', 'b', 'c']]);
    expect(ids([...rows].reverse())).toEqual([['a', 'b', 'c']]);
    expect(JSON.stringify(rows)).toBe(before);
    expect(model.series(rows)).toEqual([]);
    expect(model.segments(rows)).toEqual([]);
    expect(model.compare(rows[0], rows[1]).delta).toBeNull();
    expect(model.movement(rows).delta).toBeNull();
    expect(rows.every(o => o.cohortKey === null)).toBe(true);
  });

  it.each([
    ['storeId', 'other-store'], ['placeId', 'other-place'], ['surface', 'android'],
    ['pointId', 'other-point'], ['keywordKey', 'other keyword'],
  ])('breaks when %s changes and does not bridge back to an earlier identity', (field, value) => {
    expect(ids([a(), b({ [field]: value }), c()])).toEqual([['a'], ['b'], ['c']]);
  });

  it.each(['profileHash', 'adapterVersion'])('breaks when source.%s changes', field => {
    expect(ids([a(), b({ source: { ...a().source, [field]: 'changed' } }), c()])).toEqual([['a'], ['b'], ['c']]);
  });

  it.each(['storeId', 'placeId', 'surface', 'pointId', 'keywordKey'])('does not bridge an observation with missing %s', field => {
    expect(ids([a(), b({ [field]: '' }), c()])).toEqual([['a'], ['c']]);
    expect(ids([a(), b({ [field]: undefined }), c()])).toEqual([['a'], ['c']]);
  });

  it.each([undefined, null, {}, { profileHash: 'daily-profile', adapterVersion: null }, { profileHash: ' ', adapterVersion: 'maps-feed-card/v6' }])('requires complete provenance: %j', source => {
    expect(ids([a(), b({ source }), c()])).toEqual([['a'], ['c']]);
  });

  it.each(['failed', 'blocked', 'not_found', 'not_evaluated', 'ad_only', 'unreliable'])('breaks at %s even if a stale numeric metric is present', status => {
    expect(ids([a(), b({ rank: { status, organicRank: 6 } }), c()])).toEqual([['a'], ['c']]);
  });

  it.each([null, 0, -1, 1.5, NaN, Infinity])('breaks at invalid numeric rank %j', metricOrganicRank => {
    expect(ids([a(), b({ metricOrganicRank }), c()])).toEqual([['a'], ['c']]);
  });

  it('breaks at unqualified observations, mode changes and absent observations', () => {
    for (const extra of [{ eligible: false }, { locationMode: 'map_view', cohortKey: 'located' }, { locationMode: undefined }, { metricOrganicRank: null, rank: { status: 'not_found', organicRank: null } }]) {
      expect(ids([a(), b(extra), c()])).toEqual([['a'], ['c']]);
    }
  });

  it('connects legacy daily observations but breaks over a missing day or a configured shorter gap', () => {
    const nextDay = row('next-day', '2026-11-14T00:00:00Z');
    const afterGap = row('after-gap', '2026-11-16T00:00:00Z');
    expect(ids([a(), nextDay, afterGap])).toEqual([['a', 'next-day'], ['after-gap']]);
    expect(ids([a(), b(), c()], 1)).toEqual([['a'], ['b'], ['c']]);
  });

  it('does not connect equal timestamps and breaks at malformed timestamps', () => {
    expect(ids([a(), row('same', a().observedAt), b()])).toEqual([['a'], ['same', 'b']]);
    expect(ids([a(), row('invalid', '2026-11-13T01:invalid'), b()])).toEqual([['a'], ['b']]);
  });

  it('orders equivalent timestamp representations by their actual instant', () => {
    const offset = row('offset', '2026-11-12T21:00:00-04:00');
    expect(ids([b(), offset, a()])).toEqual([['a', 'offset', 'b']]);
  });
});
