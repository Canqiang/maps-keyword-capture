import { z } from 'zod';
import { keywordKey } from '../domain/model.js';

export const VOLUME_SOURCE = 'DataForSEO / Google Ads via core-ai MCP';
export interface VolumeRegion { name: string; code: number }
export interface VolumeTask { location: VolumeRegion; language: 'en' | 'zh_CN'; keywords: string[] }
export interface VolumeStore { storeId: string; active: boolean; keywords: { core: string[]; longTail: string[] }; keywordTargets?: { keyword: string; bestVariant?: boolean }[] }
export interface VolumeRow {
  keyword: string; keywordKey: string; locationName: string; locationCode: number; language: 'en' | 'zh_CN'; source: string;
  value: number | null; monthlySearches: Record<string, number | null>; dataThrough: string | null;
  status: 'available' | 'no_data' | 'error'; syncedAt: string | null; attemptedAt: string;
  providerItemReturned?: boolean;
  lastAttemptStatus: 'available' | 'no_data' | 'error'; callId: string | null;
}
export function volumeIdentity(row: Pick<VolumeRow, 'keywordKey' | 'locationCode' | 'language'>): string { return JSON.stringify([row.keywordKey, row.locationCode, row.language]); }
export function planVolumes(stores: VolumeStore[], regions: Record<string, VolumeRegion>) {
  const tasks = new Map<string, VolumeTask>();
  const skipped: string[] = [];
  const planned = stores.filter(s => s.active).flatMap(store => {
    const location = regions[store.storeId];
    if (!location || !Number.isInteger(location.code) || !location.name.trim()) { skipped.push(store.storeId); return []; }
    const words = new Map<string, string>();
    for (const word of [...store.keywords.core, ...store.keywords.longTail, ...(store.keywordTargets ?? []).flatMap(t => [t.keyword, ...(t.bestVariant && !/^best\b/iu.test(t.keyword.trim()) ? ['best ' + t.keyword] : [])])]) {
      const text = word.trim().replace(/\s+/gu, ' '); if (text) words.set(keywordKey(text), text);
    }
    const queries = [...words.values()].map(keyword => {
      const language = /\p{Script=Han}/u.test(keyword) ? 'zh_CN' as const : 'en' as const;
      const key = JSON.stringify([location.code, language]);
      if (!tasks.has(key)) tasks.set(key, { location, language, keywords: [] });
      const task = tasks.get(key)!;
      if (!task.keywords.some(k => keywordKey(k) === keywordKey(keyword))) task.keywords.push(keyword);
      return { keyword, keywordKey: keywordKey(keyword), locationCode: location.code, language };
    });
    return [{ storeId: store.storeId, queries }];
  });
  return { skipped, stores: planned, tasks: [...tasks.values()].flatMap(t => {
    t.keywords.sort(); const chunks: VolumeTask[] = [];
    for (let i = 0; i < t.keywords.length; i += 10) chunks.push({ ...t, keywords: t.keywords.slice(i, i + 10) });
    return chunks;
  }) };
}
export function emptyVolume(keyword: string, task: VolumeTask, at: string, status: 'no_data' | 'error', callId: string | null = null): VolumeRow {
  return { keyword, keywordKey: keywordKey(keyword), locationName: task.location.name, locationCode: task.location.code, language: task.language, source: VOLUME_SOURCE, value: null, monthlySearches: {}, dataThrough: null, status, syncedAt: status === 'error' ? null : at, attemptedAt: at, lastAttemptStatus: status, callId };
}
const metric = z.number().int().nonnegative().nullable();
const itemSchema = z.object({ keyword: z.string(), location_code: z.number().int(), language_code: z.string().nullish(), search_volume: metric.optional(), monthly_searches: z.record(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u), metric).nullish() });
export function parseVolumeResponse(raw: unknown, task: VolumeTask, at: string): VolumeRow[] {
  const hub = z.object({ success: z.literal(true), is_error: z.literal(false), call_id: z.string().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })) }).parse(raw);
  const texts = hub.content.filter(c => c.type === 'text' && c.text);
  if (texts.length !== 1) throw new Error('Ambiguous MCP text response');
  const data = z.object({ status_code: z.literal(20000), items: z.array(itemSchema) }).parse(JSON.parse(texts[0]!.text!));
  const items = new Map<string, z.infer<typeof itemSchema>>();
  for (const item of data.items) {
    if (item.location_code !== task.location.code || (item.language_code && item.language_code !== task.language)) throw new Error('Volume response region/language mismatch');
    const key = keywordKey(item.keyword); if (items.has(key)) throw new Error('Duplicate volume keyword'); items.set(key, item);
  }
  const requested = new Set(task.keywords.map(keywordKey));
  if (items.size !== requested.size || [...requested].some(k=>!items.has(k))) throw new Error('Incomplete keyword coverage in MCP response');
  return task.keywords.map(keyword => {
    const row = emptyVolume(keyword, task, at, 'no_data', hub.call_id ?? null), item = items.get(row.keywordKey);
    if (!item) throw new Error('Missing requested keyword');
    row.providerItemReturned = true;
    row.monthlySearches = item.monthly_searches ?? {};
    row.dataThrough = Object.keys(row.monthlySearches).filter(k => row.monthlySearches[k] !== null).sort().at(-1) ?? null;
    if (row.dataThrough && row.dataThrough > at.slice(0, 7)) throw new Error('Future monthly volume');
    row.value = item.search_volume ?? null;
    if (row.value !== null) row.status = row.lastAttemptStatus = 'available';
    return row;
  });
}
export function mergeVolume(previous: VolumeRow | undefined, current: VolumeRow): VolumeRow {
  if (current.status !== 'available' && previous?.status === 'available' && volumeIdentity(previous) === volumeIdentity(current)) {
    return { ...previous, attemptedAt: current.attemptedAt, lastAttemptStatus: current.status };
  }
  return current;
}
export async function callVolumeTool(server: string, apiKey: string, task: VolumeTask, fetcher: typeof fetch = fetch, deadlineMs?: number): Promise<unknown> {
  if (deadlineMs !== undefined && Date.now() + 210_000 > deadlineMs) throw new Error('Search-volume runtime budget exhausted');
  if (!server.startsWith('https://') || !apiKey) throw new Error('HTTPS core-ai endpoint and API credential required');
  const response = await fetcher(server.replace(/\/$/u, '') + '/api/mcp-hub/tools/dataforseo/kw_data_google_ads_search_volume/call', {
    method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(210_000),
    body: JSON.stringify({ arguments: JSON.stringify({ keywords: task.keywords, location_name: task.location.name, language_code: task.language }), timeout_seconds: 180 }),
  });
  if (!response.ok) throw new Error(`core-ai MCP HTTP ${response.status}`);
  return response.json();
}

/** Explicit recovery only: reuse checked outcomes younger than 24h without a new paid request. */
export function retryVolumePlan(plan: ReturnType<typeof planVolumes>, snapshots: {runId: string; rows: VolumeRow[]}[], now: Date, singleRequests = false) {
  const cache = new Map<string, {row: VolumeRow; sourceRunId: string}>();
  for (const snapshot of snapshots) for (const row of snapshot.rows) {
    const age = now.getTime() - Date.parse(row.syncedAt ?? '');
    if (row.providerItemReturned !== true || !row.callId || row.source !== VOLUME_SOURCE || row.status === 'error' || row.lastAttemptStatus === 'error' || !Number.isFinite(age) || age < 0 || age >= 86400_000) continue;
    const key = volumeIdentity(row), previous = cache.get(key);
    if (!previous || Date.parse(row.syncedAt!) > Date.parse(previous.row.syncedAt!)) cache.set(key, {row, sourceRunId: snapshot.runId});
  }
  const reused = new Map<string, {row: VolumeRow; sourceRunId: string}>();
  const tasks = plan.tasks.flatMap(task => {
    const keywords = task.keywords.filter(keyword => {
      const key = volumeIdentity({keywordKey: keywordKey(keyword), locationCode: task.location.code, language: task.language});
      const match = cache.get(key);
      if (!match || match.row.locationName !== task.location.name) return true;
      reused.set(key, match); return false;
    });
    return keywords.length ? [{...task, keywords}] : [];
  });
  return { tasks: singleRequests ? tasks.flatMap(t=>t.keywords.map(keyword=>({...t, keywords:[keyword]}))) : tasks, reused: [...reused.values()] };
}
