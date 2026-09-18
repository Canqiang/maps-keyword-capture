import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { KeywordResult, Observation, RunMetadata } from '../src/contracts.js';
import { runQueryAttempt } from '../src/runner/query-runner.js';
import { LocalArtifactStore } from '../src/storage/local.js';
import type { ArtifactStore, WrittenFile } from '../src/storage/types.js';
import { parseConfig } from '../src/config.js';
import { openSearch } from '../src/browser/maps-adapter.js';
import { buildFeedFixtureHtml, namedCards, writeFixture } from './fixtures/feed-fixture.js';

/** Wraps the local store and refuses the paths a test wants to see fail. */
class RefusingStore implements ArtifactStore {
  readonly mode = 'local_only' as const;
  readonly rootDirectory: string;
  constructor(private readonly inner: LocalArtifactStore, private readonly refuse: (relativePath: string) => boolean) {
    this.rootDirectory = inner.rootDirectory;
  }
  async writeFile(relativePath: string, data: Buffer | string): Promise<WrittenFile> {
    if (this.refuse(relativePath)) throw new Error(`store refused ${relativePath}`);
    return this.inner.writeFile(relativePath, data);
  }
  absolutePath(relativePath: string): string { return this.inner.absolutePath(relativePath); }
  async persist(file: WrittenFile) { return this.inner.persist(file); }
}

let browser: Browser;
let root: string;
const metadata: RunMetadata = { configHash: 'c', profileHash: 'p', adapterVersion: 'maps-feed-card/v1', sourceCommit: null, browserVersion: null, imageDigest: null, egressProfileId: null };

beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  root = await mkdtemp(join(tmpdir(), 'mkc-run-'));
});
afterAll(async () => { await browser.close(); await rm(root, { recursive: true, force: true }); });

function deps(url: string, over: Record<string, unknown> = {}) {
  const { config } = parseConfig({ schemaVersion: '1', keywords: ['bubble tea garden city'], outputDirectory: root, ...over });
  return {
    browser, store: new LocalArtifactStore(root), config, runId: 'run_t', attemptId: 'att_t', metadata,
    attemptRelativeDir: 'maps-keyword-capture/2026-09-17/run_t/att_t',
    searchUrlFor: () => url,
  };
}
const input = (over: Record<string, unknown> = {}) => ({
  queryId: 'q0001', inputIndex: 0, keyword: 'bubble tea garden city', queryAttemptId: 'qa01',
  deadlineAt: Date.now() + 60_000, allowTransientThrow: false, ...over,
});

describe('runQueryAttempt', () => {
  it('assesses retained listings rather than the final detail place after a late transition', async () => {
    const url = 'https://www.google.com/maps/place/Fixture/data=!3d40.7!4d-73.6';
    const html = buildFeedFixtureHtml({ query: 'q', cards: namedCards(8) }).replaceAll('!3d40.7!4d-73.6', '!3d39.8!4d-105');
    const expectedArea = { label: 'Verified test area', latitude: 40.7, longitude: -73.6, radiusKm: 10, source: 'test fixture' };
    const d = {
      ...deps(url, { expectedArea }),
      openSearchImpl: async (page: Parameters<typeof openSearch>[0], u: string, timeout: number) => {
        await page.route(url, route => route.fulfill({ contentType: 'text/html', body: html }));
        const opened = await openSearch(page, u, timeout);
        await page.evaluate(() => document.querySelector('[role="feed"]')!.addEventListener('scroll', () => {
          document.body.innerHTML = '<main><h1>Fixture shop</h1><button aria-label="Directions">Directions</button></main>';
        }, { once: true }));
        return opened;
      },
    };
    const out = await runQueryAttempt(d, input({ queryId: 'late_detail', keyword: 'q' }));
    expect(out.result).toMatchObject({ status: 'partial', stopReason: 'unsupported_layout', finalUrl: url });
    expect(out.result.listings.length).toBeGreaterThan(0);
    expect(out.result.quality).toMatchObject({ resultSurface: 'place_details', geographicRelevance: { status: 'outside', scope: 'observed_listings', insideCount: 0, outsideCount: out.result.listings.length } });
  });

  it.each([
    { surface: 'details', markup: '<main><h1>Fixture shop</h1><button aria-label="Directions">Directions</button></main>', reason: 'non_ranking_result', resultSurface: 'place_details' },
    { surface: 'unknown', markup: '<main>Loading</main>', reason: 'unsupported_layout', resultSurface: 'unknown' },
  ])('retains diagnostics when an initial feed changes to $surface before collection', async ({ markup, reason, resultSurface }) => {
    const url = 'https://www.google.com/maps/place/Fixture/data=!3d40.7!4d-73.6';
    const d = {
      ...deps(url),
      openSearchImpl: async (page: Parameters<typeof openSearch>[0]) => {
        await page.route(url, route => route.fulfill({ contentType: 'text/html', body: `<input id="searchboxinput" value="q"><div role="feed" style="width:400px;height:600px">Loading results</div><script>setTimeout(() => { document.body.innerHTML = ${JSON.stringify(markup)}; }, 100)</script>` }));
        await page.goto(url);
        return { state: { kind: 'results' as const }, finalUrl: url };
      },
    };
    const out = await runQueryAttempt(d, input({ queryId: `transition_${resultSurface}`, keyword: 'q' }));
    expect(out.result).toMatchObject({ status: 'partial', stopReason: reason, listings: [], observedCount: 0, finalUrl: url });
    expect(out.result.quality.resultSurface).toBe(resultSurface);
    expect(out.result.screenshots.map((s) => s.kind)).toEqual(['diagnostic']);
  });

  it('records passive geographic warnings without changing the query, rank or capture outcome', async () => {
    const keyword = 'bubble tea garden city';
    const url = await writeFixture({ query: keyword, cards: namedCards(2), endMarkerInitially: true });
    const expectedArea = { label: 'Verified test area', latitude: 39.8, longitude: -105, radiusKm: 10, source: 'test fixture' };
    const out = await runQueryAttempt(deps(url, { expectedArea }), input({ queryId: 'q0101' }));
    expect(out.result).toMatchObject({ keyword, status: 'captured', stopReason: 'end_of_results', observedCount: 2 });
    expect(out.result.context).toMatchObject({ locationMode: 'query_only', configuredMapView: null, geolocationPermission: 'not_granted' });
    expect(out.result.listings.map((l) => l.organicRank)).toEqual([1, 2]);
    expect(out.result.quality.geographicRelevance).toMatchObject({ status: 'outside', scope: 'observed_listings', expectedArea, checkedCount: 2, outsideCount: 2, unknownCount: 0 });
    expect(out.result.quality.warnings.map((w) => w.code)).toContain('geography_outside');
    const saved = JSON.parse(await readFile(join(root, 'maps-keyword-capture/2026-09-17/run_t/att_t', out.resultFile), 'utf8')) as KeywordResult;
    expect(saved.quality.geographicRelevance).toEqual(out.result.quality.geographicRelevance);
    const csv = await readFile(join(root, 'maps-keyword-capture/2026-09-17/run_t/att_t', out.resultFile.replace(/\.json$/, '.csv')), 'utf8');
    expect(csv.trim().split('\r\n').slice(1).every((row) => row.endsWith(',outside'))).toBe(true);
  });

  it('keeps geographic relevance unverified without a configured expected area', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(2), endMarkerInitially: true });
    const out = await runQueryAttempt(deps(url), input({ queryId: 'q0102', keyword: 'q' }));
    expect(out.result.status).toBe('captured');
    expect(out.result.quality.geographicRelevance).toMatchObject({ status: 'unverified', expectedArea: null, reason: 'expected_area_not_configured' });
    expect(out.result.quality.warnings.map((w) => w.code)).toContain('geography_unverified');
  });

  it('checks a recognized detail place without manufacturing a ranked listing', async () => {
    const expectedArea = { label: 'Verified test area', latitude: 40.7, longitude: -73.6, radiusKm: 10, source: 'test fixture' };
    const d = {
      ...deps('https://www.google.com/maps/search/?api=1&query=q', { expectedArea }),
      openSearchImpl: async (page: Parameters<typeof openSearch>[0]) => {
        await page.setContent('<main><h1>Fixture shop</h1><button aria-label="Directions">Directions</button></main>');
        return { state: { kind: 'place_redirect' as const }, finalUrl: 'https://www.google.com/maps/place/Fixture/data=!3d40.7!4d-73.6' };
      },
    };
    const out = await runQueryAttempt(d, input({ queryId: 'q0103', keyword: 'q' }));
    expect(out.result).toMatchObject({ status: 'partial', stopReason: 'non_ranking_result', listings: [], observedCount: 0 });
    expect(out.result.quality).toMatchObject({ resultSurface: 'place_details', geographicRelevance: { status: 'matched', scope: 'detail_place', checkedCount: 1, insideCount: 1 } });
    expect(out.result.screenshots.map((s) => s.kind)).toEqual(['diagnostic']);
  });

  it('warns when the map area never settles but still captures the list', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(5), endOfList: true, mapAnimateMs: 100 });
    const out = await runQueryAttempt({ ...deps(url), viewSettle: { firstBudgetMs: 800, laterBudgetMs: 800, intervalMs: 150 } }, input({ queryId: 'q0090', keyword: 'q' }));
    expect(out.result.status).toBe('captured');
    expect(out.result.quality.warnings.map((w) => w.code)).toContain('map_unsettled');
  });

  it('waits for the transient hint to clear before the first screenshot', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(5), endOfList: true, transientHintMs: 3000 });
    const out = await runQueryAttempt({ ...deps(url), viewSettle: { firstBudgetMs: 6000, laterBudgetMs: 800, intervalMs: 150 } }, input({ queryId: 'q0091', keyword: 'q' }));
    expect(out.result.status).toBe('captured');
    expect(out.result.quality.warnings.map((w) => w.code)).not.toContain('map_unsettled');
    const first = out.result.screenshots.find((s) => s.kind === 'results')!;
    expect(Date.parse(first.capturedAt) - Date.parse(out.result.startedAt)).toBeGreaterThanOrEqual(2900);
  });

  it('records the URL the page has when the screenshot is taken, even with a single observation', async () => {
    // The live page rewrites its URL ~3.5 s after the feed appears, while the first screenshot is
    // still waiting for the view to settle. The URL must be read after that wait, not before it.
    const url = await writeFixture({ query: 'q', cards: namedCards(3), endMarkerInitially: true, viewInUrlAfterMs: 1000, transientHintMs: 1500 });
    const out = await runQueryAttempt({ ...deps(url), viewSettle: { firstBudgetMs: 4000, laterBudgetMs: 800, intervalMs: 150 } }, input({ queryId: 'q0093', keyword: 'q' }));
    const observations = (await readFile(join(root, 'maps-keyword-capture/2026-09-17/run_t/att_t/q0093/qa01/observations.jsonl'), 'utf8')).trim().split('\n');
    expect(observations).toHaveLength(1);
    expect(out.result.context.observedMapView).toEqual({ latitude: 40.7336673, longitude: -73.648544, zoom: 14 });
  });

  it('records the final URL and the observed map view the page settles on', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(5), endOfList: true, viewInUrlAfterMs: 100 });
    const out = await runQueryAttempt(deps(url), input({ queryId: 'q0092', keyword: 'q' }));
    expect(out.result.finalUrl).toContain('@40.7336673,-73.648544,14z');
    expect(out.result.context.observedMapView).toEqual({ latitude: 40.7336673, longitude: -73.648544, zoom: 14 });
  });

  it('captures 15 listings with an ad at position 1, screenshots, observations, JSON, and CSV', async () => {
    const url = await writeFixture({
      query: 'bubble tea garden city',
      cards: [{ name: 'Gong Cha', ad: true, placeId: '0xg:0xc' }, ...namedCards(9)],
      moreCards: [...namedCards(9, 9), { name: 'Gong Cha', placeId: '0xg:0xc' }],
      endOfList: true,
    });
    const out = await runQueryAttempt(deps(url), input());
    const r: KeywordResult = out.result;
    expect(r.status).toBe('captured');
    expect(r.stopReason).toBe('limit_reached');
    expect(r.observedCount).toBe(15);
    expect(r.sequenceVerified).toBe(true);
    expect(r.listings[0]).toMatchObject({ displayPosition: 1, resultType: 'ad', adLabel: 'Sponsored', organicRank: null, name: 'Gong Cha' });
    expect(r.listings[1]).toMatchObject({ displayPosition: 2, resultType: 'organic', organicRank: 1, name: 'Shop 01' });
    expect(r.listings[14]).toMatchObject({ displayPosition: 15, organicRank: 14 });
    expect(r.listings.every((l) => l.screenshotIds.length > 0)).toBe(true);
    expect(r.quality.screenshotCoverageComplete).toBe(true);
    expect(r.screenshots.length).toBeGreaterThanOrEqual(3);
    expect(r.screenshots.length).toBeLessThanOrEqual(5);
    expect(r.context).toMatchObject({ locationMode: 'query_only', configuredMapView: null, loggedIn: false, geolocationPermission: 'not_granted' });
    expect(out.summary).toMatchObject({ status: 'captured', queryAttemptId: 'qa01', resultFile: expect.stringMatching(/^q0001\/qa01\/.+__bubble-tea-garden-city__q0001\.json$/) });
    const kinds = out.artifacts.map((a) => a.kind).sort();
    expect(kinds).toEqual(expect.arrayContaining(['results', 'observations_jsonl', 'result_json', 'result_csv']));
    for (const a of out.artifacts) {
      const s = await stat(join(root, 'maps-keyword-capture/2026-09-17/run_t/att_t', a.queryId!, a.queryAttemptId!, a.filename));
      expect(s.size).toBe(a.bytes);
    }
    const csv = await readFile(join(root, 'maps-keyword-capture/2026-09-17/run_t/att_t', out.resultFile.replace(/\.json$/, '.csv')), 'utf8');
    expect(csv.split('\r\n')).toHaveLength(17);
    const jsonl = await readFile(join(root, 'maps-keyword-capture/2026-09-17/run_t/att_t/q0001/qa01/observations.jsonl'), 'utf8');
    expect(jsonl.trim().split('\n').length).toBeGreaterThanOrEqual(r.screenshots.length);
    expect(JSON.parse(jsonl.trim().split('\n')[0]!)).toMatchObject({ observationId: 'qa01_obs001', accepted: true, queryAttemptId: 'qa01' });
  });

  it('reports end_of_results as captured when fewer than the limit exist', async () => {
    const url = await writeFixture({ query: 'fried chicken mineola', cards: namedCards(7), endOfList: true });
    const out = await runQueryAttempt(deps(url), input({ queryId: 'q0002', keyword: 'fried chicken mineola' }));
    expect(out.result).toMatchObject({ status: 'captured', stopReason: 'end_of_results', observedCount: 7 });
  });

  it('stops with scroll_limit as partial when the budget runs out', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(6), moreCards: namedCards(20, 6) });
    const out = await runQueryAttempt(deps(url, { maxScrollsPerKeyword: 1 }), input({ queryId: 'q0003', keyword: 'q' }));
    expect(out.result.status).toBe('partial');
    expect(out.result.stopReason).toBe('scroll_limit');
    expect(out.result.observedCount).toBeGreaterThan(0);
  });

  it('records a query mismatch instead of guessing', async () => {
    const url = await writeFixture({ query: 'something else', title: 'something else - Google Maps', cards: namedCards(5) });
    const out = await runQueryAttempt(deps(url), input({ queryId: 'q0004', keyword: 'q' }));
    expect(out.result).toMatchObject({ status: 'partial', stopReason: 'query_mismatch', observedCount: 0 });
    expect(out.result.quality.observedQueryText).toBe('something else');
  });

  it('waits for the entry page to fill in the query instead of reporting query_mismatch', async () => {
    const url = await writeFixture({
      query: 'bubble tea garden city', cards: namedCards(5), endOfList: true, queryInputName: 'q', deferQueryMs: 2500,
    });
    const out = await runQueryAttempt(deps(url), input({ queryId: 'q0008' }));
    expect(out.result.stopReason).not.toBe('query_mismatch');
    expect(out.result).toMatchObject({ status: 'captured', observedCount: 5 });
    expect(out.result.quality.observedQueryText).toBe('bubble tea garden city');
  });

  it('reports timeout, not query_mismatch, when the budget expires before the query renders', async () => {
    // Observed live with keywordTimeoutMs=5000: the feed is up but the entry page has not filled in
    // the query yet, and the budget is already spent. The honest reason is the budget, not a mismatch.
    const url = await writeFixture({ query: 'bubble tea garden city', cards: namedCards(5), queryInputName: 'q', deferQueryMs: 60_000 });
    const deadlineAt = Date.now() + 5000;
    const d = {
      ...deps(url),
      openSearchImpl: async (page: Parameters<typeof openSearch>[0], u: string, t: number) => {
        const opened = await openSearch(page, u, t);
        await new Promise((r) => setTimeout(r, Math.max(0, deadlineAt - Date.now() - 200)));
        return opened;
      },
    };
    const out = await runQueryAttempt(d, input({ queryId: 'q0009', deadlineAt }));
    expect(out.result.stopReason).toBe('timeout');
    // Nothing was collected, so deriveOutcome downgrades the timeout to failed.
    expect(out.result.status).toBe('failed');
    expect(out.result.error).toMatchObject({ code: 'timeout' });
  });

  it('treats a no-results page as captured with zero listings and a diagnostic screenshot', async () => {
    const url = await writeFixture({ query: 'zzz', cards: [], noResults: true });
    const out = await runQueryAttempt(deps(url), input({ queryId: 'q0005', keyword: 'zzz' }));
    expect(out.result).toMatchObject({ status: 'captured', stopReason: 'end_of_results', observedCount: 0 });
    expect(out.result.screenshots.map((s) => s.kind)).toEqual(['diagnostic']);
  });

  it('marks unstable feeds as partial / unstable_results and writes the rejected observation', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(5), jitterMs: 120 });
    const out = await runQueryAttempt(deps(url), input({ queryId: 'q0006', keyword: 'q' }));
    expect(out.result.status).toBe('partial');
    expect(out.result.stopReason).toBe('unstable_results');
    const jsonl = await readFile(join(root, 'maps-keyword-capture/2026-09-17/run_t/att_t/q0006/qa01/observations.jsonl'), 'utf8');
    const lines = jsonl.split('\n').filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(1);
    const rejected = JSON.parse(lines[0]!) as Observation;
    expect(rejected).toMatchObject({ observationId: 'qa01_obs001', accepted: false, rejectionReason: 'unstable_results', screenshotIds: [] });
    expect(rejected.cards).toHaveLength(5);
    expect(rejected.cards[0]!.name).toBe('Shop 01');
  });

  it('turns a blocked page state into blocked / captcha', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(5) });
    const d = { ...deps(url), openSearchImpl: async () => ({ state: { kind: 'captcha' as const }, finalUrl: 'https://www.google.com/sorry/index' }) };
    const out = await runQueryAttempt(d, input({ queryId: 'q0007', keyword: 'q' }));
    expect(out.result).toMatchObject({ status: 'blocked', stopReason: 'captcha', finalUrl: 'https://www.google.com/sorry/index' });
  });
  it('downgrades to failed / export_failed when the observations log cannot be written', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(5), endOfList: true });
    const d = { ...deps(url), store: new RefusingStore(new LocalArtifactStore(root), (p) => p.endsWith('observations.jsonl')) };
    const out = await runQueryAttempt(d, input({ queryId: 'q0010', keyword: 'q' }));
    expect(out.result).toMatchObject({ status: 'failed', stopReason: 'error', error: { code: 'export_failed' } });
    expect(out.result.observationArtifactIds).toEqual([]);
    expect(out.result.listings.length).toBe(5);
    expect(out.summary.status).toBe('failed');
    expect(out.artifacts.map((a) => a.kind)).toEqual(expect.arrayContaining(['result_json', 'result_csv']));
    const written = JSON.parse(await readFile(join(root, 'maps-keyword-capture/2026-09-17/run_t/att_t', out.resultFile), 'utf8')) as KeywordResult;
    expect(written).toMatchObject({ status: 'failed', stopReason: 'error' });
    expect(written.quality.warnings.some((w) => w.code === 'export_failed')).toBe(true);
  });
  it('keeps blocked / captcha when the diagnostic screenshot cannot be saved', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(5) });
    const d = {
      ...deps(url),
      store: new RefusingStore(new LocalArtifactStore(root), (p) => p.endsWith('.png')),
      openSearchImpl: async () => ({ state: { kind: 'captcha' as const }, finalUrl: 'https://www.google.com/sorry/index' }),
    };
    const out = await runQueryAttempt(d, input({ queryId: 'q0011', keyword: 'q' }));
    expect(out.result).toMatchObject({ status: 'blocked', stopReason: 'captcha', error: null });
    expect(out.result.quality.warnings.map((w) => w.code)).toContain('diagnostic_screenshot_failed');
    expect(out.result.screenshots).toEqual([]);
  });
  it('stops at the verified prefix when a committed card is replaced between rounds', async () => {
    const url = await writeFixture({
      query: 'q', cards: namedCards(6), moreCards: namedCards(6, 6),
      replaceCardAtOnScroll: { index: 3, name: 'Swapped Shop' },
    });
    const out = await runQueryAttempt(deps(url), input({ queryId: 'q0012', keyword: 'q' }));
    expect(out.result.status).toBe('partial');
    expect(out.result.stopReason).toBe('sequence_ambiguous');
    expect(out.result.sequenceVerified).toBe(false);
    expect(out.result.observedCount).toBe(3);
    expect(out.result.quality.verifiedPrefixLength).toBe(3);
    expect(out.result.listings.map((l) => l.name)).toEqual(['Shop 01', 'Shop 02', 'Shop 03']);
    expect(out.result.quality.warnings.map((w) => w.code)).toContain('sequence_ambiguous');
  });
  it('keeps blocked / captcha when an export write fails, so the batch breaker still trips', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(5) });
    const d = {
      ...deps(url),
      store: new RefusingStore(new LocalArtifactStore(root), (p) => p.endsWith('observations.jsonl')),
      openSearchImpl: async () => ({ state: { kind: 'captcha' as const }, finalUrl: 'https://www.google.com/sorry/index' }),
    };
    const out = await runQueryAttempt(d, input({ queryId: 'q0095', keyword: 'q' }));
    expect(out.result).toMatchObject({ status: 'blocked', stopReason: 'captcha' });
    expect(out.summary.status).toBe('blocked');
    expect(out.result.quality.warnings.map((w) => w.code)).toContain('export_failed');
  });
});
