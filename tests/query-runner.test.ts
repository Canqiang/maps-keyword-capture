import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { KeywordResult, RunMetadata } from '../src/contracts.js';
import { runQueryAttempt } from '../src/runner/query-runner.js';
import { LocalArtifactStore } from '../src/storage/local.js';
import { parseConfig } from '../src/config.js';
import { openSearch } from '../src/browser/maps-adapter.js';
import { namedCards, writeFixture } from './fixtures/feed-fixture.js';

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

  it('marks unstable feeds as partial / unstable_results', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(5), jitterMs: 120 });
    const out = await runQueryAttempt(deps(url), input({ queryId: 'q0006', keyword: 'q' }));
    expect(out.result.status).toBe('partial');
    expect(out.result.stopReason).toBe('unstable_results');
  });

  it('turns a blocked page state into blocked / captcha', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(5) });
    const d = { ...deps(url), openSearchImpl: async () => ({ state: { kind: 'captcha' as const }, finalUrl: 'https://www.google.com/sorry/index' }) };
    const out = await runQueryAttempt(d, input({ queryId: 'q0007', keyword: 'q' }));
    expect(out.result).toMatchObject({ status: 'blocked', stopReason: 'captcha', finalUrl: 'https://www.google.com/sorry/index' });
  });
});
