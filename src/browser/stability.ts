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
}

export async function captureStableObservation(
  page: Page,
  opts: { deadlineAt: number; settleMs?: number; maxAttempts?: number },
): Promise<StableObservation | null> {
  const settleMs = opts.settleMs ?? 500;
  const maxAttempts = opts.maxAttempts ?? 3;
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
      last = { snapshot: s2, png: Buffer.alloc(0), preSignature: pre, postSignature: pre, accepted: false, rejectionReason: 'unstable_results', attempts: attempt };
      continue;
    }
    const png = await page.screenshot({ type: 'png' });
    const s3 = await readSnapshot(page);
    if (!s3) return null;
    const post = snapshotSignature(s3);
    last = { snapshot: s2, png, preSignature: pre, postSignature: post, accepted: pre === post, rejectionReason: pre === post ? null : 'unstable_results', attempts: attempt };
    if (last.accepted) return last;
  }
  return last;
}
