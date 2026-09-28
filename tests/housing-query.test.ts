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
import { buildHousingFeedFixture, housingFixtures } from './fixtures/housing-fixture.js';

it.each(['organic', 'ad', 'unresolved'] as const)('persists House and Lodging cards with correct %s ranking and CSV fields', async variant => {
  const root = await mkdtemp(join(tmpdir(), 'mkc-housing-'));
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const path = join(root, 'feed.html');
    await writeFile(path, buildHousingFeedFixture(variant));
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['float'], outputDirectory: root });
    const metadata: RunMetadata = { configHash: 'c', profileHash: 'p', adapterVersion: 'maps-feed-card/v5', sourceCommit: null, browserVersion: null, imageDigest: null, egressProfileId: null };
    const out = await runQueryAttempt({ browser, config, metadata, store: new LocalArtifactStore(root), runId: 'run_housing', attemptId: 'att_t', attemptRelativeDir: 'capture', searchUrlFor: () => pathToFileURL(path).toString(), viewSettle: { firstBudgetMs: 800, laterBudgetMs: 800, intervalMs: 150 } }, { queryId: 'q0001', queryAttemptId: 'qa01', inputIndex: 0, keyword: 'float', deadlineAt: Date.now() + 60_000, allowTransientThrow: false });
    const saved: KeywordResult = JSON.parse(await readFile(join(root, 'capture', out.resultFile), 'utf8'));
    expect(saved.observedCount).toBe(15);
    expect(saved.sequenceVerified).toBe(true);
    expect(saved.quality.screenshotCoverageComplete).toBe(true);
    expect(saved.listings.every(row => row.screenshotIds.length > 0)).toBe(true);
    const csv = await readFile(join(root, 'capture', out.resultFile.replace(/\.json$/, '.csv')), 'utf8');
    for (const item of housingFixtures) {
      const row = saved.listings[item.position - 1]!;
      expect(row).toMatchObject({ displayPosition: item.position, name: item.name, rating: null, reviewCount: null, address: null });
      if (variant === 'unresolved') expect(row).toMatchObject({ resultType: 'unknown', organicRank: null });
      else {
        expect(row).toMatchObject({ category: item.category, resultType: variant, organicRank: variant === 'ad' ? null : item.position });
        const line = csv.split('\r\n').find(value => value.includes(item.name));
        expect(line).toContain(`,${item.position},${variant},${variant === 'ad' ? '' : item.position},${item.name}`);
        expect(line).toContain(`,,,${item.category},`);
      }
    }
    if (variant === 'unresolved') {
      expect(saved).toMatchObject({ status: 'partial', stopReason: 'classification_unknown' });
      expect(saved.listings.slice(7).every(row => row.organicRank === null)).toBe(true);
    } else {
      expect(saved.status).toBe('captured');
      expect(saved.listings[14]).toMatchObject({ displayPosition: 15, organicRank: variant === 'ad' ? 13 : 15 });
    }
  } finally { await browser.close(); await rm(root, { recursive: true, force: true }); }
});
