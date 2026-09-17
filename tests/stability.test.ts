import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openSearch } from '../src/browser/maps-adapter.js';
import { captureStableObservation, snapshotSignature } from '../src/browser/stability.js';
import { namedCards, writeFixture } from './fixtures/feed-fixture.js';

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
});
afterAll(async () => { await browser.close(); });

describe('captureStableObservation', () => {
  it('accepts a stable page on the first attempt and returns a PNG', async () => {
    await openSearch(page, await writeFixture({ query: 'q', cards: namedCards(6) }), 5000);
    const obs = await captureStableObservation(page, { deadlineAt: Date.now() + 10_000, settleMs: 200 });
    expect(obs).not.toBeNull();
    expect(obs!.accepted).toBe(true);
    expect(obs!.attempts).toBe(1);
    expect(obs!.preSignature).toBe(obs!.postSignature);
    expect(obs!.png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(snapshotSignature(obs!.snapshot)).toBe(obs!.preSignature);
  });

  it('rejects a page whose feed keeps changing', async () => {
    await openSearch(page, await writeFixture({ query: 'q', cards: namedCards(6), jitterMs: 120 }), 5000);
    const obs = await captureStableObservation(page, { deadlineAt: Date.now() + 10_000, settleMs: 300, maxAttempts: 3 });
    expect(obs!.accepted).toBe(false);
    expect(obs!.rejectionReason).toBe('unstable_results');
    expect(obs!.attempts).toBe(3);
  });

  it('returns null without a feed', async () => {
    await openSearch(page, await writeFixture({ query: 'q', cards: [], noResults: true }), 3000);
    expect(await captureStableObservation(page, { deadlineAt: Date.now() + 2000, settleMs: 100 })).toBeNull();
  });

  it('returns null when the deadline has already passed before any read', async () => {
    await openSearch(page, await writeFixture({ query: 'q', cards: namedCards(6) }), 5000);
    expect(await captureStableObservation(page, { deadlineAt: Date.now() - 1, settleMs: 100 })).toBeNull();
  });

  it('reports timeout when the deadline passes after an unstable attempt', async () => {
    await openSearch(page, await writeFixture({ query: 'q', cards: namedCards(6), jitterMs: 120 }), 5000);
    // Attempt 1 takes ~300 ms and fails the settle check; the deadline expires before attempt 3 can start.
    const obs = await captureStableObservation(page, { deadlineAt: Date.now() + 450, settleMs: 300, maxAttempts: 5 });
    expect(obs).not.toBeNull();
    expect(obs!.accepted).toBe(false);
    expect(obs!.rejectionReason).toBe('timeout');
    expect(obs!.attempts).toBeGreaterThanOrEqual(1);
    expect(obs!.attempts).toBeLessThan(5);
  });
});
