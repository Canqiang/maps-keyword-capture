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
  const cron = (name: string, suspend: boolean) => ({ metadata: { name, uid: 'u-' + name }, spec: { schedule: '0 */2 * * *', timeZone: 'America/New_York', suspend,
    jobTemplate: { metadata: { labels: { 'app.kubernetes.io/component': name } }, spec: { completions: 2, parallelism: 2, template: { spec: { containers: [{ name: 'tracking', image: 'img' }] } } } } }, status: { lastScheduleTime: '2026-10-21T04:00:00Z' } });
  const api: KubeApi = {
    async get(path) {
      if (path.endsWith('/cronjobs/maps-tracking-web-2h')) return cron('maps-tracking-web-2h', false);
      if (path.endsWith('/cronjobs/maps-targets-web-2h')) return cron('maps-targets-web-2h', true);
      if (path.includes('/jobs?')) return { items: [...jobs, ...posted] };
      throw new ScanTriggerError(502, 'Kubernetes API 404: not found');
    },
    async post(path, body) {
      expect(path).toBe('/apis/batch/v1/namespaces/uat/jobs');
      const job = body as { metadata: object };
      posted.push({ ...job, metadata: { ...job.metadata, creationTimestamp: '2026-10-21T05:07:00Z' }, status: { active: 1, startTime: '2026-10-21T05:07:01Z' } });
      return posted.at(-1);
    },
  };
  return { api, posted };
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
