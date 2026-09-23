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
import { apartmentName, buildApartmentFeedFixture } from './fixtures/apartment-fixture.js';

it.each(['organic', 'ad', 'unresolved'] as const)('persists 15 results and preserves organic-rank continuity for a %s Apartment card', async (variant) => {
  const root = await mkdtemp(join(tmpdir(), 'mkc-apartment-'));
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const fixturePath = join(root, 'feed.html');
    await writeFile(fixturePath, buildApartmentFeedFixture(variant));
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['float'], outputDirectory: root });
    const metadata: RunMetadata = { configHash: 'c', profileHash: 'p', adapterVersion: 'maps-feed-card/v4', sourceCommit: null, browserVersion: null, imageDigest: null, egressProfileId: null };
    const out = await runQueryAttempt({
      browser, config, metadata, store: new LocalArtifactStore(root), runId: 'run_apartment', attemptId: 'att_t',
      attemptRelativeDir: 'capture', searchUrlFor: () => pathToFileURL(fixturePath).toString(),
      viewSettle: { firstBudgetMs: 800, laterBudgetMs: 800, intervalMs: 150 },
    }, { queryId: 'q0001', queryAttemptId: 'qa01', inputIndex: 0, keyword: 'float', deadlineAt: Date.now() + 60_000, allowTransientThrow: false });
    const saved: KeywordResult = JSON.parse(await readFile(join(root, 'capture', out.resultFile), 'utf8'));
    expect(saved.observedCount).toBe(15);
    expect(saved.sequenceVerified).toBe(true);
    expect(saved.quality.screenshotCoverageComplete).toBe(true);
    expect(saved.listings.every((listing) => listing.screenshotIds.length > 0)).toBe(true);
    expect(saved.listings[0]).toMatchObject({ displayPosition: 1, resultType: 'organic', organicRank: 1 });
    const tenth = saved.listings[9];
    expect(tenth).toMatchObject({
      name: apartmentName, displayPosition: 10,
      rating: null, reviewCount: null, address: null,
    });
    if (variant === 'unresolved') {
      expect(saved).toMatchObject({ status: 'partial', stopReason: 'classification_unknown' });
      expect(tenth).toMatchObject({ resultType: 'unknown', organicRank: null });
      expect(saved.listings.slice(9).every((listing) => listing.organicRank === null)).toBe(true);
    } else {
      expect(saved.status).toBe('captured');
      expect(tenth).toMatchObject({ category: 'Apartment', resultType: variant, organicRank: variant === 'ad' ? null : 10 });
      expect(saved.listings[14]).toMatchObject({ displayPosition: 15, organicRank: variant === 'ad' ? 14 : 15 });
      const csv = await readFile(join(root, 'capture', out.resultFile.replace(/\.json$/, '.csv')), 'utf8');
      const row = csv.split('\r\n').find((line) => line.includes(apartmentName));
      expect(row).toContain(variant === 'ad' ? `,10,ad,,${apartmentName}` : `,10,organic,10,${apartmentName}`);
      expect(row).toContain(',,,Apartment,');
    }
  } finally {
    await browser.close();
    await rm(root, { recursive: true, force: true });
  }
});
