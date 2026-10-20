import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { ConfigError, expectedAreaSchema } from '../config.js';
import { generateGrid, type GridPoint, type GridSpec } from '../grid/grid.js';

/**
 * One configuration for the whole rank-tracking system: the stores to follow, how to recognize
 * them, which keywords matter, the observation grid, and how often each surface samples.
 * Collectors receive plans derived from it; they never read it directly.
 */
const safeId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/u, 'must be a safe path ID');
const keyword = z.string().trim().min(1).max(200);
const timezone = z.string().refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'invalid IANA timezone');
const gridSchema = z.object({ radiusKm: z.number().finite().min(0.1).max(50), size: z.number().int().min(3).max(15).refine(n => n % 2 === 1, 'grid size must be odd') }).strict();
const tierSchema = z.object({
  everyHours: z.number().int().min(1).max(168),
  keywords: z.enum(['core', 'all']),
}).strict();
const gridTierSchema = z.object({
  enabled: z.boolean(),
  /** Grid scans are daily; this is the local hour they start. */
  atHour: z.number().int().min(0).max(23).default(2),
  keywords: z.enum(['core', 'all']).default('core'),
}).strict();
const surfaceSchema = z.object({ point: tierSchema, grid: gridTierSchema }).strict();
const storeSchema = z.object({
  storeId: safeId,
  name: z.string().trim().min(1),
  placeId: z.string().regex(/^ChIJ[\w-]+$/u, 'must be a Google place ID'),
  merchantId: safeId.optional(),
  /** Names that identify the store in OCR'd Android cards; the web matches by place ID. */
  aliases: z.array(z.string().trim().min(2).max(100)).min(1).max(10),
  center: z.object({ latitude: z.number().finite().min(-85).max(85), longitude: z.number().finite().min(-180).max(180) }).strict(),
  grid: gridSchema.optional(),
  expectedArea: expectedAreaSchema.optional(),
  keywords: z.object({
    core: z.array(keyword).min(1).max(10),
    longTail: z.array(keyword).max(60).default([]),
  }).strict(),
  active: z.boolean().default(true),
}).strict();
const schema = z.object({
  schemaVersion: z.literal('tracking-config/v1'),
  /** The stores' local time: scan hours and the local date of every observation use it. */
  timezone: timezone.default('America/New_York'),
  defaults: z.object({ grid: gridSchema.default({ radiusKm: 5, size: 5 }), zoom: z.number().int().min(3).max(21).default(15) }).strict().default({ grid: { radiusKm: 5, size: 5 }, zoom: 15 }),
  stores: z.array(storeSchema).min(1).max(200),
  surfaces: z.object({ web: surfaceSchema, android: surfaceSchema }).strict(),
  database: z.object({ provider: z.literal('mongo'), database: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/u), collection: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/u).default('observations') }).strict(),
}).strict();

export type TrackingConfig = z.infer<typeof schema>;
export type TrackingStore = TrackingConfig['stores'][number];
export type Surface = keyof TrackingConfig['surfaces'];
export type ScanTier = 'point' | 'grid';
export type KeywordTier = 'core' | 'longTail';

export function parseTrackingConfig(raw: unknown): TrackingConfig {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(`invalid tracking configuration: ${parsed.error.issues.map(i => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ')}`);
  const config = parsed.data;
  for (const field of ['storeId', 'placeId'] as const) {
    if (new Set(config.stores.map(s => s[field])).size !== config.stores.length) throw new ConfigError(`duplicate stores.${field}`);
  }
  for (const store of config.stores) {
    const all = [...store.keywords.core, ...store.keywords.longTail].map(k => k.toLowerCase());
    if (new Set(all).size !== all.length) throw new ConfigError(`store ${store.storeId} repeats a keyword across core and long tail`);
  }
  return config;
}
export async function loadTrackingConfig(path: string): Promise<TrackingConfig> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(path, 'utf8')); } catch { throw new ConfigError('cannot read tracking configuration JSON'); }
  return parseTrackingConfig(raw);
}

export function storeGridSpec(config: TrackingConfig, store: TrackingStore): GridSpec {
  const grid = store.grid ?? config.defaults.grid;
  return { center: store.center, radiusKm: grid.radiusKm, size: grid.size };
}
/** The single observation point of a point-tier scan: the store itself, named like the grid centre. */
export function centerPoint(store: TrackingStore): GridPoint {
  return { id: 'r0c0', row: 0, col: 0, latitude: store.center.latitude, longitude: store.center.longitude, distanceKm: 0, ring: 'inner' };
}

export interface PlannedQuery {
  storeId: string; placeId: string; aliases: string[];
  keyword: string; keywordTier: KeywordTier;
  point: GridPoint; zoom: number;
  expectedArea?: TrackingStore['expectedArea'];
}
export interface ScanPlan { surface: Surface; tier: ScanTier; queries: PlannedQuery[] }

/** Expand the configuration into the queries one scan of a surface and tier must run. */
export function planScan(config: TrackingConfig, selection: { surface: Surface; tier: ScanTier; storeIds?: string[] }): ScanPlan {
  const tierConfig = config.surfaces[selection.surface][selection.tier];
  const queries: PlannedQuery[] = [];
  if (selection.tier === 'grid' && !(tierConfig as { enabled: boolean }).enabled) return { surface: selection.surface, tier: selection.tier, queries };
  for (const store of config.stores) {
    if (!store.active || (selection.storeIds && !selection.storeIds.includes(store.storeId))) continue;
    const points = selection.tier === 'grid' ? generateGrid(storeGridSpec(config, store)) : [centerPoint(store)];
    const keywords: Array<[string, KeywordTier]> = [...store.keywords.core.map((k): [string, KeywordTier] => [k, 'core']), ...(tierConfig.keywords === 'all' ? store.keywords.longTail.map((k): [string, KeywordTier] => [k, 'longTail']) : [])];
    for (const point of points) for (const [kw, keywordTier] of keywords) {
      queries.push({ storeId: store.storeId, placeId: store.placeId, aliases: store.aliases, keyword: kw, keywordTier, point, zoom: config.defaults.zoom, ...(store.expectedArea ? { expectedArea: store.expectedArea } : {}) });
    }
  }
  return { surface: selection.surface, tier: selection.tier, queries };
}

export interface WebBatch {
  storeId: string; placeId: string; pointId: string;
  /** Fields for a capture-config/v1 file; the caller adds output and capture settings. */
  config: { keywords: string[]; mapView: { latitude: number; longitude: number; zoom: number }; expectedArea?: TrackingStore['expectedArea'] };
}
/** The desktop collector takes one map view per run, so a scan becomes one batch per store and point (≤ 20 keywords each). */
export function toWebBatches(plan: ScanPlan, maxKeywordsPerBatch = 20): WebBatch[] {
  const groups = new Map<string, { query: PlannedQuery; keywords: string[] }>();
  for (const query of plan.queries) {
    const key = `${query.storeId}/${query.point.id}`;
    const group = groups.get(key) ?? { query, keywords: [] };
    group.keywords.push(query.keyword);
    groups.set(key, group);
  }
  const batches: WebBatch[] = [];
  for (const { query, keywords } of groups.values()) {
    for (let i = 0; i < keywords.length; i += maxKeywordsPerBatch) {
      batches.push({ storeId: query.storeId, placeId: query.placeId, pointId: query.point.id,
        config: { keywords: keywords.slice(i, i + maxKeywordsPerBatch), mapView: { latitude: query.point.latitude, longitude: query.point.longitude, zoom: query.zoom }, ...(query.expectedArea ? { expectedArea: query.expectedArea } : {}) } });
    }
  }
  return batches;
}

export interface AndroidTaskLike {
  storeId: string; storeName: string; keyword: string; aliases: string[];
  location: { id: string; label: string; latitude: number; longitude: number; accuracyMeters: number; toleranceMeters: number; source: string };
  sourceReference: string;
}
/** The Android collector takes at most 20 tasks per run; a scan becomes several runs. */
export function toAndroidRuns(plan: ScanPlan, config: TrackingConfig, maxTasksPerRun = 20): AndroidTaskLike[][] {
  const names = new Map(config.stores.map(s => [s.storeId, s.name]));
  const tasks = plan.queries.map((q): AndroidTaskLike => ({
    storeId: q.storeId, storeName: names.get(q.storeId) ?? q.storeId, keyword: q.keyword, aliases: q.aliases,
    location: { id: q.point.id, label: `${q.point.id} (${q.point.distanceKm} km ${q.point.ring})`, latitude: q.point.latitude, longitude: q.point.longitude, accuracyMeters: 20, toleranceMeters: 100, source: `tracking-config ${plan.tier} scan` },
    sourceReference: `tracking-config/v1 ${plan.surface}/${plan.tier} ${q.storeId} ${q.keywordTier}`,
  }));
  const runs: AndroidTaskLike[][] = [];
  for (let i = 0; i < tasks.length; i += maxTasksPerRun) runs.push(tasks.slice(i, i + maxTasksPerRun));
  return runs;
}
