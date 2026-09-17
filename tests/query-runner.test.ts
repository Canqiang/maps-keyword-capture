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
import { namedCards, writeFixture } from './fixtures/feed-fixture.js';

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
});
