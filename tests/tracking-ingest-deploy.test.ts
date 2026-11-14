import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

describe('daily-monitor ingestion CronJob', () => {
  const cron = parse(readFileSync(new URL('../deploy/tracking-ingest/cronjob.yaml', import.meta.url), 'utf8'));
  it('runs append-only ingest ninety minutes after every unlocated round with read-only evidence access and no browser', () => {
    expect(cron.metadata).toMatchObject({ name: 'maps-tracking-ingest-daily', namespace: 'uat' });
    expect(cron.spec).toMatchObject({ schedule: '30 1-23/2 * * *', timeZone: 'Asia/Shanghai', concurrencyPolicy: 'Forbid' });
    expect(cron.spec.jobTemplate.spec.activeDeadlineSeconds).toBe(1800);
    const pod = cron.spec.jobTemplate.spec.template.spec, main = pod.containers[0];
    expect(main.args.slice(0, 3)).toEqual(['node', 'dist/domain/cli.js', 'ingest-daily']);
    expect(main.args).toContain('--mongo-uri-env'); expect(main.args).not.toContain('--dry-run');
    expect(main.env.find((e: any) => e.name === 'IMAGE_DIGEST').value).toBe(main.image.split('@')[1]);
    expect(main.env.filter((e: any) => e.valueFrom?.secretKeyRef).map((e: any) => e.valueFrom.secretKeyRef.name).sort()).toEqual(['maps-keyword-monitor-source', 'maps-tracking-ingest-storage']);
    expect(pod).toMatchObject({ automountServiceAccountToken: false, restartPolicy: 'Never', nodeSelector: { envpool: 'uatops' } });
    expect(main.securityContext).toMatchObject({ allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } });
    expect(pod.volumes.find((v: any) => v.name === 'config').configMap.name).toBe('maps-targets-liya90-v1-476d4c50');
    expect(pod.volumes.some((v: any) => v.name === 'dshm')).toBe(false);
  });
});
