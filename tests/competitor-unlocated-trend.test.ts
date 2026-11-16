import { describe, expect, it } from 'vitest';
import { createCompetitorPresentation, COMPETITOR_SCRIPT } from '../src/web/competitor-view.js';
import { createCompetitorMetricsModel } from '../src/web/competitor-metrics.js';
import type { competitorHistory } from '../src/web/competitors.js';

type History = ReturnType<typeof competitorHistory>;
type Row = History['rows'][number];
const view = createCompetitorPresentation();
const scope = ['keke', 'ChIJOwn', 'web', 'duck neck'];
const profile = ['profile-a', 'maps-feed-card/v6', 'query_only'];
const row = (id: string, time: string, rank: number | null = 4, extra: Partial<Row> = {}): Row => ({
  observationId: id, observedAt: time, localDate: time.slice(0, 10), pointId: 'r0c0',
  parentScanId: null, scopeKey: JSON.stringify(scope), profile: JSON.stringify(profile),
  metricEligible: false, organicCoverage: 15, endOfResults: false, cohortKey: null,
  geography: 'unverified', eligible: true, completeListingIndex: true, indexedListings: 15, listingsObserved: 15,
  values: [{ placeId: 'ChIJRival', organicRank: rank, adDisplayPositions: [] }], ...extra,
});
const a = () => row('a', '2026-11-10T00:00:00Z', 4);
const b = (extra: Partial<Row> = {}) => row('b', '2026-11-10T02:00:00Z', 2, extra);
const c = () => row('c', '2026-11-10T04:00:00Z', 3);
const history = (rows: Row[]): History => ({ businesses: [
  { placeId: 'ChIJRival', name: 'Rival', appearances: rows.length },
  { placeId: 'ChIJOther', name: 'Other', appearances: rows.length },
], rows });
const chart = (rows: Row[], selected = ['ChIJRival']) => view.chart(history(rows), selected, id => '#'+id, time => time);
const dashed = (html: string) => html.match(/<line class="competitor-unlocated-line"[^>]*>/g) ?? [];
const solid = (html: string) => html.match(/<line x1="[^"]+" y1="[^"]+" x2="[^"]+" y2="[^"]+" stroke="#[^"]+" stroke-width="2"\/>/g) ?? [];

describe('unlocated competitor observational lines', () => {
  it('connects same-method unlocated ranks as same-color dashed lines without making a cohort', () => {
    const rows = [a(), b(), c()], before = structuredClone(rows);
    const html = chart(rows);
    expect(dashed(html)).toHaveLength(2);
    for (const line of dashed(html)) expect(line).toContain('stroke="#6d3bd1" stroke-width="2" stroke-dasharray="4 3"');
    expect(solid(html)).toHaveLength(0);
    expect(html).toContain('同色虚线仅表示未定位观测趋势，地域未核实');
    expect(COMPETITOR_SCRIPT).toContain('同色虚线仅表示未定位观测趋势，地域未核实');
    expect(rows).toEqual(before);
    expect(rows.every(r => r.cohortKey === null && !r.metricEligible)).toBe(true);
    const metrics = createCompetitorMetricsModel().rounds(rows, ['r0c0'], ['ChIJRival']);
    expect(metrics.every(r => r.values.every(v => v.solv === null && v.arp === null && v.atrp === null))).toBe(true);
  });
  it('supports daily history up to 36 hours and does not bridge longer gaps', () => {
    expect(dashed(chart([a(), row('b', '2026-11-11T12:00:00Z')]))).toHaveLength(1);
    expect(dashed(chart([a(), row('b', '2026-11-11T12:00:01Z')]))).toHaveLength(0);
  });
  it.each([
    ['store', [ 'other', ...scope.slice(1) ]], ['target', [scope[0], 'ChIJOther', ...scope.slice(2)]],
    ['surface', [...scope.slice(0, 2), 'android', scope[3]]], ['keyword', [...scope.slice(0, 3), 'tea']],
  ])('breaks when %s changes', (_name, changed) => {
    expect(dashed(chart([a(), b({ scopeKey: JSON.stringify(changed) }), c()]))).toHaveLength(0);
  });
  it.each([
    { pointId: 'other-point' }, { profile: JSON.stringify(['profile-b', ...profile.slice(1)]) },
    { profile: JSON.stringify([profile[0], 'maps-feed-card/v7', profile[2]]) },
    { profile: JSON.stringify([...profile.slice(0, 2), 'map_view']) },
  ])('breaks at changed point or collection method: %j', changed => {
    expect(dashed(chart([a(), b(changed), c()]))).toHaveLength(0);
  });
  it.each([
    { scopeKey: '' }, { scopeKey: 'not-json' }, { scopeKey: '[]' }, { scopeKey: JSON.stringify(['keke', null, 'web', 'duck neck']) },
    { profile: '' }, { profile: 'not-json' }, { profile: '[]' }, { profile: JSON.stringify([null, profile[1], 'query_only']) },
    { profile: JSON.stringify(['profile-a', '', 'query_only']) }, { pointId: '' },
  ])('does not infer a connection from incomplete provenance: %j', changed => {
    expect(dashed(chart([a(), b(changed), c()]))).toHaveLength(0);
  });
  it.each([
    { eligible: false }, { values: [] },
    { values: [{ placeId: 'ChIJRival', organicRank: null, adDisplayPositions: [] }] },
    { values: [{ placeId: 'ChIJRival', organicRank: null, adDisplayPositions: [1] }] },
  ])('breaks at unqualified, missing, absent or ad-only outcomes: %j', changed => {
    expect(dashed(chart([a(), b(changed), c()]))).toHaveLength(0);
  });
  it.each([0, -1, 1.5, NaN, Infinity])('does not draw invalid rank %s or connect across it', rank => {
    const html = chart([a(), row('b', '2026-11-10T02:00:00Z', rank), c()]);
    expect(dashed(html)).toHaveLength(0);
    expect(html.match(/<circle /g)).toHaveLength(2);
    expect(html).not.toMatch(/(?:NaN|Infinity)/);
  });
  it('does not connect when an invalid timestamp prevents locating a reliable gap', () => {
    const html = chart([a(), b({ observedAt: 'invalid-time' }), c()]);
    expect(dashed(html)).toHaveLength(0);
    expect(html.match(/<circle /g)).toHaveLength(2);
    expect(html).not.toContain('NaN');
  });
  it('breaks on both sides of ambiguous repeated timestamps', () => {
    expect(dashed(chart([a(), b(), b({ observationId: 'duplicate' }), c()]))).toHaveLength(0);
  });
  it('renders stable chronological lines from unsorted timestamps with offsets, without mutating input', () => {
    const rows = [b(), row('earlier', '2026-11-09T19:00:00-05:00', 4), c()];
    expect(chart(rows)).toBe(chart([rows[1]!, rows[0]!, rows[2]!]));
    expect(dashed(chart(rows))).toHaveLength(2);
    expect(rows[0]!.observationId).toBe('b');
  });
  it('tracks each rival independently and never bridges its missing rank through another business', () => {
    const rows = [a(), b(), c()].map((r, i) => ({ ...r, values: [
      { placeId: 'ChIJRival', organicRank: i === 1 ? null : 4, adDisplayPositions: [] },
      { placeId: 'ChIJOther', organicRank: i + 1, adDisplayPositions: [] },
    ] }));
    const lines = dashed(chart(rows, ['ChIJRival', 'ChIJOther']));
    expect(lines).toHaveLength(2);
    expect(lines.every(line => line.includes('stroke="#087f8c"'))).toBe(true);
  });
  it('retains located solid lines and their three-hour limit', () => {
    const located = (r: Row) => ({ ...r, profile: JSON.stringify([...profile.slice(0,2), 'map_view']), cohortKey: 'located', metricEligible: true });
    expect(solid(chart([located(a()), located(b())]))).toHaveLength(1);
    expect(dashed(chart([located(a()), located(b())]))).toHaveLength(0);
    expect(solid(chart([located(a()), located(c())]))).toHaveLength(0);
  });
});
