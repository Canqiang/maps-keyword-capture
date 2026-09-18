import { z } from 'zod';
import { ConfigError, expectedAreaSchema, parseConfig } from '../config.js';
import type { CaptureConfig, ExpectedArea } from '../contracts.js';

export const safeId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/, 'must be a safe path ID (letters, digits, underscore or hyphen)');
const schema = z.object({
  schemaVersion: z.literal('1'),
  sourceBaseUrl: z.string().url().refine(value => {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash && (u.pathname === '/' || u.pathname === '');
  }, 'must be an HTTP(S) origin without credentials, query or path'),
  stores: z.array(z.object({ storeId: safeId, merchantId: safeId, placeId: safeId, name: z.string().trim().min(1), expectedArea: expectedAreaSchema.optional() }).strict()).min(1),
  maxKeywordsPerStore: z.number().int().min(1).max(40),
  batchSize: z.number().int().min(1).max(20),
  sourceTimeoutMs: z.number().int().min(1).max(60000),
  outputDirectory: z.string().min(1),
  capture: z.record(z.string(), z.unknown()),
}).strict();
export interface EnrolledStore { storeId: string; merchantId: string; placeId: string; name: string; expectedArea?: ExpectedArea }
export interface MonitorConfig {
  schemaVersion: '1'; sourceBaseUrl: string; stores: EnrolledStore[];
  maxKeywordsPerStore: number; batchSize: number; sourceTimeoutMs: number; outputDirectory: string;
  capture: Omit<CaptureConfig, 'schemaVersion' | 'keywords' | 'outputDirectory' | 'mapView' | 'expectedArea'>;
}
export function parseMonitorConfig(raw: unknown): MonitorConfig {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(`invalid monitor configuration: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const d = parsed.data;
  for (const field of ['storeId', 'placeId'] as const) {
    if (new Set(d.stores.map(s => s[field])).size !== d.stores.length) throw new ConfigError(`duplicate stores.${field}`);
  }
  // Reuse the collector's strict capture-profile validation, while excluding wrapper-only keys.
  for (const key of ['schemaVersion', 'keywords', 'outputDirectory', 'expectedArea']) if (key in d.capture) throw new ConfigError(`capture.${key} is not supported`);
  const { schemaVersion: _schema, keywords: _keywords, outputDirectory: _out, mapView: _map, expectedArea: _expectedArea, ...capture } = parseConfig({ ...d.capture, schemaVersion: '1', keywords: ['validation'], outputDirectory: d.outputDirectory }).config;
  if (capture.filenameTimezone !== 'Asia/Shanghai') throw new ConfigError('capture.filenameTimezone must be Asia/Shanghai');
  const stores: EnrolledStore[] = d.stores.map(({ expectedArea, ...store }) => ({ ...store, ...(expectedArea ? { expectedArea } : {}) }));
  return { ...d, stores, capture };
}
export function validateRunKey(value: string): string {
  if (!safeId.safeParse(value).success) throw new ConfigError('run-key must be a safe path ID');
  return value;
}
