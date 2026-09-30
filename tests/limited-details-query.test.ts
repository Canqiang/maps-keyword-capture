import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { KeywordResult, RunMetadata } from '../src/contracts.js';
import { parseConfig } from '../src/config.js';
import { openSearch } from '../src/browser/maps-adapter.js';
import { runQueryAttempt } from '../src/runner/query-runner.js';
import { LocalArtifactStore } from '../src/storage/local.js';
import { limitedDetailHtml, limitedDetailName, limitedDetailUrl } from './fixtures/limited-details-fixture.js';

let browser: Browser;
let root: string;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  root = await mkdtemp(join(tmpdir(), 'mkc-limited-details-'));
});
afterAll(async () => { await browser.close(); await rm(root, { recursive: true, force: true }); });
const metadata: RunMetadata = { configHash: 'c', profileHash: 'p', adapterVersion: 'test', sourceCommit: null, browserVersion: null, imageDigest: null, egressProfileId: null };

describe('limited detail attempt evidence', () => {
  it.each(['initial', 'feed_transition'])('persists %s details as a non-ranking observation and preserves the original query', async mode => {
    const html = limitedDetailHtml.replace('value="see joy"', `value="${limitedDetailName}"`);
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['see joy'], outputDirectory: root });
    const attemptRelativeDir = `run/att_${mode}`;
    const openSearchImpl = async (page: Page, url: string, timeoutMs: number) => {
      await page.route(limitedDetailUrl, route => route.fulfill({ contentType: 'text/html', body: mode === 'initial' ? html : `<input name="q" value="see joy"><div role="feed" style="width:408px;height:700px">Loading results</div><script>setTimeout(() => { document.body.innerHTML = ${JSON.stringify(html)}; }, 100)</script>` }));
      return openSearch(page, url, timeoutMs);
    };
    const out = await runQueryAttempt({ browser, config, store: new LocalArtifactStore(root), runId: 'run', attemptId: `att_${mode}`, metadata, attemptRelativeDir, searchUrlFor: () => limitedDetailUrl, openSearchImpl }, {
      queryId: 'q1', inputIndex: 0, keyword: 'see joy', queryAttemptId: 'qa1', deadlineAt: Date.now() + 15_000, allowTransientThrow: false,
    });
    expect(out.result).toMatchObject({ keyword: 'see joy', status: 'partial', stopReason: 'non_ranking_result', error: null, listings: [], observedCount: 0, finalUrl: limitedDetailUrl });
    expect(out.result.quality).toMatchObject({ resultSurface: 'place_details', observedQueryText: limitedDetailName, placeDetails: { name: limitedDetailName, mapsUrl: limitedDetailUrl, recognition: 'limited_actions', signals: expect.arrayContaining(['save', 'send_to_phone', 'share', 'website', 'phone']) } });
    expect(out.result.screenshots.map(shot => shot.kind)).toEqual(['diagnostic']);
    expect(out.result.quality.warnings.some(warning => warning.code === 'place_redirect')).toBe(true);
    expect(out.result.quality.warnings.some(warning => warning.code === 'unknown_page')).toBe(false);
    const saved = JSON.parse(await readFile(join(root, attemptRelativeDir, out.resultFile), 'utf8')) as KeywordResult;
    expect(saved.quality.placeDetails).toEqual(out.result.quality.placeDetails);
    expect(saved.keyword).toBe('see joy');
    const csv = await readFile(join(root, attemptRelativeDir, out.resultFile.replace(/\.json$/, '.csv')), 'utf8');
    expect(csv.trim().split(/\r?\n/)).toHaveLength(1);
    expect(await readFile(join(root, attemptRelativeDir, 'q1/qa1/observations.jsonl'), 'utf8')).toBe('');
    const png = await readFile(join(root, attemptRelativeDir, 'q1/qa1', out.result.screenshots[0]!.filename));
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});
