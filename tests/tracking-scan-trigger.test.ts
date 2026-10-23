import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScanTrigger, parseScanTargets, ScanTriggerError, type KubeApi } from '../src/web/scan-trigger.js';
import { startServer } from '../src/web/server.js';
import { parseTrackingConfig } from '../src/domain/tracking-config.js';
import { MemoryTrackingRepository } from '../src/domain/repository.js';

vi.mock('../src/web/ui.js', () => ({ UI_HTML: '<html>private UI</html>' }));
const raw = JSON.parse(await readFile(new URL('../docs/tracking-config.example.json', import.meta.url), 'utf8'));
const targets = parseScanTargets(JSON.stringify([{ id: 'keke', title: 'Keke 两小时追踪', cronJob: 'maps-tracking-web-2h' }, { id: 'liya', title: '九家店目标清单', cronJob: 'maps-targets-web-2h', description: '270 次搜索' }]));

function fakeApi(jobs: unknown[] = []) {
  const posted: unknown[] = [];
  const leases = new Map<string, any>();
  let revision = 0;
  const cron = (name: string, suspend: boolean) => ({ metadata: { name, uid: 'u-' + name }, spec: { schedule: '0 */2 * * *', timeZone: 'America/New_York', suspend,
    jobTemplate: { metadata: { labels: { 'app.kubernetes.io/component': name } }, spec: { completions: 2, parallelism: 2, template: { spec: { containers: [{ name: 'tracking', image: 'img' }] } } } } }, status: { lastScheduleTime: '2026-10-21T04:00:00Z' } });
  const api: KubeApi = {
    async get(path) {
      if (path.endsWith('/cronjobs/maps-tracking-web-2h')) return cron('maps-tracking-web-2h', false);
      if (path.endsWith('/cronjobs/maps-targets-web-2h')) return cron('maps-targets-web-2h', true);
      if (path.includes('/leases/')) { const item = leases.get(path.split('/').at(-1)!); if (!item) throw new ScanTriggerError(404, 'not found'); return structuredClone(item); }
      if (/\/jobs\/[^?]+$/.test(path)) { const item = [...jobs, ...posted].find((j: any) => j.metadata?.name === path.split('/').at(-1)); if (!item) throw new ScanTriggerError(404, 'not found'); return structuredClone(item); }
      if (path.includes('/jobs?')) return { items: [...jobs, ...posted] };
      throw new ScanTriggerError(502, 'Kubernetes API 404: not found');
    },
    async put(path, body) {
      const item = body as any, key = path.split('/').at(-1)!;
      if (leases.get(key)?.metadata.resourceVersion !== item.metadata.resourceVersion) throw new ScanTriggerError(409, 'conflict');
      const saved = { ...item, metadata: { ...item.metadata, resourceVersion: String(++revision) } }; leases.set(key, saved); return structuredClone(saved);
    },
    async post(path, body) {
      if (path.endsWith('/leases')) {
        const item = body as any, key = item.metadata.name;
        if (leases.has(key)) throw new ScanTriggerError(409, 'already exists');
        const saved = { ...item, metadata: { ...item.metadata, resourceVersion: String(++revision) } }; leases.set(key, saved); return structuredClone(saved);
      }
      expect(path).toBe('/apis/batch/v1/namespaces/uat/jobs');
      const job = body as { metadata: object };
      posted.push({ ...job, metadata: { ...job.metadata, creationTimestamp: '2026-10-21T05:07:00Z' }, status: { active: 1, startTime: '2026-10-21T05:07:01Z' } });
      return posted.at(-1);
    },
  };
  return { api, posted, leases };
}

describe('scan trigger', () => {
  it('parses and validates the target configuration', () => {
    expect(parseScanTargets(undefined)).toEqual([]);
    expect(targets[1]).toMatchObject({ id: 'liya', cronJob: 'maps-targets-web-2h', description: '270 次搜索' });
    for (const bad of ['{}', '[{"id":"A","title":"x","cronJob":"c"}]', '[{"id":"a","title":"","cronJob":"c"}]', '[{"id":"a","title":"x","cronJob":"has space"}]', '[{"id":"a","title":"x","cronJob":"c"},{"id":"a","title":"y","cronJob":"d"}]', 'nope']) {
      expect(() => parseScanTargets(bad)).toThrow();
    }
  });
  it('creates a manual Job from the CronJob template without touching the CronJob', async () => {
    const { api, posted } = fakeApi([{ metadata: { name: 'maps-tracking-web-2h-29875800', creationTimestamp: '2026-10-21T02:00:00Z' }, spec: { completions: 2 }, status: { succeeded: 2, conditions: [{ type: 'Complete', status: 'True', lastTransitionTime: '2026-10-21T02:15:00Z' }] } }]);
    const trigger = createScanTrigger(targets, api, 'uat', { now: () => new Date('2026-10-21T05:07:00Z') });
    const before = await trigger.targets();
    expect(before).toMatchObject([{ id: 'keke', schedule: '0 */2 * * *', suspended: false, running: false, lastScheduleTime: '2026-10-21T04:00:00Z' }, { id: 'liya', suspended: true, running: false }]);
    const job = await trigger.trigger('keke');
    expect(job).toMatchObject({ target: 'keke', status: 'running', manual: true, active: 1, completions: 2 });
    expect(job.name).toMatch(/^maps-tracking-web-2h-manual-202610210507-[0-9a-f]{4}$/);
    expect(posted[0]).toMatchObject({ apiVersion: 'batch/v1', kind: 'Job', metadata: { namespace: 'uat', labels: { 'app.kubernetes.io/component': 'maps-tracking-web-2h', 'maps-keyword-capture/trigger': 'ui' },
      annotations: { 'cronjob.kubernetes.io/instantiate': 'manual', 'maps-keyword-capture/from-cronjob': 'maps-tracking-web-2h' } }, spec: { completions: 2, parallelism: 2 } });
    expect((await trigger.targets())[0]).toMatchObject({ running: true });
    await expect(trigger.trigger('keke')).rejects.toMatchObject({ status: 409 });
    await expect(trigger.trigger('nope')).rejects.toMatchObject({ status: 404 });
    const jobs = await trigger.jobs();
    expect(jobs.map(j => [j.target, j.status])).toEqual([['keke', 'running'], ['keke', 'succeeded']]);
    expect(posted).toHaveLength(1);
  });
  it('serializes concurrent triggers across independent UI instances', async () => {
    const { api, posted } = fakeApi();
    const a = createScanTrigger(targets, api, 'uat'), b = createScanTrigger(targets, api, 'uat');
    const results = await Promise.allSettled([a.trigger('keke'), b.trigger('keke')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(posted).toHaveLength(1);
  });
  it('allows a new trigger after terminal completion and uses CAS when two instances race to reuse the reservation', async () => {
    const { api, posted } = fakeApi(); const a = createScanTrigger(targets, api, 'uat');
    await a.trigger('keke');
    (posted[0] as any).status = { conditions: [{ type: 'Complete', status: 'True' }] };
    const results = await Promise.allSettled([a.trigger('keke'), createScanTrigger(targets, api, 'uat').trigger('keke')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(posted).toHaveLength(2);
  });
  it('blocks retry after an ambiguous Job POST even when the Job is not visible', async () => {
    const { api, posted } = fakeApi(); const post = api.post;
    api.post = async (path, body) => { if (path.endsWith('/jobs')) throw new ScanTriggerError(504, 'response lost'); return post(path, body); };
    await expect(createScanTrigger(targets, api, 'uat').trigger('keke')).rejects.toMatchObject({ status: 504 });
    await expect(createScanTrigger(targets, api, 'uat').trigger('keke')).rejects.toMatchObject({ status: 409 });
    expect(posted).toHaveLength(0);
  });
  it('can reuse a submitted reservation after Job TTL cleanup, without expiry-based stealing', async () => {
    const { api, posted } = fakeApi(); const trigger = createScanTrigger(targets, api, 'uat');
    await trigger.trigger('keke'); posted.length = 0;
    await expect(trigger.trigger('keke')).resolves.toMatchObject({ status: 'running' });
  });
  it('checks older and paginated Jobs before applying the UI recent limit, including a failed Pod in a nonterminal Job', async () => {
    const { api, posted } = fakeApi(); const get = api.get;
    api.get = async path => path.includes('/jobs?') ? path.includes('continue=next')
      ? { items: [{ metadata: { name: 'maps-tracking-web-2h-old', creationTimestamp: '2020-01-01' }, status: { failed: 1 } }] }
      : { metadata: { continue: 'next' }, items: Array.from({ length: 10 }, (_, i) => ({ metadata: { name: `maps-tracking-web-2h-done-${i}`, creationTimestamp: '2026-01-01' }, status: { conditions: [{ type: 'Complete', status: 'True' }] } })) }
      : get(path);
    const trigger = createScanTrigger(targets, api, 'uat', { recentPerTarget: 2 });
    expect((await trigger.targets())[0]!.running).toBe(true);
    await expect(trigger.trigger('keke')).rejects.toMatchObject({ status: 409 }); expect(posted).toHaveLength(0);
  });
  it('classifies job states from conditions and counters', async () => {
    const { api } = fakeApi([
      { metadata: { name: 'maps-targets-web-2h-a', creationTimestamp: '2026-10-21T01:00:00Z' }, spec: { completions: 2 }, status: { failed: 1, conditions: [{ type: 'Failed', status: 'True', lastTransitionTime: '2026-10-21T01:30:00Z' }] } },
      { metadata: { name: 'maps-targets-web-2h-b', creationTimestamp: '2026-10-21T02:00:00Z' }, spec: { completions: 2 }, status: {} },
      { metadata: { name: 'unrelated-job', creationTimestamp: '2026-10-21T03:00:00Z' }, status: { active: 1 } },
    ]);
    const jobs = await createScanTrigger(targets, api, 'uat').jobs();
    expect(jobs.map(j => [j.name, j.status, j.finishedAt])).toEqual([['maps-targets-web-2h-b', 'pending', null], ['maps-targets-web-2h-a', 'failed', '2026-10-21T01:30:00Z']]);
  });
});

describe('scan API', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()));
  it('exposes targets and jobs, triggers with same-origin JSON, and is absent in read-only previews', async () => {
    const { api } = fakeApi();
    const scans = createScanTrigger(targets, api, 'uat');
    server = startServer({ config: parseTrackingConfig(raw), repo: new MemoryTrackingRepository(), scans }, 0);
    await new Promise(resolve => server!.once('listening', resolve));
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    expect(await (await fetch(base + '/api/settings')).json()).toMatchObject({ scans: true, signedIn: false });
    const listed = await (await fetch(base + '/api/scans')).json();
    expect(listed.targets).toHaveLength(2); expect(listed.jobs).toEqual([]);
    expect((await fetch(base + '/api/scans/keke/trigger', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: '{}' })).status).toBe(403);
    const created = await fetch(base + '/api/scans/keke/trigger', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(created.status).toBe(202); expect((await created.json()).name).toContain('maps-tracking-web-2h-manual-');
    expect((await fetch(base + '/api/scans/keke/trigger', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(409);
    expect((await fetch(base + '/api/scans/zzz/trigger', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = startServer({ config: parseTrackingConfig(raw), repo: new MemoryTrackingRepository(), scans, readOnly: true }, 0);
    await new Promise(resolve => server!.once('listening', resolve));
    const ro = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    expect(await (await fetch(ro + '/api/settings')).json()).toMatchObject({ scans: false });
    expect((await fetch(ro + '/api/scans/keke/trigger', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = startServer({ config: parseTrackingConfig(raw), repo: new MemoryTrackingRepository() }, 0);
    await new Promise(resolve => server!.once('listening', resolve));
    const none = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    expect((await fetch(none + '/api/scans')).status).toBe(503);
  });
});
