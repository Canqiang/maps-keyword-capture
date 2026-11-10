import type { Page } from 'playwright';
import type { FeedSnapshot } from '../core/types.js';
import { sha256Hex } from '../ids.js';
import { readSnapshot } from './maps-adapter.js';

export function snapshotSignature(s: FeedSnapshot): string {
  const rows = s.children.map((c) => [c.index, c.placeHref, c.sponsoredLabels.length, Math.round(c.bounds.y), c.text]);
  return sha256Hex(JSON.stringify({ rows, scrollTop: Math.round(s.scrollTop) }));
}

export interface StableObservation {
  snapshot: FeedSnapshot;
  png: Buffer;
  preSignature: string;
  postSignature: string;
  accepted: boolean;
  rejectionReason: string | null;
  attempts: number;
  /** True when two consecutive viewport screenshots were byte-identical, so map tiles and animations had settled. */
  viewSettled: boolean;
}

export async function captureStableObservation(
  page: Page,
  opts: {
    captureImage?: boolean;
    deadlineAt: number; settleMs?: number; maxAttempts?: number;
    /** Pause between view screenshots. */
    viewSettleIntervalMs?: number;
    /** Longest time spent waiting for the view to settle before taking the last frame anyway. */
    viewSettleBudgetMs?: number;
    /** Consecutive byte-identical frames that count as settled. */
    requiredIdenticalFrames?: number;
    /** While this returns true (e.g. a transient hint is on screen) frames never count as settled. */
    viewBlocker?: () => Promise<boolean>;
    signal?: AbortSignal;
  },
): Promise<StableObservation | null> {
  const settleMs = opts.settleMs ?? 500;
  const maxAttempts = opts.maxAttempts ?? 3;
  const intervalMs = opts.viewSettleIntervalMs ?? 300;
  const budgetMs = opts.viewSettleBudgetMs ?? 2500;
  const required = Math.max(2, opts.requiredIdenticalFrames ?? 3);
  let last: StableObservation | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (Date.now() >= opts.deadlineAt) {
      return last ? { ...last, accepted: false, rejectionReason: 'timeout' } : null;
    }
    const s1 = await readSnapshot(page);
    if (!s1) return null;
    await page.waitForTimeout(settleMs);
    const s2 = await readSnapshot(page);
    if (!s2) return null;
    const pre = snapshotSignature(s2);
    if (snapshotSignature(s1) !== pre) {
      // Record both reads. Mirroring one signature into the other would make a rejected
      // observation look like a stable page that was never screenshotted.
      last = { snapshot: s2, png: Buffer.alloc(0), preSignature: snapshotSignature(s1), postSignature: pre, accepted: false, rejectionReason: 'unstable_results', attempts: attempt, viewSettled: false };
      continue;
    }
    if (opts.captureImage === false) {
      // Two independently read DOM signatures establish structured evidence, not pixel coverage.
      return { snapshot: s2, png: Buffer.alloc(0), preSignature: snapshotSignature(s1), postSignature: pre,
        accepted: true, rejectionReason: null, attempts: attempt, viewSettled: false };
    }
    // The feed is stable; now let the rest of the view settle. Map tiles arrive in batches with
    // short pauses between them, so one identical pair is not proof; require several identical
    // frames in a row, with no blocker on screen. The list is the evidence that matters, so an
    // unsettled view is reported by the caller, not rejected here.
    const viewEnd = Math.min(Date.now() + budgetMs, opts.deadlineAt);
    let png = await page.screenshot({ type: 'png' });
    let identical = 1;
    let viewSettled = false;
    while (Date.now() < viewEnd && !opts.signal?.aborted) {
      await page.waitForTimeout(Math.max(0, Math.min(intervalMs, viewEnd - Date.now())));
      const blocked = opts.viewBlocker ? await opts.viewBlocker() : false;
      const next = await page.screenshot({ type: 'png' });
      identical = !blocked && next.equals(png) ? identical + 1 : 1;
      png = next;
      if (identical >= required) { viewSettled = true; break; }
    }
    const s3 = await readSnapshot(page);
    if (!s3) return null;
    const post = snapshotSignature(s3);
    last = { snapshot: s2, png, preSignature: pre, postSignature: post, accepted: pre === post, rejectionReason: pre === post ? null : 'unstable_results', attempts: attempt, viewSettled };
    if (last.accepted) return last;
  }
  return last;
}
