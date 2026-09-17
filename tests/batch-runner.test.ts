import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import type { BatchManifest } from '../src/contracts.js';
import { batchDeadlineMs, runBatch } from '../src/runner/batch-runner.js';
import { namedCards, writeFixture } from './fixtures/feed-fixture.js';

let root: string;
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'mkc-batch-')); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('runBatch', () => {
  it('computes the batch deadline from the keyword count', () => {
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['a', 'b'], keywordTimeoutMs: 90_000, outputDirectory: root });
    expect(batchDeadlineMs(config)).toBe((60 + 2 * (90 + 30) + 60) * 1000);
  });

  it('runs every keyword, writes manifests, and exits 0 when all are captured', async () => {
    const urls: Record<string, string> = {
      'fried chicken mineola': await writeFixture({ query: 'fried chicken mineola', cards: namedCards(8), endOfList: true }),
      'matcha mineola': await writeFixture({ query: 'matcha mineola', cards: [{ name: 'Gong Cha', ad: true }, ...namedCards(16)] }),
    };
    const { config } = parseConfig({ schemaVersion: '1', keywords: Object.keys(urls), outputDirectory: root, maxScrollsPerKeyword: 6 });
    const out = await runBatch({ config, searchUrlFor: (k) => urls[k]! });
    expect(out.exitCode).toBe(0);
    expect(out.manifest.status).toBe('completed');
    expect(out.manifest.persistenceMode).toBe('local_only');
    expect(out.manifest.queries.map((q) => [q.queryId, q.status, q.persistenceStatus])).toEqual([['q0001', 'captured', 'not_requested'], ['q0002', 'captured', 'not_requested']]);
    const onDisk = JSON.parse(await readFile(out.manifestPath, 'utf8')) as BatchManifest;
    expect(onDisk.status).toBe('completed');
    expect(onDisk.artifacts.length).toBeGreaterThan(6);
    expect(onDisk.artifacts.every((a) => a.storageStatus === 'local_only')).toBe(true);
    const request = JSON.parse(await readFile(join(out.attemptRoot, 'request.json'), 'utf8'));
    expect(request.config.keywords).toEqual(Object.keys(urls));
    expect(out.manifest.metadata.browserVersion).toMatch(/^\d+\./);
  });

  it('trips the circuit breaker on CAPTCHA and skips the rest', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(5) });
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['one', 'two', 'three'], outputDirectory: root });
    let calls = 0;
    const out = await runBatch({
      config, searchUrlFor: () => url,
      openSearchImpl: async () => { calls += 1; return { state: { kind: 'captcha' as const }, finalUrl: 'https://www.google.com/sorry/x' }; },
    });
    expect(calls).toBe(1);
    expect(out.manifest.queries.map((q) => [q.status, q.stopReason])).toEqual([['blocked', 'captcha'], ['skipped', 'batch_blocked'], ['skipped', 'batch_blocked']]);
    expect(out.manifest.status).toBe('partial');
    expect(out.exitCode).toBe(2);
  });

  it('marks all keywords skipped when the browser cannot start', async () => {
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['one', 'two'], outputDirectory: root });
    const out = await runBatch({ config, launch: async () => { throw new Error('no chromium'); } });
    expect(out.manifest.queries.map((q) => [q.status, q.stopReason])).toEqual([['skipped', 'browser_startup_failed'], ['skipped', 'browser_startup_failed']]);
    expect(out.manifest.status).toBe('failed');
    expect(out.exitCode).toBe(1);
  });

  it('skips remaining keywords after cancellation', async () => {
    const url = await writeFixture({ query: 'a', cards: namedCards(5), endOfList: true });
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['a', 'b'], outputDirectory: root });
    const controller = new AbortController();
    const out = await runBatch({
      config, searchUrlFor: () => url, signal: controller.signal,
      log: (e) => { if (e['stage'] === 'query_done') controller.abort(); },
    });
    expect(out.manifest.queries.map((q) => q.status)).toEqual(['captured', 'skipped']);
    expect(out.manifest.queries[1]!.stopReason).toBe('cancelled');
  });
});
