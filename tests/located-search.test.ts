import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { parseConfig } from '../src/config.js';
import { newSearchContext } from '../src/browser/launch.js';

let browser: Browser;
const point = { latitude: 40.7222614, longitude: -73.6415096, zoom: 15 };
beforeAll(async () => { browser = await chromium.launch({ channel: 'chromium', headless: true }); });
afterAll(async () => { await browser.close(); });

describe('opt-in located Web search', () => {
  it('accepts an explicit located mode only with a configured point', () => {
    expect(parseConfig({ schemaVersion: '1', keywords: ['bubble tea near me'], mapView: point, mapSearchMode: 'located_ui' }).config).toMatchObject({ mapSearchMode: 'located_ui', mapView: point });
    expect(() => parseConfig({ schemaVersion: '1', keywords: ['q'], mapSearchMode: 'located_ui' })).toThrow(/mapView/);
    expect(parseConfig({ schemaVersion: '1', keywords: ['q'] }).config).not.toHaveProperty('mapSearchMode');
  });
  it('sets the point on the real browser and grants location only to Google', async () => {
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['q'], mapView: point, mapSearchMode: 'located_ui' });
    const context = await newSearchContext(browser, config);
    try {
      await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html>Fixture</html>' }));
      const page = await context.newPage(); await page.goto('https://www.google.com/maps/');
      const actual = await page.evaluate(() => new Promise(resolve => navigator.geolocation.getCurrentPosition(p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }), e => resolve({ error: e.code }), { timeout: 500 })));
      expect(actual).toEqual({ latitude: 40.7222614, longitude: -73.6415096, accuracy: 10 });
      await page.goto('https://example.com/');
      expect(await page.evaluate(async () => (await navigator.permissions.query({ name: 'geolocation' })).state)).not.toBe('granted');
    } finally { await context.close(); }
  });
});

import { runQueryAttempt } from '../src/runner/query-runner.js';
import { LocalArtifactStore } from '../src/storage/local.js';
import { buildFeedFixtureHtml } from './fixtures/feed-fixture.js';

async function fixtureRun(mode: 'url' | 'located_ui', options: { missingAcknowledgement?: boolean; wrongCamera?: boolean; crashAfterSearch?: boolean; noResultTransition?: boolean; removeInputOnFill?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'located-search-'));
  let submissions = 0;
  const query = 'bubble tea near me';
  const remote = buildFeedFixtureHtml({ query, cards: [{ name: 'REMOTE Flushing' }], endMarkerInitially: true });
  const local = buildFeedFixtureHtml({ query, cards: [{ name: 'Local sponsored shop', ad: true }, { name: 'Only Bear Chicken & Boba' }], endMarkerInitially: true });
  const home = `<input name="q" role="combobox"><button aria-label="Search">Search</button><button id="location" aria-label="Show Your Location">Locate</button><script>
    ${options.removeInputOnFill ? "document.querySelector('input').addEventListener('input', e => e.target.remove());" : ''}
    navigator.geolocation.getCurrentPosition(() => { window.gpsReady = true; ${options.missingAcknowledgement ? '' : "document.querySelector('#location').setAttribute('aria-label','Your Location');"} });
    ${options.wrongCamera ? "history.replaceState({},'', '/maps/@39.7,-105,15z');" : ''}
    document.querySelector('[aria-label="Search"]').onclick = async () => {
      const text = document.querySelector('input').value;
      const response = await fetch('/maps/fixture-result?gps='+!!window.gpsReady+'&q='+encodeURIComponent(text));
      document.open(); document.write(await response.text()); document.close();
    };
  </script>`;
  const routed = new Proxy(browser, { get(target, key) {
    if (key === 'newContext') return async (config: Parameters<Browser['newContext']>[0]) => {
      const context = await target.newContext(config);
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/maps/fixture-result') {
          submissions++; expect(url.searchParams.get('gps')).toBe('true'); expect(url.searchParams.get('q')).toBe(query);
          return route.fulfill({ contentType: 'text/html', body: options.noResultTransition ? '<p>Waiting</p>' : local });
        }
        return route.fulfill({ contentType: 'text/html', body: url.pathname.startsWith('/maps/search/') ? remote : home });
      });
      return context;
    };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  try {
    const { config } = parseConfig({ schemaVersion: '1', keywords: [query], mapView: point, mapSearchMode: mode, outputDirectory: root });
    const result = await runQueryAttempt({ browser: routed, config, store: new LocalArtifactStore(root), runId: 'run', attemptId: 'attempt', attemptRelativeDir: 'test', metadata: { configHash: 'c', profileHash: 'p', adapterVersion: 'test', sourceCommit: null, browserVersion: null, imageDigest: null, egressProfileId: null }, log: e => { if (options.crashAfterSearch && e.stage === 'navigate') throw new Error('page crashed after search'); }, viewSettle: { firstBudgetMs: 0, laterBudgetMs: 0, intervalMs: 1 } }, { queryId: 'q0001', queryAttemptId: 'qa01', inputIndex: 0, keyword: query, deadlineAt: Date.now() + (options.missingAcknowledgement || options.wrongCamera || options.noResultTransition || options.removeInputOnFill ? 1500 : 10000), allowTransientThrow: true });
    return { result: result.result, submissions };
  } finally { await rm(root, { recursive: true, force: true }); }
}

it('searches once only after Google acknowledges the point; preserves ad and organic order', async () => {
  const { result, submissions } = await fixtureRun('located_ui');
  expect(result.listings.map(l => [l.name, l.resultType, l.displayPosition, l.organicRank])).toEqual([['Local sponsored shop', 'ad', 1, null], ['Only Bear Chicken & Boba', 'organic', 2, 1]]);
  expect(submissions).toBe(1);
  expect(result.context).toMatchObject({ geolocationPermission: 'granted', searchLocation: { method: 'browser_gps_before_search/v1', status: 'prepared', googleAcknowledged: true, submitted: true, observed: { latitude: 40.7222614, longitude: -73.6415096, accuracy: 10 } } });
  expect(result.quality.geographicRelevance?.status).toBe('unverified');
});
it.each([{ missingAcknowledgement: true }, { wrongCamera: true }])('does not silently collect an unprepared location: %j', async options => {
  const { result, submissions } = await fixtureRun('located_ui', options);
  expect(submissions).toBe(0);
  expect(result).toMatchObject({ status: 'partial', stopReason: 'location_unverified', listings: [] });
  expect(result.context).toMatchObject({ searchLocation: { status: 'failed', submitted: false } });
});
it('keeps the legacy URL workflow unchanged until explicitly enabled', async () => {
  const { result, submissions } = await fixtureRun('url');
  expect(result.listings[0]?.name).toBe('REMOTE Flushing'); expect(submissions).toBe(0);
  expect(result.context.geolocationPermission).toBe('not_granted');
  expect(result.context).not.toHaveProperty('searchLocation');
});

import { runBatch, ADAPTER_VERSION } from '../src/runner/batch-runner.js';
import { hashJson } from '../src/ids.js';
it('separates located profiles without rewriting the legacy comparison identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'located-profile-'));
  try {
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['boba'], mapView: point, outputDirectory: root });
    const launch = async (): Promise<Browser> => { throw new Error('profile fixture: no live browser needed'); };
    const legacy = await runBatch({ config, launch });
    const explicitUrl = await runBatch({ config: { ...config, mapSearchMode: 'url' }, launch });
    const located = await runBatch({ config: { ...config, mapSearchMode: 'located_ui' }, launch });
    expect(legacy.manifest.metadata.profileHash).toBe(hashJson({ surface: 'google-maps-desktop', locale: config.locale, browserTimezoneId: config.browserTimezoneId, viewport: config.viewport, deviceScaleFactor: 1, locationMode: 'map_view', adapterVersion: ADAPTER_VERSION }));
    expect(explicitUrl.manifest.metadata.profileHash).toBe(legacy.manifest.metadata.profileHash);
    expect(located.manifest.metadata.profileHash).not.toBe(legacy.manifest.metadata.profileHash);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('never asks the batch to resubmit after a post-search browser failure', async () => {
  const { result, submissions } = await fixtureRun('located_ui', { crashAfterSearch: true });
  expect(submissions).toBe(1);
  expect(result.status).toBe('failed');
  expect(result.context.searchLocation).toMatchObject({ submissionAttempted: true, submitted: true });
});
it('preserves one submission and its receipt when the result transition times out', async () => {
  const { result, submissions } = await fixtureRun('located_ui', { noResultTransition: true });
  expect(submissions).toBe(1);
  expect(result.status).toBe('failed');
  expect(result.context.searchLocation).toMatchObject({ status: 'failed', submissionAttempted: true, submitted: true });
});

it('bounds the read when the search input is removed after filling', async () => {
  const { result, submissions } = await fixtureRun('located_ui', { removeInputOnFill: true });
  expect(submissions).toBe(0);
  expect(result.stopReason).toBe('location_unverified');
}, 4000);
