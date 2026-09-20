import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { KeywordResult, Observation, RunMetadata } from '../src/contracts.js';
import { parseConfig } from '../src/config.js';
import { runQueryAttempt } from '../src/runner/query-runner.js';
import { LocalArtifactStore } from '../src/storage/local.js';
import { screenshotBudgetKeyword, writeScreenshotBudgetFixture } from './fixtures/screenshot-budget-fixture.js';

let browser: Browser;
let root: string;
let fixtureUrl: string;
let deployedCapture: Record<string, unknown>;
const metadata: RunMetadata = {
  configHash: 'fixture', profileHash: 'fixture', adapterVersion: 'maps-feed-card/v3',
  sourceCommit: null, browserVersion: null, imageDigest: null, egressProfileId: null,
};

beforeAll(async () => {
  // Exercise the committed UAT budget, so reverting only the deployment config is caught.
  const manifest = parse(await readFile(new URL('../deploy/uat-monitor/configmap.yaml', import.meta.url), 'utf8'));
  deployedCapture = JSON.parse(manifest.data['monitor.json']).capture;
  root = await mkdtemp(join(tmpdir(), 'mkc-screenshot-budget-'));
  fixtureUrl = await writeScreenshotBudgetFixture(root);
  browser = await chromium.launch({ channel: 'chromium', headless: true });
});
afterAll(async () => {
  await browser?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

async function capture(queryId: string, overrides: Record<string, unknown> = {}) {
  const { config } = parseConfig({
    schemaVersion: '1', keywords: [screenshotBudgetKeyword], outputDirectory: root,
    ...deployedCapture, ...overrides,
  });
  const attemptRelativeDir = `run_fixture/${queryId}`;
  const events: Record<string, unknown>[] = [];
  const out = await runQueryAttempt({
    browser, store: new LocalArtifactStore(root), config, runId: 'run_fixture', attemptId: 'att_fixture',
    metadata, attemptRelativeDir, searchUrlFor: () => fixtureUrl,
    log: event => events.push(event),
  }, {
    queryId, inputIndex: 0, keyword: screenshotBudgetKeyword, queryAttemptId: 'qa01',
    deadlineAt: Date.now() + config.keywordTimeoutMs, allowTransientThrow: false,
  });
  const observations = (await readFile(join(root, attemptRelativeDir, queryId, 'qa01/observations.jsonl'), 'utf8'))
    .trim().split('\n').map(line => JSON.parse(line) as Observation);
  return { ...out, observations, events, config, attemptRelativeDir };
}

describe('UAT screenshot budget on variable-height lazy-loaded results', () => {
  it('persists complete PNG, JSON and CSV evidence for all 15 ranks with the deployed budget', async () => {
    const out = await capture('deployed_budget');
    expect(out.result).toMatchObject({ status: 'captured', stopReason: 'limit_reached', observedCount: 15, sequenceVerified: true });
    expect(out.result.quality).toMatchObject({ verifiedPrefixLength: 15, screenshotCoverageComplete: true, classificationComplete: true });
    expect(out.result.listings.map(listing => listing.displayPosition)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(out.result.listings.every(listing => listing.screenshotIds.length > 0)).toBe(true);
    expect(out.result.screenshots).toHaveLength(6);
    expect(out.result.screenshots.length).toBeLessThanOrEqual(out.config.maxScreenshotsPerKeyword);
    expect(out.events.filter(event => event.stage === 'scroll').length).toBeLessThanOrEqual(out.config.maxScrollsPerKeyword);
    expect(out.observations.slice(0, 5).map(observation => observation.scrollOffset)).toEqual([0, 653, 1346, 1749, 2401]);
    expect(out.observations.at(-1)).toMatchObject({ scrollOffset: 3114, screenshotIds: [expect.any(String)] });
    expect(out.observations.at(-1)!.cards.find(card => card.name === 'Shop 15')?.fullyVisible).toBe(true);

    for (const artifact of out.artifacts) {
      const bytes = await readFile(join(root, out.attemptRelativeDir, artifact.queryId!, artifact.queryAttemptId!, artifact.filename));
      expect(bytes.length).toBe(artifact.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
      if (artifact.kind === 'results') expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }
    const saved = JSON.parse(await readFile(join(root, out.attemptRelativeDir, out.resultFile), 'utf8')) as KeywordResult;
    expect(saved.listings).toEqual(out.result.listings);
    expect(saved.quality.screenshotCoverageComplete).toBe(true);
    // Fixture fields contain no commas/quotes, so each CSV line has one unquoted cell per field.
    const rows = (await readFile(join(root, out.attemptRelativeDir, out.resultFile.replace(/\.json$/, '.csv')), 'utf8'))
      .replace(/^\uFEFF/, '').trim().split('\r\n').map(line => line.split(','));
    const header = rows.shift()!;
    expect(rows).toHaveLength(15);
    for (const [index, row] of rows.entries()) {
      expect(row[header.indexOf('display_position')]).toBe(String(index + 1));
      expect(row[header.indexOf('name')]).toBe(saved.listings[index]!.name);
      const expectedFiles = saved.listings[index]!.screenshotIds.map(id => saved.screenshots.find(shot => shot.id === id)!.filename);
      expect(row[header.indexOf('screenshot_files')]!.split(';')).toEqual(expectedFiles);
    }
  });

  it('retains an honest screenshot_limit partial when explicitly capped at five screenshots', async () => {
    const out = await capture('five_screenshots', { maxScreenshotsPerKeyword: 5 });
    expect(out.result).toMatchObject({ status: 'partial', stopReason: 'screenshot_limit', observedCount: 15, error: null });
    expect(out.result.quality).toMatchObject({ verifiedPrefixLength: 15, screenshotCoverageComplete: false, classificationComplete: true });
    expect(out.result.screenshots).toHaveLength(5);
    expect(out.result.listings.slice(0, 14).every(listing => listing.screenshotIds.length > 0)).toBe(true);
    expect(out.result.listings[14]!.screenshotIds).toEqual([]);
    expect(out.observations.map(observation => observation.scrollOffset)).toEqual([0, 653, 1346, 1749, 2401]);
    expect(out.observations.at(-1)!.cards.find(card => card.name === 'Shop 15')?.fullyVisible).toBe(false);
  });

  it('stops at an explicit scroll budget without claiming missing screenshot coverage', async () => {
    const out = await capture('four_scrolls', { maxScreenshotsPerKeyword: 8, maxScrollsPerKeyword: 4 });
    expect(out.result).toMatchObject({ status: 'partial', stopReason: 'scroll_limit', observedCount: 15, error: null });
    expect(out.result.quality.screenshotCoverageComplete).toBe(false);
    expect(out.result.listings[14]!.screenshotIds).toEqual([]);
    expect(out.events.filter(event => event.stage === 'scroll')).toHaveLength(4);
    expect(out.result.screenshots).toHaveLength(5);
  });
});
