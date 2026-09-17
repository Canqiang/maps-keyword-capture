import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { CaptureConfig } from './contracts.js';

export class ConfigError extends Error {
  readonly exitCode = 64 as const;
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface LoadedConfig {
  config: CaptureConfig;
  duplicateKeywordCount: number;
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const timeZone = z.string().min(1).refine(isValidTimeZone, { message: 'must be a valid IANA time zone' });

const schema = z.object({
  schemaVersion: z.literal('1'),
  keywords: z.array(z.string().refine((k) => k.trim().length > 0, { message: 'keyword must not be blank' })).min(1).max(20),
  maxResultsPerKeyword: z.number().int().min(1).max(60).default(15),
  maxScrollsPerKeyword: z.number().int().min(0).max(50).default(6),
  maxScreenshotsPerKeyword: z.number().int().min(1).max(30).default(5),
  keywordTimeoutMs: z.number().int().min(5_000).max(600_000).default(90_000),
  locale: z.string().min(2).default('en-US'),
  browserTimezoneId: timeZone.default('America/New_York'),
  filenameTimezone: timeZone.default('Asia/Shanghai'),
  viewport: z.object({
    width: z.number().int().min(800).max(3840),
    height: z.number().int().min(600).max(2160),
  }).strict().default({ width: 1440, height: 1000 }),
  outputDirectory: z.string().min(1).default('./outputs'),
}).strict();

export function parseConfig(raw: unknown): LoadedConfig {
  if (raw !== null && typeof raw === 'object' && 'mapView' in raw) {
    throw new ConfigError('mapView is reserved for a future area-search mode and is not supported in this version; remove it to use query-only search');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
    throw new ConfigError(`invalid configuration: ${detail}`);
  }
  const d = parsed.data;
  const config: CaptureConfig = {
    schemaVersion: d.schemaVersion,
    keywords: d.keywords,
    maxResultsPerKeyword: d.maxResultsPerKeyword,
    maxScrollsPerKeyword: d.maxScrollsPerKeyword,
    maxScreenshotsPerKeyword: d.maxScreenshotsPerKeyword,
    keywordTimeoutMs: d.keywordTimeoutMs,
    locale: d.locale,
    browserTimezoneId: d.browserTimezoneId,
    filenameTimezone: d.filenameTimezone,
    viewport: d.viewport,
    outputDirectory: d.outputDirectory,
  };
  const seen = new Set<string>();
  let duplicateKeywordCount = 0;
  for (const k of config.keywords) {
    if (seen.has(k)) duplicateKeywordCount += 1;
    seen.add(k);
  }
  return { config, duplicateKeywordCount };
}

export async function loadConfigFile(path: string): Promise<LoadedConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`cannot read config file ${path}: ${(err as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`config file ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return parseConfig(raw);
}
