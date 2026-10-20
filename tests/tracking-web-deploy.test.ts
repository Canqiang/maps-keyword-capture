import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseStore, parseTrackingConfig, planScan, toWebBatches, withStores } from '../src/domain/tracking-config.js';

const readYaml = (name: string) => parse(readFileSync(new URL(`../deploy/tracking-web/${name}`, import.meta.url), 'utf8'));

describe('two-hourly web tracking deployment', () => {
  it('ships a tracking-config/v1 ConfigMap that plans one point batch per store with every keyword', () => {
    const cm = readYaml('configmap.yaml');
    expect(cm).toMatchObject({ kind: 'ConfigMap', metadata: { name: 'maps-tracking-config', namespace: 'uat' } });
    const settings = parseTrackingConfig(JSON.parse(cm.data['tracking.json']));
    expect(settings.storeSource).toEqual({ provider: 'mongo', collection: 'stores' });
    expect(settings.stores).toEqual([]);
    // The seed file is what was imported into the stores collection.
    const config = withStores(settings, JSON.parse(readFileSync(new URL('../deploy/tracking-web/stores-seed.json', import.meta.url), 'utf8')).stores.map((s: unknown) => parseStore(s)));
    expect(config.timezone).toBe('America/New_York');
    expect(config.surfaces.web.point).toEqual({ everyHours: 2, keywords: 'all' });
    expect(config.surfaces.web.grid.enabled).toBe(false);
    expect(config.stores.map(s => s.storeId)).toEqual(['keke-flushing']);
    expect(config.stores[0]!.keywords.core).toHaveLength(5);
    expect(config.stores[0]!.keywords.core.length + config.stores[0]!.keywords.longTail.length).toBe(42);
    const batches = toWebBatches(planScan(config, { surface: 'web', tier: 'point' }));
    expect(batches.map(b => [b.storeId, b.pointId, b.config.keywords.length])).toEqual([['keke-flushing', 'r0c0', 20], ['keke-flushing', 'r0c0', 20], ['keke-flushing', 'r0c0', 2]]);
    expect(batches[0]!.config.mapView).toEqual({ latitude: 40.7658211, longitude: -73.8315243, zoom: 15 });
  });

  it('schedules every two hours in store time, forbids overlap and runs the tracking scan on the uatops pool', () => {
    const cron = readYaml('cronjob.yaml');
    expect(cron).toMatchObject({ kind: 'CronJob', metadata: { name: 'maps-tracking-web-2h', namespace: 'uat' } });
    expect(cron.spec).toMatchObject({ schedule: '0 */2 * * *', timeZone: 'America/New_York', concurrencyPolicy: 'Forbid', startingDeadlineSeconds: 1800, suspend: false });
    const pod = cron.spec.jobTemplate.spec.template.spec;
    expect(cron.spec.jobTemplate.spec).toMatchObject({ completionMode: 'Indexed', completions: 2, parallelism: 2, backoffLimitPerIndex: 0, activeDeadlineSeconds: 6600 });
    expect(pod).toMatchObject({ restartPolicy: 'Never', automountServiceAccountToken: false, nodeSelector: { envpool: 'uatops' }, securityContext: { runAsNonRoot: true, runAsUser: 1001 } });
    const container = pod.containers[0];
    expect(container.args).toEqual(['node', 'dist/domain/cli.js', 'scan', '--config', '/config/tracking.json', '--surface', 'web', '--tier', 'point', '--storage', 'azure', '--output-dir', '/work/outputs', '--mongo-uri-env', 'MAPS_TRACKING_MONGO_URI', '--shard-count', '2']);
    expect(container.args.at(-1)).toBe(String(cron.spec.jobTemplate.spec.completions));
    expect(container.image).toMatch(/^fbrdevacr\.azurecr\.io\/ai\/maps-keyword-capture@sha256:[a-f0-9]{64}$/);
    expect(container.env).toContainEqual({ name: 'IMAGE_DIGEST', value: container.image.split('@')[1] });
    expect(container.env).toContainEqual({ name: 'AZURE_STORAGE_CONTAINER', value: 'maps-keyword-capture-uat' });
    expect(container.env).toContainEqual({ name: 'MAPS_TRACKING_MONGO_URI', valueFrom: { secretKeyRef: { name: 'maps-keyword-monitor-source', key: 'KEYWORD_MONGO_URI' } } });
    expect(container.securityContext).toMatchObject({ readOnlyRootFilesystem: true, allowPrivilegeEscalation: false });
    expect(pod.volumes.map((v: { name: string }) => v.name)).toEqual(['config', 'work', 'tmp', 'dshm']);
    expect(pod.volumes[0].configMap.name).toBe('maps-tracking-config');
    expect(JSON.stringify(pod)).not.toMatch(/mongodb:\/\/|serviceAccountName|AZURE_STORAGE_ACCOUNT_KEY/);
  });

  it('runs the UI on the same image as a ClusterIP service with read-only secrets', () => {
    const docs = readFileSync(new URL('../deploy/tracking-ui/deployment.yaml', import.meta.url), 'utf8').split(/^---$/m).map(d => parse(d));
    const [deployment, service] = docs;
    const cron = readYaml('cronjob.yaml');
    const container = deployment.spec.template.spec.containers[0];
    expect(container.image).toBe(cron.spec.jobTemplate.spec.template.spec.containers[0].image);
    expect(container.args).toEqual(['node', 'dist/web/server.js']);
    expect(deployment.spec.template.spec).toMatchObject({ automountServiceAccountToken: false, nodeSelector: { envpool: 'uatops' } });
    expect(container.securityContext).toMatchObject({ readOnlyRootFilesystem: true, allowPrivilegeEscalation: false });
    expect(deployment.spec.template.spec.volumes[0].configMap.name).toBe('maps-tracking-config');
    expect(service.spec).toMatchObject({ type: 'ClusterIP', ports: [{ port: 80, targetPort: 'http' }] });
  });
});
