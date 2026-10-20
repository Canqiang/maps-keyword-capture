#!/usr/bin/env node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { generateGrid } from '../grid/grid.js';
import { computeGridMetrics, heatMapRows, type GridObservation } from '../grid/metrics.js';
import { keywordKey, type Surface } from '../domain/model.js';
import { MongoTrackingRepository, type TrackingRepository } from '../domain/repository.js';
import { loadTrackingConfig, storeGridSpec, type TrackingConfig } from '../domain/tracking-config.js';
import { AzureBlobGateway, containerClientFromEnv } from '../storage/azure-gateway.js';
import { UI_HTML } from './ui.js';

/**
 * Tracking UI service: a small JSON API over the stores and observations collections, the
 * single-page UI, and a read-only proxy for screenshots in the private evidence container.
 */
export interface EvidenceReader { get(key: string): Promise<Buffer> }
export interface ServerDeps { config: TrackingConfig; repo: TrackingRepository; evidence?: EvidenceReader; now?: () => Date; log?: (event: Record<string, unknown>) => void }

const EVIDENCE_KEY = /^(?:tracking|android-maps|maps-keyword-capture|\d{4}-\d{2}-\d{2})\/[A-Za-z0-9_.+\-/%一-鿿]+\.png$/u;
const MAX_BODY = 256 * 1024;

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8'): void {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(payload);
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'request body too large');
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'body must be JSON'); }
}
function surfaceOf(value: string | null): Surface {
  if (value === null || value === 'web') return 'web';
  if (value === 'android') return 'android';
  throw new HttpError(400, 'surface must be web or android');
}

export function createHandler(deps: ServerDeps) {
  const now = deps.now ?? (() => new Date());
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return send(res, 200, UI_HTML, 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true });
      if (parts[0] !== 'api') throw new HttpError(404, 'not found');
      if (req.method === 'GET' && parts[1] === 'settings' && parts.length === 2) {
        const { stores: _stores, ...settings } = deps.config;
        return send(res, 200, settings);
      }
      if (parts[1] === 'stores' && parts.length === 2) {
        if (req.method === 'GET') {
          const [stores, summaries] = await Promise.all([deps.repo.listStores({ includeInactive: true }), deps.repo.summaries()]);
          const byId = new Map(summaries.map(s => [s.storeId, s]));
          return send(res, 200, stores.map(store => ({ ...store, summary: byId.get(store.storeId) ?? null })));
        }
        if (req.method === 'POST') {
          try { return send(res, 201, await deps.repo.saveStore(await readJson(req), now())); }
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
          try { return send(res, 200, await deps.repo.saveStore({ ...body, storeId }, now())); }
          catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'invalid store'); }
        }
        if (parts.length === 4 && parts[3] === 'active' && req.method === 'PUT') {
          const body = await readJson(req) as { active?: unknown };
          if (typeof body.active !== 'boolean') throw new HttpError(400, 'active must be boolean');
          return send(res, 200, await deps.repo.setActive(storeId, body.active, now()));
        }
        if (parts.length === 4 && parts[3] === 'latest' && req.method === 'GET') {
          const surface = url.searchParams.get('surface');
          return send(res, 200, await deps.repo.latest(storeId, { ...(surface ? { surface: surfaceOf(surface) } : {}), pointId: url.searchParams.get('point') ?? 'r0c0' }));
        }
        if (parts.length === 4 && parts[3] === 'trend' && req.method === 'GET') {
          const keyword = url.searchParams.get('keyword');
          if (!keyword) throw new HttpError(400, 'keyword is required');
          const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? 7) || 7));
          const since = new Date(now().getTime() - days * 86_400_000).toISOString();
          return send(res, 200, await deps.repo.trend(storeId, keywordKey(keyword), { surface: surfaceOf(url.searchParams.get('surface')), pointId: url.searchParams.get('point') ?? 'r0c0', since }));
        }
        if (parts.length === 4 && parts[3] === 'grid' && req.method === 'GET') {
          const keyword = url.searchParams.get('keyword'), localDate = url.searchParams.get('date');
          if (!keyword || !localDate || !/^\d{4}-\d{2}-\d{2}$/u.test(localDate)) throw new HttpError(400, 'keyword and date=YYYY-MM-DD are required');
          const grid = generateGrid(storeGridSpec(deps.config, store));
          const ids = new Set(grid.map(p => p.id));
          const rows = await deps.repo.day(storeId, keywordKey(keyword), { surface: surfaceOf(url.searchParams.get('surface')), localDate });
          // One observation per point: the latest of the day.
          const latest = new Map<string, (typeof rows)[number]>();
          for (const row of rows) if (ids.has(row.pointId) && (!latest.has(row.pointId) || row.observedAt > latest.get(row.pointId)!.observedAt)) latest.set(row.pointId, row);
          const point = new Map(grid.map(p => [p.id, p]));
          const observations: GridObservation[] = [...latest.values()].map(o => ({ pointId: o.pointId, distanceKm: point.get(o.pointId)!.distanceKm, ring: point.get(o.pointId)!.ring, rank: o.rank.status === 'failed' || o.rank.status === 'blocked' ? null : o.rank.organicRank }));
          const usable = observations.filter(o => latest.get(o.pointId)!.rank.status !== 'failed' && latest.get(o.pointId)!.rank.status !== 'blocked');
          return send(res, 200, { grid, metrics: computeGridMetrics(grid, usable), heatMap: heatMapRows(grid, usable), cells: grid.map(p => ({ id: p.id, row: p.row, col: p.col, distanceKm: p.distanceKm, rank: usable.find(o => o.pointId === p.id)?.rank ?? null, observed: usable.some(o => o.pointId === p.id) })) });
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
      if (status === 500) deps.log?.({ stage: 'http_error', path: url.pathname, error: error instanceof Error ? error.message.replace(/mongodb(\+srv)?:\/\/[^\s]*/gu, 'mongodb://***').slice(0, 200) : 'unknown' });
      send(res, status, { error: status === 500 ? 'internal error' : (error as Error).message });
    }
  };
}

export function startServer(deps: ServerDeps, port: number): Server {
  const handler = createHandler(deps);
  const server = createServer((req, res) => { void handler(req, res); });
  server.listen(port);
  return server;
}

async function main(): Promise<void> {
  const configPath = process.env.TRACKING_CONFIG ?? '/config/tracking.json';
  const config = await loadTrackingConfig(configPath);
  const uriEnv = process.env.TRACKING_MONGO_URI_ENV ?? 'MAPS_TRACKING_MONGO_URI';
  const uri = process.env[uriEnv];
  if (!uri) throw new Error(`${uriEnv} is not set`);
  const repo = new MongoTrackingRepository({ uri, database: config.database.database, storesCollection: config.storeSource.collection, observationsCollection: config.database.collection });
  const evidence = process.env.AZURE_STORAGE_CONTAINER_SAS_URL || process.env.AZURE_STORAGE_ACCOUNT_URL ? new AzureBlobGateway(containerClientFromEnv(process.env)) : undefined;
  const log = (event: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
  const port = Number(process.env.PORT ?? 8080);
  const server = startServer({ config, repo, ...(evidence ? { evidence } : {}), log }, port);
  log({ stage: 'listening', port, stores: config.storeSource.provider, evidence: Boolean(evidence) });
  const stop = () => { server.close(); void repo.close().finally(() => process.exit(0)); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message.replace(/mongodb(\+srv)?:\/\/[^\s]*/gu, 'mongodb://***') : 'startup failed'}\n`); process.exit(1); });
