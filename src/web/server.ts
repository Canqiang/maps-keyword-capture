#!/usr/bin/env node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { keywordKey, type Surface } from '../domain/model.js';
import { decodeHistoryCursor, historyObservation, type TimelineOptions } from '../domain/history.js';
import { discoverGridRuns, gridHistory } from './grid-history.js';
import { MongoTrackingRepository, type TrackingRepository } from '../domain/repository.js';
import { loadTrackingConfig, type TrackingConfig } from '../domain/tracking-config.js';
import { AzureBlobGateway, containerClientFromEnv } from '../storage/azure-gateway.js';
import { UI_HTML } from './ui.js';
import { createBasicAuth, type BasicAuth } from './auth.js';
import { MongoSeoKeywordLibrary, type SeoKeywordLibrary } from './seo-library.js';
import { loginPage } from './login.js';
import { createScanTrigger, inClusterKubeApi, parseScanTargets, ScanTriggerError, type ScanTrigger } from './scan-trigger.js';

/**
 * Tracking UI service: a small JSON API over the stores and observations collections, the
 * single-page UI, and a read-only proxy for screenshots in the private evidence container.
 */
export interface EvidenceReader { get(key: string): Promise<Buffer> }
export interface ServerDeps { config: TrackingConfig; repo: TrackingRepository; evidence?: EvidenceReader; auth?: BasicAuth; /** Recorded as the author of configuration changes (the signed-in account). */ actor?: string; /** Read-only SEO keyword library for imports. */ seo?: SeoKeywordLibrary; scans?: ScanTrigger; readOnly?: boolean; previewInfo?: Record<string, unknown>; now?: () => Date; log?: (event: Record<string, unknown>) => void }

const EVIDENCE_KEY = /^(?:tracking|android-maps|maps-keyword-capture|\d{4}-\d{2}-\d{2})\/[A-Za-z0-9_.+\-/%一-鿿]+\.png$/u;
const MAX_BODY = 256 * 1024;

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8'): void {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(payload);
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'content-type must be application/json');
  if (req.headers.origin) {
    let origin: URL;
    try { origin = new URL(req.headers.origin); } catch { throw new HttpError(403, 'invalid origin'); }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) throw new HttpError(403, 'cross-origin mutation is not allowed');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'request body too large');
    chunks.push(chunk as Buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch { throw new HttpError(400, 'body must be a JSON object'); }
}
/** Login form body: small, urlencoded, same-origin. */
async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/x-www-form-urlencoded') throw new HttpError(415, 'content-type must be application/x-www-form-urlencoded');
  if (req.headers.origin) {
    let origin: URL;
    try { origin = new URL(req.headers.origin); } catch { throw new HttpError(403, 'invalid origin'); }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) throw new HttpError(403, 'cross-origin login is not allowed');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 8 * 1024) throw new HttpError(413, 'request body too large');
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}
function secureRequest(req: IncomingMessage): boolean {
  return (req.socket as { encrypted?: boolean }).encrypted === true || String(req.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim().toLowerCase() === 'https';
}
function redirect(res: ServerResponse, location: string, cookie?: string): void {
  res.writeHead(303, { location, 'cache-control': 'no-store', ...(cookie ? { 'set-cookie': cookie } : {}) });
  res.end();
}
function surfaceOf(value: string | null): Surface {
  if (value === null || value === 'web') return 'web';
  if (value === 'android') return 'android';
  throw new HttpError(400, 'surface must be web or android');
}

function explicitSurface(value: string | null): Surface {
  if (value === null) throw new HttpError(400, 'surface is required');
  return surfaceOf(value);
}
function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
function dateInZone(now: Date, timezone: string): string {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function timelineOptions(url: URL, now: Date, timezone: string, defaultPointId = 'r0c0'): TimelineOptions {
  const surface = explicitSurface(url.searchParams.get('surface'));
  const to = url.searchParams.get('to') ?? dateInZone(now, timezone);
  if (!validDate(to)) throw new HttpError(400, 'to must be a real YYYY-MM-DD date');
  const from = url.searchParams.get('from') ?? new Date(Date.parse(to + 'T00:00:00Z') - 13 * 86_400_000).toISOString().slice(0, 10);
  if (!validDate(from) || from > to || Date.parse(to) - Date.parse(from) > 89 * 86_400_000) throw new HttpError(400, 'from/to must span 1 to 90 calendar days');
  const limit = Number(url.searchParams.get('limit') ?? 2000);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) throw new HttpError(400, 'limit must be an integer from 1 to 2000');
  const pointId = url.searchParams.get('point') ?? defaultPointId, keyword = url.searchParams.get('keyword'), cursor = url.searchParams.get('cursor');
  if (!pointId || pointId.length > 500) throw new HttpError(400, 'point is invalid');
  return { surface, pointId, from, to, limit, ...(keyword ? { keywordKey: keywordKey(keyword) } : {}), ...(cursor ? { cursor } : {}) };
}

export function createHandler(deps: ServerDeps) {
  const now = deps.now ?? (() => new Date());
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let pathname = '/';
    try {
      let url: URL, parts: string[];
      try {
        url = new URL(req.url ?? '/', 'http://localhost');
        pathname = url.pathname;
        parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      } catch { throw new HttpError(400, 'malformed URL path'); }
      if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true });
      const auth = deps.auth;
      const signedIn = !auth || auth.accepts(req.headers.authorization) || auth.acceptsSession(req.headers.cookie);
      if (auth && url.pathname === '/login') {
        if (req.method === 'GET') {
          if (signedIn) return redirect(res, '/');
          return send(res, 200, loginPage({ error: url.searchParams.get('error') === '1', ...(url.searchParams.get('next') ? { next: url.searchParams.get('next')! } : {}) }), 'text/html; charset=utf-8');
        }
        if (req.method === 'POST') {
          const form = await readForm(req);
          const next = form.get('next') ?? '/';
          const target = /^\/(?!\/)[^\s]*$/u.test(next) ? next : '/';
          if (!auth.login(form.get('username') ?? '', form.get('password') ?? '')) {
            deps.log?.({ stage: 'login_rejected' });
            return redirect(res, '/login?error=1' + (target !== '/' ? '&next=' + encodeURIComponent(target) : ''));
          }
          const cookie = `${auth.cookieName}=${auth.issueSession(now().getTime())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${auth.sessionSeconds}${secureRequest(req) ? '; Secure' : ''}`;
          deps.log?.({ stage: 'login_ok' });
          return redirect(res, target, cookie);
        }
      }
      if (auth && url.pathname === '/logout' && req.method === 'POST') {
        return redirect(res, '/login', `${auth.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureRequest(req) ? '; Secure' : ''}`);
      }
      if (!signedIn) {
        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return redirect(res, '/login');
        res.setHeader('www-authenticate', 'Basic realm="Maps tracking", charset="UTF-8"');
        return send(res, 401, { error: 'authentication required' });
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return send(res, 200, UI_HTML, 'text/html; charset=utf-8');
      if (parts[0] !== 'api') throw new HttpError(404, 'not found');
      if (deps.readOnly && !['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '')) throw new HttpError(403, 'this preview is read-only');
      if (req.method === 'GET' && parts[1] === 'settings' && parts.length === 2) {
        const { stores: _stores, ...settings } = deps.config;
        return send(res, 200, { ...settings, readOnly: deps.readOnly ?? false, scans: Boolean(deps.scans) && !deps.readOnly, signedIn: Boolean(auth), ...(deps.previewInfo ? { previewInfo: deps.previewInfo } : {}) });
      }
      if (parts[1] === 'scans') {
        if (!deps.scans) throw new HttpError(503, '此环境没有配置采集触发');
        try {
          if (parts.length === 2 && req.method === 'GET') {
            const [targets, jobs] = await Promise.all([deps.scans.targets(), deps.scans.jobs()]);
            return send(res, 200, { targets, jobs, now: now().toISOString() });
          }
          if (parts.length === 4 && parts[3] === 'trigger' && req.method === 'POST') {
            await readJson(req);
            const job = await deps.scans.trigger(parts[2]!);
            deps.log?.({ stage: 'scan_triggered', target: parts[2], job: job.name });
            return send(res, 202, job);
          }
        } catch (error) { if (error instanceof ScanTriggerError) throw new HttpError(error.status, error.message); throw error; }
      }
      if (parts[1] === 'seo' && parts[2] === 'stores' && req.method === 'GET') {
        if (!deps.seo) throw new HttpError(404, 'SEO keyword library is not configured');
        const tracked = new Map((await deps.repo.listStores({ includeInactive: true })).map(s => [s.placeId, s]));
        if (parts.length === 3) return send(res, 200, (await deps.seo.stores()).map(s => ({ ...s, trackedStoreId: tracked.get(s.placeId)?.storeId ?? null })));
        if (parts.length === 4) {
          const library = await deps.seo.store(parts[3]!);
          if (!library) throw new HttpError(404, 'store not found in the SEO keyword library');
          const store = tracked.get(library.placeId);
          const monitored = new Set((store?.keywordTargets ?? []).map(t => keywordKey(t.keyword)));
          return send(res, 200, { ...library, trackedStoreId: store?.storeId ?? null, keywords: library.keywords.map(k => ({ ...k, monitored: monitored.has(keywordKey(k.keyword)) })) });
        }
      }
      if (parts[1] === 'stores' && parts.length === 2) {
        if (req.method === 'GET') {
          const [stores, summaries] = await Promise.all([deps.repo.listStores({ includeInactive: true }), deps.repo.summaries({ surface: surfaceOf(url.searchParams.get('surface')) })]);
          const byId = new Map(summaries.map(s => [s.storeId, s]));
          const surface = surfaceOf(url.searchParams.get('surface'));
          const rosters = await Promise.all(stores.map(store => deps.repo.rosterLatest(store.storeId, surface)));
          return send(res, 200, stores.map((store, index) => ({ ...store, summary: byId.get(store.storeId) ?? null, rosterLatest: rosters[index] ?? null })));
        }
        if (req.method === 'POST') {
          try { return send(res, 201, await deps.repo.saveStore(await readJson(req), now(), { by: deps.actor ?? null })); }
          catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, error instanceof Error ? error.message : 'invalid store'); }
        }
      }
      if (parts[1] === 'stores' && parts[2]) {
        const storeId = parts[2];
        const store = await deps.repo.getStore(storeId);
        if (!store) throw new HttpError(404, 'store not found');
        if (parts.length === 3 && req.method === 'GET') return send(res, 200, store);
        if (parts.length === 3 && req.method === 'PUT') {
          const body = await readJson(req) as Record<string, unknown>;
          if (body.storeId !== undefined && body.storeId !== storeId) throw new HttpError(400, 'storeId cannot change');
          const retained = Object.fromEntries(['expectedArea', 'fixedPoints', 'monitoringCatalog', 'keywordTargets'].filter(key => key in store).map(key => [key, (store as unknown as Record<string, unknown>)[key]]));
          try { return send(res, 200, await deps.repo.saveStore({ ...retained, ...body, storeId }, now(), { by: deps.actor ?? null })); }
          catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'invalid store'); }
        }
        if (parts.length === 4 && parts[3] === 'active' && req.method === 'PUT') {
          const body = await readJson(req) as { active?: unknown };
          if (typeof body.active !== 'boolean') throw new HttpError(400, 'active must be boolean');
          return send(res, 200, await deps.repo.setActive(storeId, body.active, now(), deps.actor ?? null));
        }
        if (parts.length === 4 && parts[3] === 'changes' && req.method === 'GET') {
          return send(res, 200, { storeId, changes: await deps.repo.storeChanges(storeId, 20) });
        }
        if (parts.length === 4 && parts[3] === 'timeline' && req.method === 'GET') {
          const options = timelineOptions(url, now(), deps.config.timezone, store.fixedPoints?.find(p => p.distanceKm === 0)?.id);
          try { decodeHistoryCursor(storeId, options); } catch { throw new HttpError(400, 'invalid timeline cursor for this selection'); }
          const page = await deps.repo.timeline(storeId, options);
          return send(res, 200, { storeId, surface: options.surface, pointId: options.pointId, from: options.from, to: options.to, timezone: deps.config.timezone,
            ...(options.keywordKey ? { keywordKey: options.keywordKey } : {}), ...page, items: page.items.map(historyObservation) });
        }
        if (parts.length === 5 && parts[3] === 'observations' && req.method === 'GET') {
          const row = await deps.repo.observation(storeId, parts[4]!, explicitSurface(url.searchParams.get('surface')));
          if (!row) throw new HttpError(404, 'observation not found for this store and surface');
          return send(res, 200, historyObservation(row));
        }
        if (parts.length === 4 && parts[3] === 'points' && req.method === 'GET') {
          const surface = explicitSurface(url.searchParams.get('surface'));
          return send(res, 200, { storeId, surface, ...await deps.repo.points(storeId, surface) });
        }
        if (parts.length === 4 && parts[3] === 'grid-runs' && req.method === 'GET') {
          const surface = explicitSurface(url.searchParams.get('surface')), keyword = url.searchParams.get('keyword'), localDate = url.searchParams.get('date');
          if (!keyword || !localDate || !validDate(localDate)) throw new HttpError(400, 'keyword and a real date=YYYY-MM-DD are required');
          const all = await deps.repo.day(storeId, keywordKey(keyword), { surface, localDate }), rows = all.slice(0, 5000);
          return send(res, 200, { storeId, surface, keywordKey: keywordKey(keyword), localDate, runs: discoverGridRuns(rows, deps.config, store), legacyObservations: rows.filter(row => !row.gridRunId && (row.gridSpec || row.pointId !== 'r0c0')).length, truncated: all.length > 5000 });
        }
        if (parts.length === 4 && parts[3] === 'latest' && req.method === 'GET') {
          const surface = url.searchParams.get('surface');
          const pointId = url.searchParams.get('point');
          return send(res, 200, await deps.repo.latest(storeId, { ...(surface ? { surface: surfaceOf(surface) } : {}), ...(pointId ? { pointId } : {}) }));
        }
        if (parts.length === 4 && parts[3] === 'trend' && req.method === 'GET') {
          const keyword = url.searchParams.get('keyword');
          if (!keyword) throw new HttpError(400, 'keyword is required');
          const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? 7) || 7));
          const since = new Date(now().getTime() - days * 86_400_000).toISOString();
          const pointId = url.searchParams.get('point');
          return send(res, 200, await deps.repo.trend(storeId, keywordKey(keyword), { surface: surfaceOf(url.searchParams.get('surface')), ...(pointId ? { pointId } : {}), since }));
        }
        if (parts.length === 4 && parts[3] === 'grid' && req.method === 'GET') {
          const keyword = url.searchParams.get('keyword'), localDate = url.searchParams.get('date'), gridRunId = url.searchParams.get('gridRunId');
          if (!keyword || !localDate || !validDate(localDate)) throw new HttpError(400, 'keyword and date=YYYY-MM-DD are required');
          const all = await deps.repo.day(storeId, keywordKey(keyword), { surface: surfaceOf(url.searchParams.get('surface')), localDate }), rows = all.slice(0, 5000);
          if (gridRunId && !rows.some(row => row.gridRunId === gridRunId)) throw new HttpError(404, 'grid run not found in this selection');
          return send(res, 200, { ...gridHistory(rows, deps.config, store, gridRunId ?? undefined), truncated: all.length > 5000 });
        }
      }
      if (req.method === 'GET' && parts[1] === 'evidence' && parts.length === 2) {
        const key = url.searchParams.get('key') ?? '';
        if (!EVIDENCE_KEY.test(key) || key.split('/').some(segment => segment === '..' || segment === '.' || segment === '')) throw new HttpError(400, 'not an evidence screenshot key');
        if (!deps.evidence) throw new HttpError(503, 'evidence storage is not configured');
        try { return send(res, 200, await deps.evidence.get(key), 'image/png'); }
        catch { throw new HttpError(404, 'screenshot not found'); }
      }
      throw new HttpError(404, 'not found');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) deps.log?.({ stage: 'http_error', path: pathname, error: error instanceof Error ? error.message.replace(/mongodb(\+srv)?:\/\/[^\s]*/gu, 'mongodb://***').slice(0, 200) : 'unknown' });
      send(res, status, { error: status === 500 ? 'internal error' : (error as Error).message });
    }
  };
}

export function startServer(deps: ServerDeps, port: number): Server {
  const handler = createHandler(deps);
  const server = createServer((req, res) => { void handler(req, res).catch(() => {
    if (!res.headersSent) send(res, 500, { error: 'internal error' });
    else res.destroy();
  }); });
  server.listen(port);
  return server;
}

async function main(): Promise<void> {
  const auth = createBasicAuth(process.env.TRACKING_AUTH_USER, process.env.TRACKING_AUTH_PASSWORD);
  const configPath = process.env.TRACKING_CONFIG ?? '/config/tracking.json';
  const config = await loadTrackingConfig(configPath);
  const uriEnv = process.env.TRACKING_MONGO_URI_ENV ?? 'MAPS_TRACKING_MONGO_URI';
  const uri = process.env[uriEnv];
  if (!uri) throw new Error(`${uriEnv} is not set`);
  const repo = new MongoTrackingRepository({ uri, database: config.database.database, storesCollection: config.storeSource.collection, observationsCollection: config.database.collection });
  const evidence = process.env.AZURE_STORAGE_CONTAINER_SAS_URL || process.env.AZURE_STORAGE_ACCOUNT_URL ? new AzureBlobGateway(containerClientFromEnv(process.env)) : undefined;
  const log = (event: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
  const port = Number(process.env.PORT ?? 8080);
  const targets = parseScanTargets(process.env.TRACKING_SCAN_TARGETS);
  const cluster = targets.length ? await inClusterKubeApi() : undefined;
  if (targets.length && !cluster) throw new Error('TRACKING_SCAN_TARGETS is set but the in-cluster service account is unavailable');
  const scans = cluster ? createScanTrigger(targets, cluster.api, cluster.namespace) : undefined;
  const seoUri = process.env[uriEnv];
  const seo = seoUri && process.env.TRACKING_SEO_LIBRARY !== 'off' ? new MongoSeoKeywordLibrary({ uri: seoUri, database: process.env.TRACKING_SEO_DATABASE ?? 'seo-integration', collection: process.env.TRACKING_SEO_COLLECTION ?? 'local_keywords' }) : undefined;
  const server = startServer({ config, repo, ...(seo ? { seo } : {}), ...(evidence ? { evidence } : {}), ...(auth ? { auth, actor: process.env.TRACKING_AUTH_USER! } : {}), ...(scans ? { scans } : {}), log }, port);
  log({ stage: 'listening', port, stores: config.storeSource.provider, evidence: Boolean(evidence), scanTargets: targets.map(t => t.cronJob) });
  const stop = () => { server.close(); void repo.close().finally(() => process.exit(0)); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message.replace(/mongodb(\+srv)?:\/\/[^\s]*/gu, 'mongodb://***') : 'startup failed'}\n`); process.exit(1); });
