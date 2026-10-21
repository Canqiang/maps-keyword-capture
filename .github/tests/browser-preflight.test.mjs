import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { chromiumUsernsProfile } from '../scripts/browser-preflight.mjs';

test('the CI userns allowance covers only the exact installed browser', () => {
  const executable = '/home/runner/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
  const profile = chromiumUsernsProfile(executable);
  assert.ok(profile.includes(`profile maps-capture-ci-chromium ${executable} flags=(unconfined)`));
  assert.ok(profile.includes('userns,'));
  assert.ok(!profile.includes('*'));
  for (const invalid of ['chrome', '/tmp/**/chrome', '/tmp/a\n/chrome', '/tmp/../chrome', '/tmp/{a,b}/chrome', '/tmp/chrome --no-sandbox']) {
    assert.throws(() => chromiumUsernsProfile(invalid), /absolute literal chrome path/);
  }
});

test('the production sandbox is checked before unit tests on the credential-free checks runner', () => {
  const workflow = parse(readFileSync(new URL('../workflows/images.yml', import.meta.url), 'utf8'));
  const checks = workflow.jobs.checks;
  const setup = checks.steps.findIndex(step => step.run === 'node --import tsx .github/scripts/browser-preflight.mjs');
  const units = checks.steps.findIndex(step => step.run?.startsWith('npm run test:unit'));
  assert.ok(setup > checks.steps.findIndex(step => step.run?.startsWith('npx playwright install')));
  assert.ok(setup < units);
  assert.equal(checks.permissions?.['id-token'], undefined);
  const script = readFileSync(new URL('../scripts/browser-preflight.mjs', import.meta.url), 'utf8');
  assert.ok(!script.includes('--no-sandbox'));
  assert.ok(!script.includes('sysctl -w'));
  assert.match(script, /await checkSandbox\(\);\n}/);
});
