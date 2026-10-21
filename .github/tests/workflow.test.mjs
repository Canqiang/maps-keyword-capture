import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../workflows/images.yml', import.meta.url), 'utf8'));

test('only publish gets OIDC and only tested approved branches can publish', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.jobs.checks.permissions?.['id-token'], undefined);
  const publish = workflow.jobs.publish;
  assert.equal(publish.needs, 'checks');
  assert.deepEqual(publish.permissions, { contents: 'read', 'id-token': 'write' });
  assert.equal(publish.environment, undefined);
  assert.match(publish.if, /github\.repository == 'Canqiang\/maps-keyword-capture'/);
  assert.match(publish.if, /vars\.ACR_PUBLISH_ENABLED == 'true'/);
  assert.match(publish.if, /github\.event_name != 'pull_request'/);
  assert.match(publish.if, /github\.ref == 'refs\/heads\/main'/);
  assert.deepEqual(workflow.on.push.branches, ['main', 'codex/fix-tracking-review-20261020']);
});

test('all action dependencies are SHA pinned and checkout leaves no token', () => {
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps.filter(step => step.uses)) {
      assert.match(step.uses, /^[\w/-]+@[a-f0-9]{40}$/);
      if (step.uses.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
    }
  }
});

test('Web and Android both publish only run-unique tags with commit metadata', () => {
  const publish = workflow.jobs.publish;
  assert.deepEqual(publish.strategy.matrix.include.map(row => row.surface).sort(), ['android', 'web']);
  assert.equal(publish.env.IMAGE_TAG, 'sha-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}');
  const build = publish.steps.find(step => step.id === 'image');
  assert.equal(build.with.context, '.');
  assert.equal(build.with['build-args'], 'GIT_COMMIT=${{ github.sha }}');
  assert.equal(build.with.platforms, 'linux/amd64');
  assert.equal(build.with.push, true);
});
