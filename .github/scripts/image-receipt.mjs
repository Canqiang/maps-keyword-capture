import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const repositories = {
  web: 'ai/maps-keyword-capture',
  android: 'ai/maps-keyword-capture-android',
};

export function createReceipt(env, tag, manifest) {
  const { GITHUB_SHA: commit, GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: attempt,
    IMAGE_SURFACE: surface, IMAGE_REPOSITORY: repository, IMAGE_TAG: imageTag,
    BUILD_DIGEST: digest, ACR_SERVER: registry, GITHUB_REPOSITORY: source } = env;
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || !/^\d+$/.test(runId ?? '') || !/^\d+$/.test(attempt ?? '')) {
    throw new Error('Invalid GitHub commit/run identity');
  }
  if (source !== 'Canqiang/maps-keyword-capture' || registry !== 'fbrdevacr.azurecr.io' ||
      !Object.hasOwn(repositories, surface) || repository !== repositories[surface]) {
    throw new Error('Unexpected image source or destination');
  }
  if (imageTag !== `sha-${commit}-${runId}-${attempt}` || !/^sha256:[a-f0-9]{64}$/.test(digest ?? '')) {
    throw new Error('Invalid immutable image identity');
  }
  if (tag?.name !== imageTag || tag?.digest !== digest || manifest?.digest !== digest) {
    throw new Error('Registry readback does not match the built image digest');
  }
  for (const [kind, record] of [['tag', tag], ['manifest', manifest]]) {
    if (record.changeableAttributes?.writeEnabled !== false || record.changeableAttributes?.deleteEnabled !== false) {
      throw new Error(`Registry ${kind} remains writable or deletable`);
    }
    if (record.changeableAttributes?.readEnabled !== true) {
      throw new Error(`Registry ${kind} cannot be pulled`);
    }
  }
  return {
    schemaVersion: 'maps-image-receipt/v1',
    surface, commit, source: `https://github.com/${source}`,
    workflowRun: `https://github.com/${source}/actions/runs/${runId}/attempts/${attempt}`,
    tag: `${registry}/${repository}:${imageTag}`,
    digest, image: `${registry}/${repository}@${digest}`,
    tagAttributes: tag.changeableAttributes,
    manifestAttributes: manifest.changeableAttributes,
    registryVerifiedAt: new Date().toISOString(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [tagPath, manifestPath, outputPath] = process.argv.slice(2);
  if (!tagPath || !manifestPath || !outputPath) throw new Error('Expected tag.json manifest.json output.json');
  const receipt = createReceipt(process.env, JSON.parse(readFileSync(tagPath, 'utf8')), JSON.parse(readFileSync(manifestPath, 'utf8')));
  writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### ${receipt.surface} image\n\nCommit: \`${receipt.commit}\`\n\nPod image: \`${receipt.image}\`\n\nTag and digest verified in ACR; tag and manifest writes/deletes are disabled.\n`);
  }
}
