import { z } from 'zod';
import { hashJson } from '../ids.js';
import type { EnrolledStore } from './config.js';

const keywordSchema = z.object({ keyword: z.string().refine(k => k.trim().length > 0), priority: z.string(), target_surface_types: z.array(z.string()).optional() }).passthrough();
const recordSchema = z.object({ local_keyword_id: z.string().min(1), merchant_id: z.string().min(1), place_id: z.string().min(1), keywords: z.array(keywordSchema), updated_time: z.string().optional() }).passthrough();
const responseSchema = z.object({ place_id: z.string().min(1), local_keywords: z.array(recordSchema) }).passthrough();
export interface SourceKeyword { keyword: string; priority: string; sourceIndex: number }
export interface KeywordRecord { recordId: string; merchantId: string; placeId: string; updatedTime: string | null; updatedTimeNote: string | null; fetchedAt: string; sourceResponseHash: string; keywords: SourceKeyword[] }
export interface KeywordSource { read(store: EnrolledStore, signal?: AbortSignal): Promise<KeywordRecord> }
export function parseKeywordResponse(raw: unknown, store: EnrolledStore, fetchedAt = new Date().toISOString()): KeywordRecord {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new Error('source_invalid_response');
  const body = parsed.data;
  if (body.place_id !== store.placeId) throw new Error('source_identity_mismatch');
  if (body.local_keywords.length === 0) throw new Error('source_record_missing');
  if (body.local_keywords.length !== 1) throw new Error('source_ambiguous_records');
  const record = body.local_keywords[0]!;
  if (record.merchant_id !== store.merchantId || record.place_id !== store.placeId) throw new Error('source_identity_mismatch');
  return { recordId: record.local_keyword_id, merchantId: record.merchant_id, placeId: record.place_id, updatedTime: record.updated_time ?? null, updatedTimeNote: record.updated_time ? null : 'The keyword API does not expose the record update time.', fetchedAt, sourceResponseHash: hashJson(raw), keywords: record.keywords.map((k, sourceIndex) => ({ keyword: k.keyword, priority: k.priority, sourceIndex })) };
}
export const SELECTION_POLICY = 'P0-P3 then unknown priority; stable source order within each priority; exact query text deduplication; no score or surface filter';
export function selectKeywords(keywords: SourceKeyword[], limit: number): { keywords: SourceKeyword[]; duplicateCount: number; unknownPriorityCount: number; availableCount: number } {
  const priority = (p: string) => ({ P0: 0, P1: 1, P2: 2, P3: 3 })[p] ?? 4;
  const ordered = [...keywords].sort((a, b) => priority(a.priority) - priority(b.priority) || a.sourceIndex - b.sourceIndex);
  const seen = new Set<string>();
  const unique = ordered.filter(k => { if (seen.has(k.keyword)) return false; seen.add(k.keyword); return true; });
  return { keywords: unique.slice(0, limit), duplicateCount: keywords.length - unique.length, unknownPriorityCount: keywords.filter(k => priority(k.priority) === 4).length, availableCount: unique.length };
}
export function splitKeywords<T>(keywords: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1 || size > 20) throw new Error('invalid batch size');
  const batches: T[][] = [];
  for (let i = 0; i < keywords.length; i += size) batches.push(keywords.slice(i, i + size));
  return batches;
}
export class KeywordApiSource implements KeywordSource {
  constructor(private readonly options: { baseUrl: string; timeoutMs: number; fetch?: typeof fetch; token?: string }) {}
  async read(store: EnrolledStore, signal?: AbortSignal): Promise<KeywordRecord> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    const stop = new Promise<never>((_, reject) => {
      const fail = (code: string) => { controller.abort(); reject(new Error(code)); };
      timer = setTimeout(() => fail('source_timeout'), this.options.timeoutMs);
      onAbort = () => fail('cancelled');
      if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const request = async () => {
        const response = await (this.options.fetch ?? fetch)(`${this.options.baseUrl.replace(/\/$/, '')}/seo/keyword/local/${encodeURIComponent(store.placeId)}`, { method: 'GET', redirect: 'error', signal: controller.signal, headers: this.options.token ? { Authorization: `Bearer ${this.options.token}` } : {} });
        if (!response.ok) throw new Error(`source_http_${response.status}`);
        return parseKeywordResponse(await response.json(), store);
      };
      return await Promise.race([stop, request()]);
    } finally { if (timer) clearTimeout(timer); if (onAbort) signal?.removeEventListener('abort', onAbort); }
  }
}
