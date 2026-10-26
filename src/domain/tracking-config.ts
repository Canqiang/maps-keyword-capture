import { readFile } from 'node:fs/promises';
import { keywordKey } from './model.js';
import type { IngestContext } from './ingest.js';
import { z } from 'zod';
import { ConfigError, expectedAreaSchema } from '../config.js';
import { generateGrid, ringFor, type GridPoint, type GridSpec } from '../grid/grid.js';

/**
 * One configuration for the whole rank-tracking system: the stores to follow, how to recognize
 * them, which keywords matter, the observation grid, and how often each surface samples.
 * Collectors receive plans derived from it; they never read it directly.
 */
const safeId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/u, 'must be a safe path ID');
const keyword = z.string().trim().min(1).max(200).refine(s => !/[\x00-\x1f\x7f]/u.test(s), 'keyword must not contain control characters');
const timezone = z.string().refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'invalid IANA timezone');
const gridSchema = z.object({ radiusKm: z.number().finite().min(0.1).max(50), size: z.number().int().min(3).max(15).refine(n => n % 2 === 1, 'grid size must be odd') }).strict();
const tierSchema = z.object({
  everyHours: z.number().int().min(1).max(168),
  keywords: z.enum(['core', 'all']),
  /** Whether monitored keywords with bestVariant also search "best <keyword>" on this surface. Android
   * leaves them out: one native query takes minutes and the variants would double a day-long pass. */
  bestVariants: z.boolean().default(true),
}).strict();
const gridTierSchema = z.object({
  enabled: z.boolean(),
  /** Grid scans are daily; this is the local hour they start. */
  atHour: z.number().int().min(0).max(23).default(2),
  keywords: z.enum(['core', 'all']).default('core'),
}).strict();
const surfaceSchema = z.object({ point: tierSchema, grid: gridTierSchema }).strict();
const fixedPointSchema = z.object({
  id: safeId, label: z.string().min(1), latitude: z.number().finite().min(-85).max(85), longitude: z.number().finite().min(-180).max(180),
  distanceKm: z.number().finite().min(0).max(50), direction: z.string().min(1), sourceReference: z.string().min(1),
}).strict();
const monitoringCatalogSchema = z.object({
  version: z.string().min(1),
  source: z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/u), documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), sectionId: z.string().min(1), sourceBaselineIsLive: z.literal(false) }).strict(),
}).strict();
/** A goal rank for one keyword at one fixed point. Report fields are kept when a catalog supplied them; targets set in the UI omit them. */
const pointTargetSchema = z.object({
  pointId: safeId, pointLabel: z.string().min(1), radiusKm: z.number().finite().min(0).max(50), targetRank: z.number().int().min(1).max(20),
  targetText: z.string().min(1), historicalBaselineDisplay: z.string().min(1).optional(), historicalEvidenceRef: z.string().nullable().optional(), sourceCellText: z.string().min(1).optional(),
}).strict();
/**
 * A monitored keyword: scanned at every fixed point of its store, or only at `scanPoints`
 * (e.g. city-named queries that Google recenters regardless of the map view). Point targets are optional.
 */
const keywordTargetSchema = z.object({
  keyword, sourceSearchVolumeText: z.string().max(300).default(''), sourceRoleAndConditions: z.string().max(1000).default(''), pointTargets: z.array(pointTargetSchema).default([]),
  scanPoints: z.array(safeId).min(1).max(100).optional(),
  /** Also search "best <keyword>" at the same points; it is recorded as its own keyword. */
  bestVariant: z.boolean().optional(),
}).strict();

/** The "best" form of a monitored keyword, or null when the keyword already starts with "best". */
export function bestVariantOf(keyword: string): string | null {
  const trimmed = keyword.trim().replace(/\s+/gu, ' ');
  return /^best\b/iu.test(trimmed) ? null : `best ${trimmed}`;
}
export const monitoringTargetSchema = z.object({ catalog: monitoringCatalogSchema, point: fixedPointSchema, target: pointTargetSchema }).strict();
const storeSchema = z.object({
  storeId: safeId,
  name: z.string().trim().min(1).max(500),
  placeId: z.string().regex(/^ChIJ[\w-]+$/u, 'must be a Google place ID'),
  merchantId: safeId.optional(),
  /** Names that identify the store in OCR'd Android cards; the web matches by place ID. */
  aliases: z.array(z.string().trim().min(2).max(100)).min(1).max(10),
  center: z.object({ latitude: z.number().finite().min(-85).max(85), longitude: z.number().finite().min(-180).max(180) }).strict(),
  grid: gridSchema.optional(),
  expectedArea: expectedAreaSchema.optional(),
  /** Explicit samples, independent of square-grid coordinates and old r0c0 history. */
  fixedPoints: z.array(fixedPointSchema).min(1).max(100).optional(),
  monitoringCatalog: monitoringCatalogSchema.optional(),
  /** Active exact-query scope. keywords retains older discovery/history terms. */
  keywordTargets: z.array(keywordTargetSchema).min(1).max(70).optional(),
  keywords: z.object({
    core: z.array(keyword).min(1).max(10),
    longTail: z.array(keyword).max(60).default([]),
  }).strict(),
  active: z.boolean().default(true),
}).strict().superRefine((store, ctx) => {
  const pointIds = new Set(store.fixedPoints?.map(p => p.id) ?? []);
  if (pointIds.size !== (store.fixedPoints?.length ?? 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fixedPoints'], message: 'needs unique fixed point IDs' });
  const seen = new Set<string>();
  const monitored = new Set((store.keywordTargets ?? []).map(t => keywordKey(t.keyword)));
  for (const [index, target] of (store.keywordTargets ?? []).entries()) {
    if (target.bestVariant) {
      const variant = bestVariantOf(target.keyword);
      if (!variant) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keywordTargets', index, 'bestVariant'], message: `${target.keyword} already starts with best` });
      else if (monitored.has(keywordKey(variant))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keywordTargets', index, 'bestVariant'], message: `${variant} is already a monitored keyword` });
    }
    const key = keywordKey(target.keyword);
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keywordTargets', index, 'keyword'], message: `monitored keyword repeated: ${target.keyword}` });
    seen.add(key);
    for (const pointId of target.scanPoints ?? []) if (!pointIds.has(pointId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keywordTargets', index, 'scanPoints'], message: `scan point ${pointId} is not a fixed point of this store` });
    if (target.scanPoints && new Set(target.scanPoints).size !== target.scanPoints.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keywordTargets', index, 'scanPoints'], message: `scan points repeated for ${target.keyword}` });
    const targetPoints = new Set<string>();
    for (const goal of target.pointTargets) {
      if (target.scanPoints && !target.scanPoints.includes(goal.pointId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keywordTargets', index, 'pointTargets'], message: `target point ${goal.pointId} is not scanned for ${target.keyword}` });
      if (!pointIds.has(goal.pointId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keywordTargets', index, 'pointTargets'], message: `target point ${goal.pointId} is not a fixed point of this store` });
      if (targetPoints.has(goal.pointId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keywordTargets', index, 'pointTargets'], message: `target point ${goal.pointId} repeated for ${target.keyword}` });
      targetPoints.add(goal.pointId);
    }
  }
});
const schema = z.object({
  schemaVersion: z.literal('tracking-config/v1'),
  /** The stores' local time: scan hours and the local date of every observation use it. */
  timezone: timezone.default('America/New_York'),
  defaults: z.object({ grid: gridSchema.default({ radiusKm: 5, size: 5 }), zoom: z.number().int().min(3).max(21).default(15) }).strict().default({ grid: { radiusKm: 5, size: 5 }, zoom: 15 }),
  /** Where stores come from: inline in this file, or the `stores` collection managed through the UI. */
  storeSource: z.object({ provider: z.enum(['config', 'mongo']), collection: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/u).default('stores') }).strict().default({ provider: 'config', collection: 'stores' }),
  stores: z.array(storeSchema).max(2000).default([]),
  surfaces: z.object({ web: surfaceSchema.extend({ mapSearchMode: z.enum(['url', 'located_ui']).optional() }), android: surfaceSchema }).strict(),
  database: z.object({ provider: z.literal('mongo'), database: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/u), collection: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/u).default('observations') }).strict(),
}).strict();

export type TrackingConfig = z.infer<typeof schema>;
export type TrackingStore = TrackingConfig['stores'][number];
export type Surface = keyof TrackingConfig['surfaces'];
export type ScanTier = 'point' | 'grid';
export type KeywordTier = 'core' | 'longTail';
export type FixedPoint = z.infer<typeof fixedPointSchema>;
export type MonitoringCatalog = z.infer<typeof monitoringCatalogSchema>;
export type KeywordTarget = z.infer<typeof keywordTargetSchema>;
export type TrackingPoint = GridPoint & { fixedPoint?: FixedPoint };

export function parseTrackingConfig(raw: unknown): TrackingConfig {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(`invalid tracking configuration: ${parsed.error.issues.map(i => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ')}`);
  const config = parsed.data;
  if (config.storeSource.provider === 'config' && config.stores.length === 0) throw new ConfigError('stores must be nonempty when storeSource is config');
  validateStores(config.stores);
  return config;
}

/** Validate one store as the UI or an import submits it; returns the normalized store. */
export function parseStore(raw: unknown): TrackingStore {
  const parsed = storeSchema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(`invalid store: ${parsed.error.issues.map(i => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ')}`);
  validateStores([parsed.data]);
  return parsed.data;
}

/** Replace the configured stores, e.g. with the ones loaded from the database. */
export function withStores(config: TrackingConfig, stores: TrackingStore[]): TrackingConfig {
  const normalized = stores.map(parseStore);
  validateStores(normalized);
  return { ...config, stores: normalized };
}

/** Stable assignment of stores to `count` shards, so a store always runs on the same indexed pod. */
export function shardStores(stores: TrackingStore[], index: number, count: number): TrackingStore[] {
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(index) || index < 0 || index >= count) throw new ConfigError('shard index must be within 0..count-1');
  const hash = (text: string): number => { let h = 2166136261; for (const ch of text) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619) >>> 0; } return h; };
  return stores.filter(store => hash(store.storeId) % count === index);
}

/** Largest planned workloads first; one improving pair swap reduces avoidable imbalance. */
export function balancedShardStores(config: TrackingConfig, selection: { surface: Surface; tier: ScanTier }, index: number, count: number): TrackingStore[] {
  shardStores([], index, count);
  const weights = new Map<string, number>();
  for (const query of planScan(config, selection).queries) weights.set(query.storeId, (weights.get(query.storeId) ?? 0) + 1);
  const sorted = config.stores.map(store => ({ store, weight: weights.get(store.storeId) ?? 0, shard: 0 }))
    .sort((a, b) => b.weight - a.weight || (a.store.storeId < b.store.storeId ? -1 : a.store.storeId > b.store.storeId ? 1 : 0));
  const loads = Array<number>(count).fill(0);
  for (const item of sorted) {
    item.shard = loads.indexOf(Math.min(...loads));
    loads[item.shard]! += item.weight;
  }
  let best: [number, number] | null = null, improvement = 0;
  for (let a = 0; a < sorted.length; a++) for (let b = a + 1; b < sorted.length; b++) {
    const left = sorted[a]!, right = sorted[b]!;
    if (left.shard === right.shard) continue;
    const delta = left.weight - right.weight;
    const gain = loads[left.shard]! ** 2 + loads[right.shard]! ** 2
      - (loads[left.shard]! - delta) ** 2 - (loads[right.shard]! + delta) ** 2;
    if (gain > improvement) { improvement = gain; best = [a, b]; }
  }
  if (best) {
    const left = sorted[best[0]]!, right = sorted[best[1]]!;
    [left.shard, right.shard] = [right.shard, left.shard];
  }
  const assigned = new Set(sorted.filter(item => item.shard === index).map(item => item.store.storeId));
  return config.stores.filter(store => assigned.has(store.storeId));
}

function validateStores(stores: TrackingStore[]): void {
  const config = { stores };
  for (const field of ['storeId', 'placeId'] as const) {
    if (new Set(config.stores.map(s => s[field])).size !== config.stores.length) throw new ConfigError(`duplicate stores.${field}`);
  }
  for (const store of config.stores) {
    const all = [...store.keywords.core, ...store.keywords.longTail].map(keywordKey);
    if (new Set(all).size !== all.length) throw new ConfigError(`store ${store.storeId} repeats a keyword across core and long tail`);
    const points = store.fixedPoints;
    if (points && (new Set(points.map(p => p.id)).size !== points.length || points.some(p => /^r[+-]?\d+c[+-]?\d+$/u.test(p.id)))) throw new ConfigError(`store ${store.storeId} needs unique fixed point IDs distinct from grid IDs`);
    // Monitored keywords are scanned at every fixed point. A catalog import also carries its provenance;
    // keywords and targets edited in the UI do not need one. Targets may cover some points only.
    if (store.monitoringCatalog && !store.keywordTargets) throw new ConfigError(`store ${store.storeId} has catalog provenance without monitored keywords`);
    if (store.keywordTargets) {
      if (!points) throw new ConfigError(`store ${store.storeId} needs fixedPoints for its monitored keywords`);
      if (new Set(store.keywordTargets.map(t => keywordKey(t.keyword))).size !== store.keywordTargets.length) throw new ConfigError(`store ${store.storeId} repeats a monitored keyword`);
      for (const target of store.keywordTargets) {
        if (new Set(target.pointTargets.map(p => p.pointId)).size !== target.pointTargets.length || target.pointTargets.some(t => !points.some(p => p.id === t.pointId && p.label === t.pointLabel && p.distanceKm === t.radiusKm))) throw new ConfigError(`store ${store.storeId} target points must match its fixed point definitions`);
      }
    }
  }
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
export function storeFixedPoints(store: TrackingStore): TrackingPoint[] {
  return store.fixedPoints?.map(point => ({ id: point.id, row: 0, col: 0, latitude: point.latitude, longitude: point.longitude, distanceKm: point.distanceKm, ring: ringFor(point.distanceKm), fixedPoint: structuredClone(point) })) ?? [centerPoint(store)];
}

export interface PlannedQuery {
  storeId: string; placeId: string; aliases: string[];
  keyword: string; keywordTier: KeywordTier;
  point: TrackingPoint; zoom: number;
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
    const points = selection.tier === 'grid' ? generateGrid(storeGridSpec(config, store)) : storeFixedPoints(store);
    const selectedKeywords = store.keywordTargets?.map(t => t.keyword) ?? [...store.keywords.core, ...store.keywords.longTail];
    const keywords: Array<[string, KeywordTier]> = selectedKeywords.map((k): [string, KeywordTier] => [k, store.keywords.core.some(core => keywordKey(core) === keywordKey(k)) ? 'core' : 'longTail']).filter(([, tier]) => tierConfig.keywords === 'all' || tier === 'core');
    const scanPoints = new Map((store.keywordTargets ?? []).filter(t => t.scanPoints).map(t => [keywordKey(t.keyword), new Set(t.scanPoints)]));
    const withBest = new Set((selection.tier === 'point' && (tierConfig as { bestVariants?: boolean }).bestVariants !== false ? store.keywordTargets ?? [] : []).filter(t => t.bestVariant).map(t => keywordKey(t.keyword)));
    // A best variant follows its keyword's points and tier; it is a separate query and a separate series.
    const expanded = keywords.flatMap(([kw, tier]): Array<[string, KeywordTier, string]> => {
      const variant = withBest.has(keywordKey(kw)) && selection.tier === 'point' ? bestVariantOf(kw) : null;
      return variant ? [[kw, tier, keywordKey(kw)], [variant, tier, keywordKey(kw)]] : [[kw, tier, keywordKey(kw)]];
    });
    for (const point of points) for (const [kw, keywordTier, base] of expanded) {
      if (selection.tier === 'point' && scanPoints.get(base)?.has(point.id) === false) continue;
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
  if (!Number.isInteger(maxKeywordsPerBatch) || maxKeywordsPerBatch < 1 || maxKeywordsPerBatch > 20) throw new ConfigError('batch size must be within 1..20');
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
  if (!Number.isInteger(maxTasksPerRun) || maxTasksPerRun < 1 || maxTasksPerRun > 20) throw new ConfigError('run size must be within 1..20');
  const names = new Map(config.stores.map(s => [s.storeId, s.name]));
  const tasks = plan.queries.map((q): AndroidTaskLike => ({
    storeId: q.storeId, storeName: names.get(q.storeId) ?? q.storeId, keyword: q.keyword, aliases: q.aliases,
    location: { id: q.point.id, label: q.point.fixedPoint?.label ?? `${q.point.id} (${q.point.distanceKm} km ${q.point.ring})`, latitude: q.point.latitude, longitude: q.point.longitude, accuracyMeters: 20, toleranceMeters: 100, source: q.point.fixedPoint?.sourceReference ?? `tracking-config ${plan.tier} scan` },
    sourceReference: `tracking-config/v1 ${plan.surface}/${plan.tier} ${q.storeId} ${q.keywordTier}`,
  }));
  const runs: AndroidTaskLike[][] = [];
  for (let i = 0; i < tasks.length; i += maxTasksPerRun) runs.push(tasks.slice(i, i + maxTasksPerRun));
  return runs;
}

/** Point IDs and keyword tiers are store-local, never global metadata keys. */
export function trackingIngestContext(config: TrackingConfig, options: { includeGridSpec?: boolean; includeTargetSnapshot?: boolean } = {}): IngestContext {
  return { timezone: config.timezone, storeContexts: new Map(config.stores.map(store => {
    const points = new Map<string, TrackingPoint>(generateGrid(storeGridSpec(config, store)).map(point => [point.id, point]));
    points.set('r0c0', centerPoint(store));
    for (const point of storeFixedPoints(store)) points.set(point.id, point);
    const keywordTiers = new Map<string, KeywordTier>();
    for (const keyword of store.keywords.core) keywordTiers.set(keywordKey(keyword), 'core');
    for (const keyword of store.keywords.longTail) keywordTiers.set(keywordKey(keyword), 'longTail');
    return [store.storeId, { points, keywordTiers, ...(options.includeGridSpec ? { gridSpec: storeGridSpec(config, store) } : {}), ...(options.includeTargetSnapshot && store.monitoringCatalog && store.keywordTargets ? { monitoringCatalog: structuredClone(store.monitoringCatalog), keywordTargets: new Map(store.keywordTargets.map(target => [target.keyword, structuredClone(target)])) } : {}) }];
  })) };
}
