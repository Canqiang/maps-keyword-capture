import assert from 'node:assert/strict';
import test from 'node:test';
import { createReceipt } from '../scripts/image-receipt.mjs';

function fixture(surface = 'web') {
  const env = { GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2',
    IMAGE_SURFACE: surface, IMAGE_REPOSITORY: surface === 'web' ? 'ai/maps-keyword-capture' : 'ai/maps-keyword-capture-android',
    BUILD_DIGEST: `sha256:${'b'.repeat(64)}`, ACR_SERVER: 'fbrdevacr.azurecr.io', GITHUB_REPOSITORY: 'Canqiang/maps-keyword-capture' };
  env.IMAGE_TAG = `sha-${env.GITHUB_SHA}-123-2`;
  const attributes = { writeEnabled: false, deleteEnabled: false, readEnabled: true, listEnabled: true };
  return { env, tag: { name: env.IMAGE_TAG, digest: env.BUILD_DIGEST, changeableAttributes: { ...attributes } },
    manifest: { digest: env.BUILD_DIGEST, changeableAttributes: { ...attributes } } };
}

test('produces digest-pinned pull references for both surfaces', () => {
  for (const surface of ['web', 'android']) {
    const { env, tag, manifest } = fixture(surface);
    const receipt = createReceipt(env, tag, manifest);
    assert.equal(receipt.image, `${env.ACR_SERVER}/${env.IMAGE_REPOSITORY}@${env.BUILD_DIGEST}`);
    assert.equal(receipt.commit, env.GITHUB_SHA);
    assert.equal(receipt.workflowRun, 'https://github.com/Canqiang/maps-keyword-capture/actions/runs/123/attempts/2');
  }
});

test('rejects tag replacement or a missing registry manifest', () => {
  const { env, tag, manifest } = fixture();
  assert.throws(() => createReceipt(env, { ...tag, digest: `sha256:${'c'.repeat(64)}` }, manifest), /readback/);
  assert.throws(() => createReceipt(env, tag, null), /readback/);
  assert.throws(() => createReceipt(env, { ...tag, name: 'latest' }, manifest), /readback/);
});

test('requires independently locked readable tag and manifest', () => {
  for (const kind of ['tag', 'manifest']) {
    for (const [attribute, value] of [['writeEnabled', true], ['deleteEnabled', true], ['readEnabled', false]]) {
      const f = fixture();
      f[kind].changeableAttributes[attribute] = value;
      assert.throws(() => createReceipt(f.env, f.tag, f.manifest), /writable|deletable|pulled/);
    }
    const f = fixture();
    delete f[kind].changeableAttributes;
    assert.throws(() => createReceipt(f.env, f.tag, f.manifest), /writable|deletable/);
  }
});

test('rejects moving tags and unapproved repository or source identities', () => {
  for (const override of [{ IMAGE_TAG: 'latest' }, { GITHUB_REPOSITORY: 'someone/fork' },
    { IMAGE_REPOSITORY: 'another/image' }, { GITHUB_SHA: 'not-a-commit' }, { IMAGE_SURFACE: 'constructor' }]) {
    const { env, tag, manifest } = fixture();
    assert.throws(() => createReceipt({ ...env, ...override }, tag, manifest), /Invalid|Unexpected/);
  }
});
