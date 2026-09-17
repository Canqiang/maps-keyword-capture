import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import type { BatchManifest } from '../src/contracts.js';
import { openSearch } from '../src/browser/maps-adapter.js';
import { batchDeadlineMs, runBatch } from '../src/runner/batch-runner.js';
import { LocalArtifactStore } from '../src/storage/local.js';
import type { ArtifactStore, PersistOptions, WrittenFile } from '../src/storage/types.js';
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
  it('trips the circuit breaker on a consent wall as well', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(5) });
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['one', 'two'], outputDirectory: root });
    let calls = 0;
    const out = await runBatch({
      config, searchUrlFor: () => url,
      openSearchImpl: async () => { calls += 1; return { state: { kind: 'consent' as const }, finalUrl: 'https://consent.google.com/m' }; },
    });
    expect(calls).toBe(1);
    expect(out.manifest.queries.map((q) => [q.status, q.stopReason])).toEqual([['blocked', 'consent_required'], ['skipped', 'batch_blocked']]);
  });

  it('cancels the in-flight keyword and still publishes a final manifest', async () => {
    const urls: Record<string, string> = {
      'cancel one': await writeFixture({ query: 'cancel one', cards: namedCards(6), moreCards: namedCards(12, 6) }),
      'cancel two': await writeFixture({ query: 'cancel two', cards: namedCards(6), endOfList: true }),
    };
    const { config } = parseConfig({ schemaVersion: '1', keywords: Object.keys(urls), outputDirectory: root });
    const controller = new AbortController();
    const out = await runBatch({
      config, searchUrlFor: (k) => urls[k]!, signal: controller.signal,
      log: (e) => { if (e['stage'] === 'round') controller.abort(); },
    });
    const first = out.manifest.queries[0]!;
    const second = out.manifest.queries[1]!;
    expect(['partial', 'failed']).toContain(first.status);
    expect(first.stopReason).toBe('cancelled');
    expect([second.status, second.stopReason]).toEqual(['skipped', 'cancelled']);
    const onDisk = JSON.parse(await readFile(out.manifestPath, 'utf8')) as BatchManifest;
    expect(onDisk.finishedAt).not.toBeNull();
    expect(onDisk.queries.every((q) => q.status !== 'pending' && q.status !== 'running')).toBe(true);
  });

  it('retries a keyword in a fresh attempt when the browser context fails once', async () => {
    const url = await writeFixture({ query: 'flaky', cards: namedCards(5), endOfList: true });
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['flaky'], outputDirectory: root });
    const real = await chromium.launch({ channel: 'chromium', headless: true });
    let contexts = 0;
    const flaky = new Proxy(real, {
      get(target, prop) {
        if (prop === 'newContext') {
          return async (...args: unknown[]) => {
            contexts += 1;
            if (contexts === 1) throw new Error('Target browser has been closed');
            return (target.newContext as (...a: never[]) => unknown)(...(args as never[]));
          };
        }
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as Browser;
    try {
      const out = await runBatch({ config, searchUrlFor: () => url, launch: async () => flaky });
      const row = out.manifest.queries[0]!;
      expect(contexts).toBe(2);
      expect(row.status).toBe('captured');
      expect(row.selectedQueryAttemptId).toBe('qa02');
      expect(row.resultFile).toMatch(/^q0001\/qa02\//);
      const onDisk = JSON.parse(await readFile(out.manifestPath, 'utf8')) as BatchManifest;
      expect(onDisk.finishedAt).not.toBeNull();
    } finally {
      await real.close().catch(() => undefined);
    }
  });

  it('records a terminal row and keeps going when a keyword throws a non-transient error', async () => {
    const url = await writeFixture({ query: 'good', cards: namedCards(5), endOfList: true });
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['good', 'boom'], outputDirectory: root, keywordTimeoutMs: 10_000 });
    let current = '';
    const out = await runBatch({
      config,
      searchUrlFor: (k) => { current = k; return url; },
      openSearchImpl: async (page, u, t) => {
        if (current === 'boom') throw new Error('page exploded');
        return openSearch(page, u, t);
      },
    });
    expect(out.manifest.queries.map((q) => q.status)).toEqual(['captured', 'failed']);
    expect(out.manifest.queries[1]!.stopReason).toBe('error');
    const onDisk = JSON.parse(await readFile(out.manifestPath, 'utf8')) as BatchManifest;
    expect(onDisk.finishedAt).not.toBeNull();
    expect(onDisk.queries.every((q) => q.status !== 'pending' && q.status !== 'running')).toBe(true);
  });

  it('publishes a terminal manifest and rethrows when a keyword cannot write its result JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mkc-batch-throw-'));
    try {
      const inner = new LocalArtifactStore(dir);
      const store: ArtifactStore = {
        mode: 'local_only',
        rootDirectory: inner.rootDirectory,
        absolutePath: (p: string) => inner.absolutePath(p),
        writeFile: async (p: string, data: Buffer | string): Promise<WrittenFile> => {
          if (/__q0001\.json$/.test(p)) throw new Error('disk full');
          return inner.writeFile(p, data);
        },
        persist: (file: WrittenFile, options?: PersistOptions) => inner.persist(file, options),
      };
      const url = await writeFixture({ query: 'q', cards: namedCards(3), endMarkerInitially: true });
      const { config } = parseConfig({ schemaVersion: '1', keywords: ['q', 'q'], outputDirectory: dir });
      await expect(runBatch({ config, store, searchUrlFor: () => url })).rejects.toThrow(/result JSON could not be written/);
      const files = (await readdir(dir, { recursive: true })).map(String);
      const manifestFile = files.find((f) => f.endsWith('manifest.json') && !f.endsWith('progress.json'));
      expect(manifestFile).toBeDefined();
      const published = JSON.parse(await readFile(join(dir, manifestFile!), 'utf8')) as BatchManifest;
      expect(published.finishedAt).not.toBeNull();
      expect(published.queries.map((q) => [q.status, q.stopReason])).toEqual([['skipped', 'storage_unavailable'], ['skipped', 'storage_unavailable']]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
