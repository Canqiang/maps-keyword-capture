import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import type { KeywordResult, RunMetadata } from '../src/contracts.js';
import { parseConfig } from '../src/config.js';
import { runQueryAttempt } from '../src/runner/query-runner.js';
import { LocalArtifactStore } from '../src/storage/local.js';
import { buildFeedFixtureHtml } from './fixtures/feed-fixture.js';

it('persists category-only no-review cards without false unknown classification or an organic rank for ads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mkc-no-review-'));
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const fixturePath = join(root, 'feed.html');
    await writeFile(fixturePath, buildFeedFixtureHtml({
      query: 'bakery', endMarkerInitially: true,
      cards: [
        { name: 'Sponsored Bakery', noRating: true, category: 'Bakery', categoryOnly: true, ad: true },
        { name: 'Memo Fırın', noRating: true, category: 'Bakery', categoryOnly: true },
        { name: 'Another Bakery', category: 'Bakery' },
      ],
    }));
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['bakery'], outputDirectory: root });
    const metadata: RunMetadata = { configHash: 'c', profileHash: 'p', adapterVersion: 'maps-feed-card/v1', sourceCommit: null, browserVersion: null, imageDigest: null, egressProfileId: null };
    const out = await runQueryAttempt({
      browser, config, metadata, store: new LocalArtifactStore(root), runId: 'run_no_review', attemptId: 'att_t',
      attemptRelativeDir: 'capture', searchUrlFor: () => pathToFileURL(fixturePath).toString(),
      viewSettle: { firstBudgetMs: 800, laterBudgetMs: 800, intervalMs: 150 },
    }, { queryId: 'q0001', queryAttemptId: 'qa01', inputIndex: 0, keyword: 'bakery', deadlineAt: Date.now() + 60_000, allowTransientThrow: false });
    const saved: KeywordResult = JSON.parse(await readFile(join(root, 'capture', out.resultFile), 'utf8'));
    expect(saved).toMatchObject({ status: 'captured', stopReason: 'end_of_results', observedCount: 3, sequenceVerified: true });
    expect(saved.listings[0]).toMatchObject({ name: 'Sponsored Bakery', category: 'Bakery', resultType: 'ad', adLabel: 'Sponsored', organicRank: null });
    expect(saved.listings[1]).toMatchObject({ name: 'Memo Fırın', category: 'Bakery', address: null, rating: null, reviewCount: null, resultType: 'organic', organicRank: 1 });
    expect(saved.listings[2]).toMatchObject({ organicRank: 2 });
    expect(saved.quality.screenshotCoverageComplete).toBe(true);
    expect(saved.listings.every((listing) => listing.screenshotIds.length > 0)).toBe(true);
    const csv = await readFile(join(root, 'capture', out.resultFile.replace(/\.json$/, '.csv')), 'utf8');
    expect(csv.split('\r\n').find((line) => line.includes('Memo Fırın'))).toContain(',2,organic,1,Memo Fırın,,,,Bakery,');
  } finally {
    await browser.close();
    await rm(root, { recursive: true, force: true });
  }
});
