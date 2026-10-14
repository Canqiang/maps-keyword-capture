import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseMonitorConfig } from '../src/monitor/config.js';

const readYaml = (name: string) => parse(readFileSync(new URL(`../deploy/uat-monitor/${name}`, import.meta.url), 'utf8'));

// Verified 2026-09-17 UAT inventory: stored names, six merchant IDs and seven distinct Place IDs.
const linkedStores = [
  ['choice-upper-west-side', '47c65660-ade7-4431-8d46-9ec9c58aef5b', 'ChIJH8iZh-5ZwokRPLzzADeSnYE', 'Choice Brooklyn - Upper West Side'],
  ['choice-clinton-hill', '47c65660-ade7-4431-8d46-9ec9c58aef5b', 'ChIJaYcllU0N7ocR4lWiLngfEYg', 'Choice Market - Clinton Hill'],
  ['only-bear', '04ef8b4c-4837-4cf2-a8f5-0c9228658376', 'ChIJgR0AKI2HwokRcMm_K7J7Phw', 'Only Bear Chicken & Boba'],
  ['keke-flushing', '29742a52-d824-469b-a395-52084345b7ad', 'ChIJRTD3Ws5hwokRES78IFU7zW0', 'Keke Food 可可小卤 — Flushing'],
  ['george-merchant', '54b78da8-4d71-4576-8f59-915e7bd94561', 'ChIJqVId_y1ZwokRjPCG1MQuKmg', 'George Merchant'],
  ['massage-float', '4ccdade0-dd69-4853-809f-2fd25ae65030', 'ChIJzfqHtwq7uokRvkBKgpmXPiM', 'Massage & float'],
  ['szechuan-gourmet', 'ec3a8e03-28c0-4291-9f94-14289e63cdc7', 'ChIJZ4gQONX3wokRUd76p6byNOE', 'Szechuan Gourmet 朵颐食府'],
].map(([storeId, merchantId, placeId, name]) => ({ storeId, merchantId, placeId, name }));

describe('UAT daily monitor deployment', () => {
  it('starts suspended at Beijing midnight with bounded, non-overlapping jobs', () => {
    const cron = readYaml('cronjob.yaml');
    expect(cron).toMatchObject({ apiVersion: 'batch/v1', kind: 'CronJob', metadata: { name: 'maps-keyword-monitor-daily', namespace: 'uat' } });
    expect(cron.spec).toMatchObject({ schedule: '0 0 * * *', timeZone: 'Asia/Shanghai', suspend: true, concurrencyPolicy: 'Forbid', startingDeadlineSeconds: 3600, successfulJobsHistoryLimit: 7, failedJobsHistoryLimit: 7 });
    expect(cron.spec.jobTemplate.spec).toMatchObject({ backoffLimit: 0, activeDeadlineSeconds: 14 * 3600 + 600 });
    expect(cron.spec.jobTemplate.spec.template.spec).toMatchObject({ restartPolicy: 'Never', terminationGracePeriodSeconds: 300, automountServiceAccountToken: false, nodeSelector: { envpool: 'aiapp' } });
  });

  it('discovers live stores while preserving historical aliases and the per-place keyword API', () => {
    const cm = readYaml('configmap.yaml');
    expect(cm).toMatchObject({ kind: 'ConfigMap', metadata: { name: 'maps-keyword-monitor-keke-20261014-v1', namespace: 'uat' } });
    expect(Object.keys(cm.data)).toEqual(['monitor.json']);
    const config = JSON.parse(cm.data['monitor.json']);
    const { monitoringKeywordSets, ...sharedConfig } = config;
    expect(sharedConfig).toEqual({
      schemaVersion: '1', sourceBaseUrl: 'http://operation-assistant-api.uat.svc.cluster.local:80', stores: linkedStores,
      storeDiscovery: { provider: 'mongo', database: 'seo-integration', collection: 'local_keywords', maxStores: 40, maxRecords: 10000, timeoutMs: 30000, excludedPlaces: [{ placeId: 'ChIJqVId_y1ZwokRjPCG1MQuKmg', reason: 'test_store' }] },
      maxKeywordsPerStore: 40, batchSize: 20, sourceTimeoutMs: 15000, outputDirectory: '/work/outputs',
      capture: { maxResultsPerKeyword: 15, maxScrollsPerKeyword: 10, maxScreenshotsPerKeyword: 8, keywordTimeoutMs: 90000, locale: 'en-US', browserTimezoneId: 'America/New_York', filenameTimezone: 'Asia/Shanghai', viewport: { width: 1440, height: 1000 } },
    });
    expect(parseMonitorConfig(config)).toMatchObject(config);
    expect(new Set(config.stores.map((store: { merchantId: string }) => store.merchantId)).size).toBe(6);
    expect(new Set(config.stores.map((store: { placeId: string }) => store.placeId)).size).toBe(7);
    expect(JSON.stringify(sharedConfig)).not.toMatch(/"(?:keywords|geolocation|latitude|longitude)"/);
    expect(monitoringKeywordSets).toHaveLength(1);
    expect(monitoringKeywordSets[0]).toMatchObject({ merchantId: '29742a52-d824-469b-a395-52084345b7ad', placeId: 'ChIJRTD3Ws5hwokRES78IFU7zW0' });
    expect(monitoringKeywordSets[0].keywords).toHaveLength(40);
    for (const [group, count] of [['core', 32], ['exploration', 6], ['brand', 2]] as const) expect(monitoringKeywordSets[0].keywords.filter((k: { group: string }) => k.group === group)).toHaveLength(count);
  });

  it('uses the monitor CLI and an isolated UAT Secret and container', () => {
    const pod = readYaml('cronjob.yaml').spec.jobTemplate.spec.template.spec;
    expect(pod.containers).toHaveLength(1);
    const container = pod.containers[0];
    expect(container.args).toEqual(['node', 'dist/monitor/cli.js', '--config', '/config/monitor.json', '--storage', 'azure']);
    expect(container.image).toMatch(/^fbrdevacr\.azurecr\.io\/ai\/maps-keyword-capture@sha256:[a-f0-9]{64}$/);
    expect(container.env).toContainEqual({ name: 'IMAGE_DIGEST', value: container.image.split('@')[1] });
    expect(container.env).toContainEqual({ name: 'KEYWORD_MONGO_URI', valueFrom: { secretKeyRef: { name: 'maps-keyword-monitor-source', key: 'KEYWORD_MONGO_URI' } } });
    expect(container.env).toContainEqual({ name: 'AZURE_STORAGE_CONTAINER', value: 'maps-keyword-capture-uat' });
    expect(container.env).toContainEqual({ name: 'AZURE_STORAGE_CONTAINER_SAS_URL', valueFrom: { secretKeyRef: { name: 'maps-keyword-monitor-storage', key: 'AZURE_STORAGE_CONTAINER_SAS_URL' } } });
    expect(JSON.stringify(pod)).not.toMatch(/maps-keyword-capture-storage|MONGODB|AZURE_STORAGE_ACCOUNT_KEY|serviceAccountName/);
    expect(pod.volumes).toContainEqual({ name: 'config', configMap: { name: 'maps-keyword-monitor-keke-20261014-v1' } });
  });

  it('preserves hardened Pod isolation and bounded staging resources', () => {
    const pod = readYaml('cronjob.yaml').spec.jobTemplate.spec.template.spec;
    expect(pod.securityContext).toEqual({ runAsNonRoot: true, runAsUser: 1001, runAsGroup: 1001, fsGroup: 1001 });
    expect(pod.containers[0].securityContext).toEqual({ allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } });
    expect(pod.containers[0].resources).toEqual({ requests: { cpu: '250m', memory: '1Gi', 'ephemeral-storage': '1Gi' }, limits: { cpu: '2', memory: '2Gi', 'ephemeral-storage': '3Gi' } });
    expect(pod.volumes).toEqual(expect.arrayContaining([
      { name: 'work', emptyDir: { sizeLimit: '2Gi' } }, { name: 'tmp', emptyDir: { sizeLimit: '1Gi' } }, { name: 'dshm', emptyDir: { medium: 'Memory', sizeLimit: '512Mi' } },
    ]));
    expect(pod.containers[0].volumeMounts).toEqual([
      { name: 'config', mountPath: '/config', readOnly: true }, { name: 'work', mountPath: '/work' }, { name: 'tmp', mountPath: '/tmp' }, { name: 'dshm', mountPath: '/dev/shm' },
    ]);
  });
});
