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
import { buildLodgingFeedFixture } from './fixtures/lodging-fixture.js';

it.each(['organic', 'ad', 'unresolved'] as const)('persists 15 spa results and preserves rank semantics for a %s Lodging card', async (variant) => {
  const root = await mkdtemp(join(tmpdir(), 'mkc-lodging-'));
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const fixturePath = join(root, 'feed.html');
    await writeFile(fixturePath, buildLodgingFeedFixture(variant));
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['spa'], outputDirectory: root });
    const metadata: RunMetadata = { configHash: 'c', profileHash: 'p', adapterVersion: 'maps-feed-card/v3', sourceCommit: null, browserVersion: null, imageDigest: null, egressProfileId: null };
    const out = await runQueryAttempt({
      browser, config, metadata, store: new LocalArtifactStore(root), runId: 'run_lodging', attemptId: 'att_t',
      attemptRelativeDir: 'capture', searchUrlFor: () => pathToFileURL(fixturePath).toString(),
      viewSettle: { firstBudgetMs: 800, laterBudgetMs: 800, intervalMs: 150 },
    }, { queryId: 'q0001', queryAttemptId: 'qa01', inputIndex: 0, keyword: 'spa', deadlineAt: Date.now() + 60_000, allowTransientThrow: false });
    const saved: KeywordResult = JSON.parse(await readFile(join(root, 'capture', out.resultFile), 'utf8'));
    expect(saved.observedCount).toBe(15);
    expect(saved.sequenceVerified).toBe(true);
    expect(saved.quality.screenshotCoverageComplete).toBe(true);
    expect(saved.listings.every((listing) => listing.screenshotIds.length > 0)).toBe(true);
    expect(saved.listings[0]).toMatchObject({ displayPosition: 1, resultType: 'organic', organicRank: 1 });
    const second = saved.listings[1];
    expect(second).toMatchObject({
      name: 'Blue Stone Chateau Yosemite Pool Spa Secluded - Deluxe Villa', displayPosition: 2,
      rating: null, reviewCount: null, address: null,
    });
    if (variant === 'unresolved') {
      expect(saved).toMatchObject({ status: 'partial', stopReason: 'classification_unknown' });
      expect(second).toMatchObject({ resultType: 'unknown', organicRank: null });
      expect(saved.listings.slice(1).every((listing) => listing.organicRank === null)).toBe(true);
    } else {
      expect(saved.status).toBe('captured');
      expect(second).toMatchObject({ category: 'Lodging', resultType: variant, organicRank: variant === 'ad' ? null : 2 });
      expect(saved.listings[14]).toMatchObject({ displayPosition: 15, organicRank: variant === 'ad' ? 14 : 15 });
      const csv = await readFile(join(root, 'capture', out.resultFile.replace(/\.json$/, '.csv')), 'utf8');
      const row = csv.split('\r\n').find((line) => line.includes('Blue Stone Chateau'));
      expect(row).toContain(variant === 'ad' ? ',2,ad,,Blue Stone Chateau' : ',2,organic,2,Blue Stone Chateau');
      expect(row).toContain(',,,Lodging,');
    }
  } finally {
    await browser.close();
    await rm(root, { recursive: true, force: true });
  }
});
