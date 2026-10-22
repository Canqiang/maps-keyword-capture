import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryTrackingRepository } from '../src/domain/repository.js';
import { parseTrackingConfig } from '../src/domain/tracking-config.js';
import { createHandler } from '../src/web/server.js';
import { parseSeoLibrary, type SeoKeywordLibrary } from '../src/web/seo-library.js';

const raw = JSON.parse(await readFile(new URL('../docs/tracking-config.example.json', import.meta.url), 'utf8'));
const keke = raw.stores[0];
const config = parseTrackingConfig({ ...raw, storeSource: { provider: 'mongo' }, stores: [] });
const records = [
  { _id: 'a', merchant_id: 'm-keke', place_id: keke.placeId, name: ' Keke Food ', updated_time: '2026-10-14', keywords: [
    { keyword: 'noodles', priority: 'P2', target_surface_types: ['WEBSITE'] }, { keyword: '  braised   food ', priority: 'P0', target_surface_types: ['GBP', 'WEBSITE'] },
    { keyword: 'Braised Food', priority: 'P1' }, { keyword: 'luwei', priority: 'X' }, { keyword: '', priority: 'P0' }, { keyword: 'bad\u0007', priority: 'P0' } ] },
  { _id: 'b', merchant_id: 'm1', place_id: 'PROBE_ONLY', name: 'probe', keywords: [{ keyword: 'x', priority: 'P0' }] },
  { _id: 'c', merchant_id: 'm2', place_id: 'ChIJdup', name: 'Dup one', keywords: [] },
  { _id: 'd', merchant_id: 'm3', place_id: 'ChIJdup', name: 'Dup two', keywords: [{ keyword: 'y', priority: 'P0' }] },
];

describe('SEO keyword library parsing', () => {
  it('keeps Google Place IDs only, trims, deduplicates and orders keywords by priority, and flags contested places', () => {
    const stores = parseSeoLibrary(records);
    expect(stores.map(s => [s.name, s.ambiguous])).toEqual([['Dup one', true], ['Keke Food', false]]);
    const k = stores.find(s => s.placeId === keke.placeId)!;
    expect(k).toMatchObject({ merchantId: 'm-keke', keywordCount: 3, updatedTime: '2026-10-14' });
    expect(k.keywords).toEqual([{ keyword: 'braised food', priority: 'P0', surfaces: ['GBP', 'WEBSITE'] }, { keyword: 'noodles', priority: 'P2', surfaces: ['WEBSITE'] }, { keyword: 'luwei', priority: 'X', surfaces: [] }]);
  });
});

describe('SEO import endpoints', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>(resolve => { if (server) server.close(() => { server = undefined; resolve(); }); else resolve(); }));
  async function start(seo?: SeoKeywordLibrary) {
    const repo = new MemoryTrackingRepository();
    const center = { id: 'keke-center', label: '中心', ...keke.center, distanceKm: 0, direction: '中心', sourceReference: '门店设置' };
    await repo.saveStore({ ...keke, fixedPoints: [center], keywordTargets: [{ keyword: 'Braised food' }] });
    const handler = createHandler({ config, repo, ...(seo ? { seo } : {}) });
    server = createServer((q, s) => { void handler(q, s); });
    server.listen(0, '127.0.0.1');
    await new Promise(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return async (path: string) => { const r = await fetch(base + path); return { status: r.status, body: await r.json() }; };
  }
  const library: SeoKeywordLibrary = { stores: async () => parseSeoLibrary(records).map(({ keywords: _k, ...s }) => s), store: async placeId => parseSeoLibrary(records).find(s => s.placeId === placeId) ?? null };
  it('lists library stores with the tracking store they map to and marks keywords already monitored', async () => {
    const call = await start(library);
    const list = await call('/api/seo/stores');
    expect(list.body.map((s: { name: string; trackedStoreId: string | null }) => [s.name, s.trackedStoreId])).toEqual([['Dup one', null], ['Keke Food', 'keke-flushing']]);
    const one = await call('/api/seo/stores/' + encodeURIComponent(keke.placeId));
    expect(one.body.trackedStoreId).toBe('keke-flushing');
    expect(one.body.keywords.map((k: { keyword: string; monitored: boolean }) => [k.keyword, k.monitored])).toEqual([['braised food', true], ['noodles', false], ['luwei', false]]);
    expect((await call('/api/seo/stores/ChIJmissing')).status).toBe(404);
  });
  it('reports a missing library instead of an empty one', async () => {
    const call = await start();
    expect((await call('/api/seo/stores')).status).toBe(404);
  });
});
