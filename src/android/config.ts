import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { ConfigError } from '../config.js';
import type { AndroidCaptureConfig } from './contracts.js';

const nonempty = z.string().trim().min(1).max(500);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/);
const timezone = z.string().refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'invalid IANA timezone');
const localUrl = z.string().url().refine(value => {
  const u = new URL(value);
  return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && !u.username && !u.password && !u.search && !u.hash && ['/', '/wd/hub', '/wd/hub/'].includes(u.pathname);
}, 'Appium must be a credential-free loopback HTTP URL');
const location = z.object({
  id: z.union([id, z.string().regex(/^r(?:0|[+-][1-7])c(?:0|[+-][1-7])$/)]), label: nonempty, latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().min(1).max(1000).default(20),
  toleranceMeters: z.number().finite().min(10).max(1000).default(100), source: nonempty,
}).strict();
const schema = z.object({
  schemaVersion: z.literal('android-maps-input/v1'),
  appiumUrl: localUrl.default('http://127.0.0.1:4723'),
  adbPath: z.string().min(1).max(1024).default('adb'),
  serial: z.string().regex(/^emulator-\d{4,5}$/),
  locale: z.literal('en-US').default('en-US'), timezone: timezone.default('America/New_York'),
  outputDirectory: z.string().min(1).default('./outputs'),
  maxScreenshotsPerQuery: z.number().int().min(1).max(100).default(60),
  keywordTimeoutMs: z.number().int().min(10_000).max(600_000).default(600_000),
  maxDisplayedResults: z.number().int().min(1).max(50).default(15),
  maxScrolls: z.number().int().min(0).max(99).default(59),
  ocrTimeoutMs: z.number().int().min(1000).max(60_000).default(15_000),
  ocrScale: z.number().int().min(1).max(3).default(2),
  ocrLanguages: z.string().regex(/^(eng|chi_sim|chi_tra)(\+(eng|chi_sim|chi_tra))*$/).max(50).default('eng+chi_sim+chi_tra'),
  tasks: z.array(z.object({ storeId: id, storeName: nonempty, keyword: z.string().min(1).max(200).refine(s => s.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(s)), aliases: z.array(z.string().trim().min(2).max(100)).min(1).max(10).optional(), location, sourceReference: nonempty }).strict()).min(1).max(20),
}).strict().superRefine((c, ctx) => {
  const seen = new Set<string>();
  const points = new Map<string, string>();
  c.tasks.forEach((t, i) => {
    const key = JSON.stringify([t.storeId,t.keyword,t.location.id]);
    if (seen.has(key)) ctx.addIssue({code:'custom',path:['tasks',i],message:'duplicate task'});
    seen.add(key);
    const pointKey = `${t.storeId}/${t.location.id}`;
    const point = JSON.stringify(t.location);
    if (points.has(pointKey) && points.get(pointKey) !== point) ctx.addIssue({code:'custom',path:['tasks',i,'location'],message:'location id must have one definition per store'});
    points.set(pointKey,point);
  });
});
export function parseAndroidConfig(raw: unknown): AndroidCaptureConfig {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(`invalid Android configuration: ${parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return { ...parsed.data, tasks: parsed.data.tasks.map(({ aliases, ...task }) => ({ ...task, ...(aliases ? { aliases } : {}) })) };
}
export async function loadAndroidConfig(path: string): Promise<AndroidCaptureConfig> {
  try { return parseAndroidConfig(JSON.parse(await readFile(path,'utf8'))); }
  catch (e) { if (e instanceof ConfigError) throw e; throw new ConfigError('cannot read Android input JSON'); }
}
