import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { UI_HTML } from '../src/web/ui.js';
import { createFrontendModel } from '../src/web/frontend-model.js';

const M = createFrontendModel();
const script = UI_HTML.match(/<script>([\s\S]*)<\/script>/)![1]!;
const declaration = (prefix: string) => script.split('\n').find(line => line.startsWith(prefix))!;
const observations = [5, 7].map((rank, i) => ({
  observationId: 'unlocated-' + i, localDate: '2026-11-13', observedAt: `2026-11-13T${10 + i * 2}:00:00Z`,
  keyword: 'duck neck', keywordKey: 'duck neck', storeId: 'keke', placeId: 'target-place', surface: 'web',
  pointId: 'r0c0', locationMode: 'query_only', source: { profileHash: 'profile-a', adapterVersion: 'daily/v1' },
  cohortKey: null, eligible: true, metricOrganicRank: rank, rank: { status: 'ranked', organicRank: rank },
}));

describe('unlocated observational trend rendering', () => {
  it('renders a dashed path through unlocated ranks in the overview sparkline', () => {
    const html = runInNewContext(declaration('function spark(') + ';spark(rows, domain, "#b5179e")', {
      M, rows: observations, domain: [Date.parse('2026-11-13'), Date.parse('2026-11-14')],
    });
    expect(html).toMatch(/<path[^>]+class="[^"]*unlocated-line[^>]+stroke-dasharray="[^"]+"[^>]+d="M[^"<]+L/);
    expect(html.match(/<circle/g)).toHaveLength(2);
  });

  it('starts the visible sparkline with M when an earlier observation is outside the date window', () => {
    const rows = [{ ...observations[0]!, observationId: 'before-window', observedAt: '2026-11-12T23:00:00Z' }, ...observations];
    const html = runInNewContext(declaration('function spark(') + ';spark(rows, domain, "#b5179e")', {
      M, rows, domain: [Date.parse('2026-11-13'), Date.parse('2026-11-14')],
    });
    expect(html).toMatch(/unlocated-line[^>]+d="M[^"<]+L/);
  });

  it.each([true, false])('renders the same dashed trend when unlocated is primary=%s, without a geographic delta', primary => {
    const start = script.indexOf('function drawTrend(');
    const draw = script.slice(start, script.indexOf('\n}', start) + 2);
    const target = { innerHTML: '' };
    const located = observations.map(o => ({ ...o, pointId: 'center', locationMode: 'browser_gps', cohortKey: 'located' }));
    const context = {
      r: { point: primary ? 'r0c0' : 'center', id: 'keke', keyword: 'duck neck', from: '2026-11-13', to: '2026-11-13' },
      store: { keywords: { core: ['duck neck'], longTail: [] } }, points: [],
      trendExtra: primary ? {} : { 'duck neck': [
        { id: '3km', label: '3公里', rows: [] }, { id: '5km', label: '5公里', rows: [] },
        { id: 'r0c0', label: '未定位监控', rows: observations },
      ] },
    };
    runInNewContext([
      declaration('const SERIES_COLORS='), declaration('function clockOf('), declaration('function trendSeries('),
      draw, ';drawTrend(context, rows)',
    ].join('\n'), {
      M, E: M.escape, context, rows: primary ? observations : located, settings: { timezone: 'America/New_York' },
      pointName: () => primary ? '未定位监控' : '中心', params: () => '', href: () => '#evidence', when: (s: string) => s,
      badge: () => '', renderKeywordMetrics: () => {}, loadTrendExtra: () => {},
      document: { getElementById: () => target, querySelectorAll: () => [] },
    });
    expect(target.innerHTML).toMatch(/<path[^>]+class="[^"]*unlocated-line[^>]+stroke-dasharray="[^"]+"[^>]+d="M[^"<]+L/);
    expect(target.innerHTML).toContain('未定位虚线仅表示观测趋势，地域未核实');
    if (!primary) expect(target.innerHTML).toMatch(/unlocated-line[^>]+style="stroke:#b5179e"/);
    expect(M.compare(observations[0], observations[1]).delta).toBeNull();
    expect(M.movement(observations).delta).toBeNull();
  });
});
