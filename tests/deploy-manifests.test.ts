import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseConfig } from '../src/config.js';
import { batchDeadlineMs } from '../src/runner/batch-runner.js';

// Kubernetes manifests are untyped YAML documents.
type Doc = any;

async function load(path: string): Promise<Doc> {
  return parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
}

const SCHEDULED_CONFIG_MAP = 'maps-capture-keywords-daily';
const SCHEDULED_INSTANCE = { 'app.kubernetes.io/instance': 'maps-capture-daily' };

describe('CronJob schedule', () => {
  it('runs the same Job as deploy/job/job.yaml, except for its keywords, instance label, and history', async () => {
    const job = await load('deploy/job/job.yaml');
    const cron = await load('deploy/cronjob/cronjob.yaml');

    const expected = structuredClone(job.spec);
    // Scheduled Jobs and their Pods are removed 10 minutes after they finish; results are in Azure.
    expected.ttlSecondsAfterFinished = 600;
    expected.template.metadata.labels = { ...expected.template.metadata.labels, ...SCHEDULED_INSTANCE };
    const configVolume = expected.template.spec.volumes.find((v: Doc) => v.name === 'config');
    configVolume.configMap.name = SCHEDULED_CONFIG_MAP;

    expect(cron.spec.jobTemplate.spec).toEqual(expected);
    expect(cron.spec.jobTemplate.metadata).toEqual({ labels: { ...job.metadata.labels, ...SCHEDULED_INSTANCE } });
    expect(cron.metadata.namespace).toBe(job.metadata.namespace);
  });

  it('never overlaps runs, uses an explicit time zone, and keeps a bounded history', async () => {
    const cron = await load('deploy/cronjob/cronjob.yaml');
    expect(cron.kind).toBe('CronJob');
    expect(cron.spec.concurrencyPolicy).toBe('Forbid');
    expect(cron.spec.schedule).toMatch(/^\S+ \S+ \S+ \S+ \S+$/);
    expect(typeof cron.spec.timeZone).toBe('string');
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: cron.spec.timeZone })).not.toThrow();
    expect(cron.spec.successfulJobsHistoryLimit).toBeGreaterThan(0);
    expect(cron.spec.failedJobsHistoryLimit).toBeGreaterThan(0);
    expect(cron.spec.startingDeadlineSeconds).toBeGreaterThan(0);
  });

  it('keeps the filename time zone that deploy/cronjob/README.md uses to find a day\'s runs', async () => {
    const cm = await load('deploy/cronjob/configmap.yaml');
    expect(parseConfig(JSON.parse(cm.data['keywords.json'])).config.filenameTimezone).toBe('Asia/Shanghai');
  });
});

const workloads = [
  { name: 'manual Job', workload: 'deploy/job/job.yaml', configMap: 'deploy/job/configmap.yaml', jobSpec: (d: Doc) => d.spec },
  { name: 'scheduled CronJob', workload: 'deploy/cronjob/cronjob.yaml', configMap: 'deploy/cronjob/configmap.yaml', jobSpec: (d: Doc) => d.spec.jobTemplate.spec },
];

describe.each(workloads)('$name', ({ workload, configMap, jobSpec }) => {
  it('pins one image digest in both the image and IMAGE_DIGEST', async () => {
    const container = jobSpec(await load(workload)).template.spec.containers[0];
    const digest = container.env.find((e: Doc) => e.name === 'IMAGE_DIGEST')?.value;
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(container.image).toBe(`fbrdevacr.azurecr.io/ai/maps-keyword-capture@${digest}`);
  });

  it('mounts a valid keyword ConfigMap whose batch budget fits the Job deadline', async () => {
    const doc = await load(workload);
    const spec = jobSpec(doc);
    const cm = await load(configMap);
    const volume = spec.template.spec.volumes.find((v: Doc) => v.name === 'config');
    expect(cm.metadata.name).toBe(volume.configMap.name);
    expect(cm.metadata.namespace).toBe(doc.metadata.namespace);

    const { config, duplicateKeywordCount } = parseConfig(JSON.parse(cm.data['keywords.json']));
    expect(duplicateKeywordCount).toBe(0);
    // Only /work is a writable emptyDir; the root filesystem is read-only.
    expect(config.outputDirectory.startsWith('/work/')).toBe(true);
    // Coarse guard, not an exact bound: the Job deadline also covers Pending and startup time, and
    // must leave room after the application's batch deadline for the shutdown path (in-flight round,
    // browser close, final manifest), which the grace period bounds.
    const appBudgetSeconds = batchDeadlineMs(config) / 1000;
    expect(appBudgetSeconds + spec.template.spec.terminationGracePeriodSeconds).toBeLessThanOrEqual(spec.activeDeadlineSeconds);
  });
});
