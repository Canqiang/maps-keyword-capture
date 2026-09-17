import { createHash, randomBytes } from 'node:crypto';

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function hashJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function compactUtc(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function newRunId(now: Date = new Date()): string {
  return `run_${compactUtc(now)}_${randomBytes(3).toString('hex')}`;
}

export function newAttemptId(): string {
  return `att_${randomBytes(4).toString('hex')}`;
}

export function queryIdFor(inputIndex: number): string {
  return `q${String(inputIndex + 1).padStart(4, '0')}`;
}

export function queryAttemptIdFor(attemptNumber: number): string {
  return `qa${String(attemptNumber).padStart(2, '0')}`;
}

export function observationIdFor(queryAttemptId: string, n: number): string {
  return `${queryAttemptId}_obs${String(n).padStart(3, '0')}`;
}

export function occurrenceIdFor(parts: { placeKey: string; isAd: boolean; feedChildIndex: number }): string {
  const digest = sha256Hex(`${parts.placeKey}|${parts.isAd ? 'ad' : 'organic'}|${parts.feedChildIndex}`);
  return `occ_${digest.slice(0, 16)}`;
}
