import { readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { randomBytes } from 'node:crypto';

/**
 * "Collect now" support: creates a one-off Job from an existing CronJob's template, exactly
 * like `kubectl create job --from=cronjob/<name>`, and lists the recent Jobs of each target.
 * It never edits the CronJob, its ConfigMaps or its Secrets.
 */
export interface ScanTarget { id: string; title: string; cronJob: string; description?: string }
export interface ScanJobView {
  target: string; name: string; status: 'pending' | 'running' | 'succeeded' | 'failed';
  createdAt: string | null; startedAt: string | null; finishedAt: string | null;
  active: number; succeeded: number; failed: number; completions: number | null; manual: boolean;
}
export interface ScanTargetView extends ScanTarget { schedule: string | null; timeZone: string | null; suspended: boolean | null; running: boolean; lastScheduleTime: string | null }
export interface ScanTrigger {
  targets(): Promise<ScanTargetView[]>;
  jobs(): Promise<ScanJobView[]>;
  trigger(id: string): Promise<ScanJobView>;
}
export interface KubeApi { get(path: string): Promise<unknown>; post(path: string, body: unknown): Promise<unknown> }

export class ScanTriggerError extends Error { constructor(readonly status: number, message: string) { super(message); } }

const NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/u;

export function parseScanTargets(value: string | undefined): ScanTarget[] {
  if (!value) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('TRACKING_SCAN_TARGETS must be a JSON array'); }
  if (!Array.isArray(parsed)) throw new Error('TRACKING_SCAN_TARGETS must be a JSON array');
  const targets = parsed.map((entry: unknown) => {
    const t = entry as Partial<ScanTarget>;
    if (!t || typeof t.id !== 'string' || !NAME.test(t.id) || typeof t.cronJob !== 'string' || !NAME.test(t.cronJob) || t.cronJob.length > 40 || typeof t.title !== 'string' || !t.title.trim()) {
      throw new Error('each scan target needs id, title and cronJob (lowercase DNS names)');
    }
    return { id: t.id, title: t.title.trim().slice(0, 80), cronJob: t.cronJob, ...(typeof t.description === 'string' ? { description: t.description.slice(0, 300) } : {}) };
  });
  if (new Set(targets.map(t => t.id)).size !== targets.length) throw new Error('scan target ids must be unique');
  return targets;
}

/** In-cluster client: service-account token, CA and namespace from the projected files. */
export async function inClusterKubeApi(root = '/var/run/secrets/kubernetes.io/serviceaccount'): Promise<{ api: KubeApi; namespace: string } | undefined> {
  const host = process.env.KUBERNETES_SERVICE_HOST, port = process.env.KUBERNETES_SERVICE_PORT ?? '443';
  if (!host) return undefined;
  let ca: Buffer, namespace: string;
  try { [ca, namespace] = [await readFile(`${root}/ca.crt`), (await readFile(`${root}/namespace`, 'utf8')).trim()]; }
  catch { return undefined; }
  const call = (method: string, path: string, body?: unknown): Promise<unknown> => new Promise((resolve, reject) => {
    void readFile(`${root}/token`, 'utf8').then(token => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = httpsRequest({ host, port: Number(port), path, method, ca, timeout: 15_000, headers: {
        authorization: `Bearer ${token.trim()}`, accept: 'application/json', ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      } }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk as Buffer));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = null;
          try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
          if ((res.statusCode ?? 500) >= 400) reject(new ScanTriggerError(res.statusCode === 409 ? 409 : 502, `Kubernetes API ${res.statusCode}: ${((parsed as { message?: string })?.message ?? '').slice(0, 200)}`));
          else resolve(parsed);
        });
      });
      req.on('timeout', () => req.destroy(new ScanTriggerError(504, 'Kubernetes API timeout')));
      req.on('error', error => reject(error instanceof ScanTriggerError ? error : new ScanTriggerError(502, 'Kubernetes API unreachable')));
      if (payload) req.write(payload);
      req.end();
    }, reject);
  });
  return { api: { get: path => call('GET', path), post: (path, body) => call('POST', path, body) }, namespace };
}

interface JobResource { metadata?: { name?: string; creationTimestamp?: string; labels?: Record<string, string>; annotations?: Record<string, string> }; spec?: { completions?: number }; status?: { active?: number; succeeded?: number; failed?: number; startTime?: string; completionTime?: string; conditions?: Array<{ type: string; status: string; lastTransitionTime?: string }> } }

function jobView(target: string, job: JobResource): ScanJobView {
  const status = job.status ?? {}, active = status.active ?? 0, succeeded = status.succeeded ?? 0, failed = status.failed ?? 0;
  const completions = job.spec?.completions ?? null;
  const complete = status.conditions?.find(c => c.type === 'Complete' && c.status === 'True'), failedCondition = status.conditions?.find(c => c.type === 'Failed' && c.status === 'True');
  const state: ScanJobView['status'] = complete ? 'succeeded' : failedCondition ? 'failed' : active > 0 ? 'running' : succeeded > 0 && (completions === null || succeeded >= completions) ? 'succeeded' : failed > 0 ? 'failed' : 'pending';
  return { target, name: job.metadata?.name ?? '', status: state, createdAt: job.metadata?.creationTimestamp ?? null, startedAt: status.startTime ?? null,
    finishedAt: status.completionTime ?? complete?.lastTransitionTime ?? failedCondition?.lastTransitionTime ?? null, active, succeeded, failed, completions,
    manual: job.metadata?.annotations?.['cronjob.kubernetes.io/instantiate'] === 'manual' };
}

export function createScanTrigger(targets: ScanTarget[], api: KubeApi, namespace: string, options: { now?: () => Date; recentPerTarget?: number } = {}): ScanTrigger {
  const now = options.now ?? (() => new Date());
  const recent = options.recentPerTarget ?? 8;
  const base = `/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}`;
  const find = (id: string): ScanTarget => { const target = targets.find(t => t.id === id); if (!target) throw new ScanTriggerError(404, 'unknown scan target'); return target; };
  const jobsOf = async (target: ScanTarget): Promise<ScanJobView[]> => {
    const list = await api.get(`${base}/jobs?limit=500`) as { items?: JobResource[] };
    return (list.items ?? []).filter(job => (job.metadata?.name ?? '').startsWith(target.cronJob + '-'))
      .map(job => jobView(target.id, job)).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, recent);
  };
  return {
    async targets() {
      return Promise.all(targets.map(async target => {
        const [cron, jobs] = await Promise.all([api.get(`${base}/cronjobs/${target.cronJob}`).catch(() => null) as Promise<{ spec?: { schedule?: string; timeZone?: string; suspend?: boolean }; status?: { lastScheduleTime?: string } } | null>, jobsOf(target)]);
        return { ...target, schedule: cron?.spec?.schedule ?? null, timeZone: cron?.spec?.timeZone ?? null, suspended: cron ? Boolean(cron.spec?.suspend) : null,
          lastScheduleTime: cron?.status?.lastScheduleTime ?? null, running: jobs.some(job => job.status === 'running' || job.status === 'pending') };
      }));
    },
    async jobs() { return (await Promise.all(targets.map(jobsOf))).flat(); },
    async trigger(id) {
      const target = find(id);
      if ((await jobsOf(target)).some(job => job.status === 'running' || job.status === 'pending')) throw new ScanTriggerError(409, `${target.title} 已有一次采集在进行中，请等它结束`);
      const cron = await api.get(`${base}/cronjobs/${target.cronJob}`) as { metadata?: { name?: string; uid?: string }; spec?: { jobTemplate?: { metadata?: { labels?: Record<string, string>; annotations?: Record<string, string> }; spec?: unknown } } };
      const template = cron.spec?.jobTemplate;
      if (!template?.spec) throw new ScanTriggerError(502, 'CronJob has no job template');
      const stamp = now().toISOString().replace(/[-:T]/gu, '').slice(0, 12);
      const name = `${target.cronJob}-manual-${stamp}-${randomBytes(2).toString('hex')}`;
      const body = { apiVersion: 'batch/v1', kind: 'Job', metadata: { name, namespace,
        labels: { ...(template.metadata?.labels ?? {}), 'maps-keyword-capture/trigger': 'ui' },
        annotations: { ...(template.metadata?.annotations ?? {}), 'cronjob.kubernetes.io/instantiate': 'manual', 'maps-keyword-capture/from-cronjob': target.cronJob } }, spec: template.spec };
      const created = await api.post(`${base}/jobs`, body) as JobResource;
      return jobView(target.id, created);
    },
  };
}
