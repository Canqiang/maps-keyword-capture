# Azure Delivery and Production Job Implementation Plan (Milestones 3 and 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every artifact the collector writes (request, per-query screenshots, observations, result JSON and CSV, progress and final manifests) is uploaded to a private Azure Blob container, read back and verified by size and SHA-256, and recorded in the manifest; a production Kubernetes Job runs a batch in `dev-ai` with that delivery; and the hardening items deferred from the local-collector review are closed.

**Architecture:** A narrow `BlobGateway` interface (create-if-absent, put, get) has one Azure implementation over `@azure/storage-blob`, constructed from environment variables (container SAS URL in the Pod, account URL plus `DefaultAzureCredential` locally, connection string for the Azurite emulator in tests). A `RemoteArtifactStore` keeps the existing atomic local write as staging and makes `persist()` upload, read back, and verify, never throwing. The batch runner receives the store through a new seam, persists `request.json` as a storage preflight, checkpoints the progress manifest, stops the batch when storage is unavailable, and publishes the final manifest last with an external delivery receipt that the CLI prints.

**Tech Stack:** Node 22+, TypeScript 7.0.2, Playwright 1.63.0, `@azure/storage-blob` 12.33.0, `@azure/identity` 4.13.3, `azurite` 3.37.0 (tests only), vitest 5.0.1.

**Spec:** `docs/design.md` §11 (persistence and completion protocol) and §12 (Kubernetes execution), `docs/deployment.md`, `docs/validation-status.md` (Dev trial run section), `src/contracts.ts` (`StorageState`, `Artifact`, `PersistenceStatus`, `SkipReason`, `ManifestDeliveryReceipt`; unchanged by this plan). Storage decision, 2026-09-17: a new **private** container `maps-keyword-capture` in account `fbrdevstorage`; Pods authenticate with a container-scoped service SAS tied to a stored access policy, from Secret `maps-keyword-capture-storage` in `dev-ai`; local runs use `az login` through `DefaultAzureCredential`. The public `seo` container and the `azure-storage-account-f6eab793693c54a6891af3c-secret` Secret (a different account) are not used.

## Global Constraints

- Node `>=22`; TypeScript `7.0.2`; Playwright `1.63.0`; `@azure/storage-blob` `12.33.0`; `@azure/identity` `4.13.3`; `azurite` `3.37.0` (devDependency). Install with `--save-exact`. Do not upgrade anything else.
- `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `module: NodeNext`; relative imports use `.js`. Do not modify `src/contracts.ts` or `tsconfig.json`.
- Object key = the local relative path with its leading `maps-keyword-capture/` removed: `<YYYY-MM-DD>/<runId>/<attemptId>/...`. The container name carries the product name.
- Immutable artifacts (everything except `manifest.progress.json`) are uploaded with `If-None-Match: *`. An existing object whose bytes match the expected SHA-256 is `verified` (idempotent retry); different bytes are `failed` with code `object_conflict`. `manifest.progress.json` is the only object uploaded with overwrite.
- An artifact is `verified` only after a full download whose byte count and SHA-256 equal the local file; `.png` objects must also start with the PNG signature. `verifiedAt` is `new Date().toISOString()`.
- `persist()` never throws; failures return `{ storageStatus: 'failed', objectKey, verifiedAt: null, storageError: { code, message } }`.
- No credential or SAS signature may appear in logs, manifests, results, or error messages: `sig=` values and `AccountKey=` values are replaced with `REDACTED`.
- Local mode is unchanged: `persistenceMode: 'local_only'`, artifacts `local_only`, rows `not_requested`, no receipt, exit codes 0/2/1.
- Remote mode exit code is `1` when any row has `persistenceStatus: 'failed'`, any batch-level artifact (`queryId: null`) is not `verified`, or the final manifest receipt is missing or not `verified`; otherwise the local rules apply.
- The manifest never contains its own receipt; the CLI prints it (`ManifestDeliveryReceipt`).
- Tests never contact Azure or Google: Azure paths use an in-memory fake gateway or Azurite; browser paths use the HTML fixture.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Never commit `outputs/`, `dist/`, or any file containing a SAS URL.

---

## File structure

```text
src/storage/
  types.ts            ArtifactStore gains absolutePath() and persist(file, options?) with PersistOptions { mutable?: boolean }
  local.ts            LocalArtifactStore signature update only
  redact.ts           redactSecrets(text)
  blob-gateway.ts     BlobGateway interface, contentTypeFor(key)
  azure-gateway.ts    AzureBlobGateway, containerClientFromEnv(env), DEFAULT_CONTAINER
  remote.ts           RemoteArtifactStore (local staging + upload + read-back verification)
src/runner/
  manifest.ts         persistenceStatusFor(), recordBatchArtifact(), exitCodeFor(m, receipt), deliveryStatus()
  batch-runner.ts     store seam, storage preflight, progress checkpoints, storage and layout breakers, manifest publication, closeWithin()
  query-runner.ts     keep a blocked outcome when an export fails
src/cli.ts            --storage local|azure, remote store construction, receipt in the summary
tests/helpers/
  fake-gateway.ts     in-memory BlobGateway with failure injection
  azurite.ts          startAzurite() for integration tests
deploy/job/
  configmap.yaml      keywords for a production batch
  job.yaml            production Job (generateName, --storage azure, Secret env)
  README.md           infrastructure setup, build, run, inspect, rotate
```

---

### Task 1: Azure Blob gateway and secret redaction

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/storage/redact.ts`, `src/storage/blob-gateway.ts`, `src/storage/azure-gateway.ts`, `tests/helpers/azurite.ts`, `tests/redact.test.ts`, `tests/azure-gateway.test.ts`

**Interfaces:**
- Consumes: `ConfigError` from `src/config.ts` (has `exitCode: 64`).
- Produces:
  - `redactSecrets(text: string): string`
  - `interface BlobGateway { readonly description: string; createIfAbsent(key: string, data: Buffer, contentType: string): Promise<'created' | 'exists'>; put(key: string, data: Buffer, contentType: string): Promise<void>; get(key: string): Promise<Buffer> }`
  - `contentTypeFor(key: string): string`
  - `DEFAULT_CONTAINER = 'maps-keyword-capture'`
  - `containerClientFromEnv(env: NodeJS.ProcessEnv): ContainerClient` (throws `ConfigError`)
  - `class AzureBlobGateway implements BlobGateway { constructor(container: ContainerClient) }`
  - `startAzurite(): Promise<{ connectionString: string; stop(): Promise<void> }>` (tests)

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/xander/git_repo/maps-keyword-capture
npm install --save-exact @azure/storage-blob@12.33.0 @azure/identity@4.13.3
npm install --save-dev --save-exact azurite@3.37.0
```

- [ ] **Step 2: Write the failing tests**

`tests/helpers/azurite.ts`:

```ts
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';

export const AZURITE_ACCOUNT_KEY = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
  });
}

/** Starts an in-memory Azurite blob service on a random port for one test file. */
export async function startAzurite(): Promise<{ connectionString: string; stop(): Promise<void> }> {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn('node_modules/.bin/azurite-blob', [
    '--blobHost', '127.0.0.1', '--blobPort', String(port),
    '--inMemoryPersistence', '--silent', '--skipApiVersionCheck', '--loose',
  ], { stdio: 'ignore' });
  const deadline = Date.now() + 20_000;
  while (!(await portOpen(port))) {
    if (Date.now() > deadline) { proc.kill(); throw new Error(`Azurite did not open port ${port}`); }
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    connectionString: `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=${AZURITE_ACCOUNT_KEY};BlobEndpoint=http://127.0.0.1:${port}/devstoreaccount1;`,
    stop: async () => { proc.kill(); },
  };
}
```

`tests/redact.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/storage/redact.js';

describe('redactSecrets', () => {
  it('removes SAS signatures and account keys but keeps the rest readable', () => {
    const sas = 'https://fbrdevstorage.blob.core.windows.net/maps-keyword-capture?sv=2025-01-05&si=maps-capture-writer&sr=c&sig=AbC%2Fd1%2B2%3D&spr=https';
    expect(redactSecrets(`upload to ${sas} failed`)).toBe('upload to https://fbrdevstorage.blob.core.windows.net/maps-keyword-capture?sv=2025-01-05&si=maps-capture-writer&sr=c&sig=REDACTED&spr=https failed');
    expect(redactSecrets('DefaultEndpointsProtocol=https;AccountName=a;AccountKey=abc+/==;EndpointSuffix=core.windows.net'))
      .toBe('DefaultEndpointsProtocol=https;AccountName=a;AccountKey=REDACTED;EndpointSuffix=core.windows.net');
    expect(redactSecrets('nothing secret here')).toBe('nothing secret here');
  });
});
```

`tests/azure-gateway.test.ts`:

```ts
import { ContainerSASPermissions, BlobServiceClient } from '@azure/storage-blob';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config.js';
import { AzureBlobGateway, containerClientFromEnv, DEFAULT_CONTAINER } from '../src/storage/azure-gateway.js';
import { contentTypeFor } from '../src/storage/blob-gateway.js';
import { startAzurite } from './helpers/azurite.js';

let azurite: Awaited<ReturnType<typeof startAzurite>>;
beforeAll(async () => {
  azurite = await startAzurite();
  await BlobServiceClient.fromConnectionString(azurite.connectionString).getContainerClient(DEFAULT_CONTAINER).createIfNotExists();
});
afterAll(async () => { await azurite.stop(); });

describe('contentTypeFor', () => {
  it('maps artifact extensions', () => {
    expect(contentTypeFor('a/b.png')).toBe('image/png');
    expect(contentTypeFor('a/b.json')).toBe('application/json');
    expect(contentTypeFor('a/b.csv')).toBe('text/csv; charset=utf-8');
    expect(contentTypeFor('a/observations.jsonl')).toBe('application/x-ndjson');
    expect(contentTypeFor('a/b.bin')).toBe('application/octet-stream');
  });
});

describe('containerClientFromEnv', () => {
  it('prefers a container SAS URL, then a connection string, then an account URL', () => {
    const sas = containerClientFromEnv({ AZURE_STORAGE_CONTAINER_SAS_URL: 'https://acct.blob.core.windows.net/maps-keyword-capture?sv=1&sig=x' });
    expect(sas.containerName).toBe('maps-keyword-capture');
    const conn = containerClientFromEnv({ AZURE_STORAGE_CONNECTION_STRING: azurite.connectionString });
    expect(conn.containerName).toBe(DEFAULT_CONTAINER);
    const named = containerClientFromEnv({ AZURE_STORAGE_ACCOUNT_URL: 'https://acct.blob.core.windows.net', AZURE_STORAGE_CONTAINER: 'other' });
    expect(named.containerName).toBe('other');
    expect(named.url).toBe('https://acct.blob.core.windows.net/other');
  });

  it('rejects missing storage settings with a configuration error', () => {
    expect(() => containerClientFromEnv({})).toThrow(ConfigError);
  });
});

describe('AzureBlobGateway against Azurite', () => {
  const gateway = () => new AzureBlobGateway(containerClientFromEnv({ AZURE_STORAGE_CONNECTION_STRING: azurite.connectionString }));

  it('creates once, reports an existing object, and reads it back', async () => {
    const g = gateway();
    expect(g.description).toMatch(/\/maps-keyword-capture$/);
    expect(await g.createIfAbsent('2026-09-17/run/att/a.json', Buffer.from('{"a":1}'), 'application/json')).toBe('created');
    expect(await g.createIfAbsent('2026-09-17/run/att/a.json', Buffer.from('{"a":2}'), 'application/json')).toBe('exists');
    expect((await g.get('2026-09-17/run/att/a.json')).toString()).toBe('{"a":1}');
  });

  it('put replaces an existing object', async () => {
    const g = gateway();
    await g.put('2026-09-17/run/att/manifest.progress.json', Buffer.from('v1'), 'application/json');
    await g.put('2026-09-17/run/att/manifest.progress.json', Buffer.from('v2'), 'application/json');
    expect((await g.get('2026-09-17/run/att/manifest.progress.json')).toString()).toBe('v2');
  });

  it('works through a container SAS URL', async () => {
    const container = BlobServiceClient.fromConnectionString(azurite.connectionString).getContainerClient(DEFAULT_CONTAINER);
    const sasUrl = await container.generateSasUrl({ permissions: ContainerSASPermissions.parse('rcw'), expiresOn: new Date(Date.now() + 3_600_000) });
    const g = new AzureBlobGateway(containerClientFromEnv({ AZURE_STORAGE_CONTAINER_SAS_URL: sasUrl }));
    expect(g.description).not.toContain('sig=');
    expect(await g.createIfAbsent('2026-09-17/run/att/sas.txt', Buffer.from('ok'), 'text/plain')).toBe('created');
    expect((await g.get('2026-09-17/run/att/sas.txt')).toString()).toBe('ok');
  });

  it('never leaks the SAS signature in errors', async () => {
    const container = BlobServiceClient.fromConnectionString(azurite.connectionString).getContainerClient(DEFAULT_CONTAINER);
    const readOnly = await container.generateSasUrl({ permissions: ContainerSASPermissions.parse('r'), expiresOn: new Date(Date.now() + 3_600_000) });
    const g = new AzureBlobGateway(containerClientFromEnv({ AZURE_STORAGE_CONTAINER_SAS_URL: readOnly }));
    const err = await g.createIfAbsent('2026-09-17/run/att/denied.txt', Buffer.from('x'), 'text/plain').catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    const sig = new URL(readOnly).searchParams.get('sig')!;
    expect((err as Error).message).not.toContain(sig);
    expect((err as Error).message).not.toContain(encodeURIComponent(sig));
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/redact.test.ts tests/azure-gateway.test.ts`
Expected: FAIL, cannot find modules under `src/storage/`.

- [ ] **Step 4: Implement**

`src/storage/redact.ts`:

```ts
/** Remove the secret parts of SAS URLs and connection strings from text bound for logs or manifests. */
export function redactSecrets(text: string): string {
  return text
    .replace(/([?&]sig=)[^&\s"'<>]*/gi, '$1REDACTED')
    .replace(/(AccountKey=)[^;\s"'<>]*/gi, '$1REDACTED');
}
```

`src/storage/blob-gateway.ts`:

```ts
/** The three blob operations the collector needs; one implementation per provider. */
export interface BlobGateway {
  /** Container URL without any query string, safe to log. */
  readonly description: string;
  /** Upload only if no object exists at the key. */
  createIfAbsent(key: string, data: Buffer, contentType: string): Promise<'created' | 'exists'>;
  /** Upload, replacing any existing object. */
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Download the full object. */
  get(key: string): Promise<Buffer>;
}

export function contentTypeFor(key: string): string {
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.jsonl')) return 'application/x-ndjson';
  if (key.endsWith('.json')) return 'application/json';
  if (key.endsWith('.csv')) return 'text/csv; charset=utf-8';
  return 'application/octet-stream';
}
```

`src/storage/azure-gateway.ts`:

```ts
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient, ContainerClient, RestError } from '@azure/storage-blob';
import { ConfigError } from '../config.js';
import type { BlobGateway } from './blob-gateway.js';
import { redactSecrets } from './redact.js';

export const DEFAULT_CONTAINER = 'maps-keyword-capture';

/**
 * Pod: AZURE_STORAGE_CONTAINER_SAS_URL (container-scoped SAS from a Secret).
 * Tests: AZURE_STORAGE_CONNECTION_STRING (Azurite).
 * Local: AZURE_STORAGE_ACCOUNT_URL with `az login`, through DefaultAzureCredential.
 * AZURE_STORAGE_CONTAINER overrides the container for the last two.
 */
export function containerClientFromEnv(env: NodeJS.ProcessEnv): ContainerClient {
  const sasUrl = env['AZURE_STORAGE_CONTAINER_SAS_URL'];
  if (sasUrl) return new ContainerClient(sasUrl);
  const container = env['AZURE_STORAGE_CONTAINER'] || DEFAULT_CONTAINER;
  const connectionString = env['AZURE_STORAGE_CONNECTION_STRING'];
  if (connectionString) return BlobServiceClient.fromConnectionString(connectionString).getContainerClient(container);
  const accountUrl = env['AZURE_STORAGE_ACCOUNT_URL'];
  if (accountUrl) return new BlobServiceClient(accountUrl, new DefaultAzureCredential()).getContainerClient(container);
  throw new ConfigError('--storage azure needs AZURE_STORAGE_CONTAINER_SAS_URL, AZURE_STORAGE_CONNECTION_STRING, or AZURE_STORAGE_ACCOUNT_URL (with az login)');
}

function describeError(err: unknown, action: string, key: string): Error {
  const status = err instanceof RestError && err.statusCode !== undefined ? ` (HTTP ${err.statusCode}${err.code ? ` ${err.code}` : ''})` : '';
  const message = err instanceof Error ? err.message : String(err);
  return new Error(redactSecrets(`${action} ${key} failed${status}: ${message}`));
}

export class AzureBlobGateway implements BlobGateway {
  readonly description: string;
  private readonly container: ContainerClient;

  constructor(container: ContainerClient) {
    this.container = container;
    this.description = container.url.split('?')[0] ?? container.url;
  }

  async createIfAbsent(key: string, data: Buffer, contentType: string): Promise<'created' | 'exists'> {
    try {
      await this.container.getBlockBlobClient(key).upload(data, data.byteLength, {
        conditions: { ifNoneMatch: '*' },
        blobHTTPHeaders: { blobContentType: contentType },
      });
      return 'created';
    } catch (err) {
      if (err instanceof RestError && (err.statusCode === 409 || err.statusCode === 412)) return 'exists';
      throw describeError(err, 'create', key);
    }
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    try {
      await this.container.getBlockBlobClient(key).upload(data, data.byteLength, { blobHTTPHeaders: { blobContentType: contentType } });
    } catch (err) {
      throw describeError(err, 'put', key);
    }
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await this.container.getBlockBlobClient(key).downloadToBuffer();
    } catch (err) {
      throw describeError(err, 'get', key);
    }
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/redact.test.ts tests/azure-gateway.test.ts && npm run typecheck`
Expected: 8 passed. If the SAS-denied test reports that Azurite accepted a write with an `r`-only SAS, Azurite is not enforcing SAS permissions in `--loose` mode: remove `--loose` from the helper and rerun; do not weaken the assertion. If `containerName` is undefined for the SAS URL client, derive it from `new URL(url).pathname.split('/')[1]` in the assertion instead and note it in the report.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/storage/redact.ts src/storage/blob-gateway.ts src/storage/azure-gateway.ts tests/helpers/azurite.ts tests/redact.test.ts tests/azure-gateway.test.ts
git commit -m "feat: add Azure Blob gateway with SAS, connection-string, and az login auth"
```

---

### Task 2: Remote artifact store with read-back verification

**Files:**
- Modify: `src/storage/types.ts`, `src/storage/local.ts`, `tests/query-runner.test.ts` (test helper `RefusingStore` only)
- Create: `src/storage/remote.ts`, `tests/helpers/fake-gateway.ts`, `tests/remote-store.test.ts`

**Interfaces:**
- Consumes: `BlobGateway`, `contentTypeFor` (Task 1); `redactSecrets` (Task 1); `LocalArtifactStore` (existing); `sha256Hex` from `src/ids.ts`.
- Produces:
  - `interface PersistOptions { mutable?: boolean }` in `src/storage/types.ts`
  - `ArtifactStore` now: `mode`, `rootDirectory`, `absolutePath(relativePath: string): string`, `writeFile(relativePath, data): Promise<WrittenFile>`, `persist(file: WrittenFile, options?: PersistOptions): Promise<StorageState>`
  - `PNG_SIGNATURE: Buffer`
  - `objectKeyFor(relativePath: string): string` (strips a leading `maps-keyword-capture/`)
  - `class RemoteArtifactStore implements ArtifactStore { constructor(opts: { gateway: BlobGateway; local: LocalArtifactStore }) }` with `readonly mode = 'azure_blob'` and `readonly gateway: BlobGateway`
  - `class FakeGateway implements BlobGateway` (tests): `objects: Map<string, Buffer>`, `failOn?: (op: 'create' | 'put' | 'get', key: string) => boolean`, `corruptGet?: (key: string) => boolean`, `calls: string[]`

Failure codes returned in `storageError.code`: `local_changed` (local file no longer matches the `WrittenFile`), `upload_failed` (gateway threw on create/put/get), `object_conflict` (object existed with different bytes), `readback_mismatch` (created object read back with different bytes), `readback_not_png`.

- [ ] **Step 1: Write the failing tests**

`tests/helpers/fake-gateway.ts`:

```ts
import type { BlobGateway } from '../../src/storage/blob-gateway.js';

export class FakeGateway implements BlobGateway {
  readonly description = 'fake://maps-keyword-capture';
  readonly objects = new Map<string, Buffer>();
  readonly calls: string[] = [];
  failOn: (op: 'create' | 'put' | 'get', key: string) => boolean = () => false;
  corruptGet: (key: string) => boolean = () => false;

  async createIfAbsent(key: string, data: Buffer): Promise<'created' | 'exists'> {
    this.calls.push(`create ${key}`);
    if (this.failOn('create', key)) throw new Error(`create ${key} failed: https://x.blob.core.windows.net/c?sv=1&sig=SECRET`);
    if (this.objects.has(key)) return 'exists';
    this.objects.set(key, Buffer.from(data));
    return 'created';
  }

  async put(key: string, data: Buffer): Promise<void> {
    this.calls.push(`put ${key}`);
    if (this.failOn('put', key)) throw new Error(`put ${key} failed`);
    this.objects.set(key, Buffer.from(data));
  }

  async get(key: string): Promise<Buffer> {
    this.calls.push(`get ${key}`);
    if (this.failOn('get', key)) throw new Error(`get ${key} failed`);
    const data = this.objects.get(key);
    if (!data) throw new Error(`get ${key} failed: not found`);
    return this.corruptGet(key) ? Buffer.concat([data, Buffer.from('x')]) : Buffer.from(data);
  }
}
```

`tests/remote-store.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalArtifactStore } from '../src/storage/local.js';
import { objectKeyFor, PNG_SIGNATURE, RemoteArtifactStore } from '../src/storage/remote.js';
import { FakeGateway } from './helpers/fake-gateway.js';

let root: string;
let gateway: FakeGateway;
let store: RemoteArtifactStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mkc-remote-'));
  gateway = new FakeGateway();
  store = new RemoteArtifactStore({ gateway, local: new LocalArtifactStore(root) });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const rel = 'maps-keyword-capture/2026-09-17/run_1/att_1/q0001/qa01/r.json';
const png = Buffer.concat([PNG_SIGNATURE, Buffer.from('image-bytes')]);

describe('objectKeyFor', () => {
  it('drops the product folder because the container already names it', () => {
    expect(objectKeyFor(rel)).toBe('2026-09-17/run_1/att_1/q0001/qa01/r.json');
    expect(objectKeyFor('other/x.json')).toBe('other/x.json');
  });
});

describe('RemoteArtifactStore', () => {
  it('stages locally, uploads once, reads back, and reports verified', async () => {
    const written = await store.writeFile(rel, '{"ok":true}');
    const state = await store.persist(written);
    expect(state).toMatchObject({ storageStatus: 'verified', objectKey: '2026-09-17/run_1/att_1/q0001/qa01/r.json', storageError: null });
    expect(Date.parse((state as { verifiedAt: string }).verifiedAt)).not.toBeNaN();
    expect(gateway.objects.get('2026-09-17/run_1/att_1/q0001/qa01/r.json')!.toString()).toBe('{"ok":true}');
    expect(gateway.calls).toEqual(['create 2026-09-17/run_1/att_1/q0001/qa01/r.json', 'get 2026-09-17/run_1/att_1/q0001/qa01/r.json']);
    expect(store.mode).toBe('azure_blob');
    expect(store.absolutePath(rel)).toBe(join(root, ...rel.split('/')));
  });

  it('treats an existing identical object as verified and a different one as a conflict', async () => {
    const written = await store.writeFile(rel, 'same');
    gateway.objects.set(objectKeyFor(rel), Buffer.from('same'));
    expect((await store.persist(written)).storageStatus).toBe('verified');
    gateway.objects.set(objectKeyFor(rel), Buffer.from('different'));
    expect(await store.persist(written)).toMatchObject({ storageStatus: 'failed', storageError: { code: 'object_conflict' } });
    expect(gateway.objects.get(objectKeyFor(rel))!.toString()).toBe('different');
  });

  it('fails on a read-back mismatch and on a PNG without its signature', async () => {
    const written = await store.writeFile(rel, 'payload');
    gateway.corruptGet = () => true;
    expect(await store.persist(written)).toMatchObject({ storageStatus: 'failed', storageError: { code: 'readback_mismatch' } });

    gateway.corruptGet = () => false;
    const notPng = await store.writeFile('maps-keyword-capture/2026-09-17/run_1/att_1/q0001/qa01/shot__01.png', 'not a png');
    expect(await store.persist(notPng)).toMatchObject({ storageStatus: 'failed', storageError: { code: 'readback_not_png' } });
    const realPng = await store.writeFile('maps-keyword-capture/2026-09-17/run_1/att_1/q0001/qa01/shot__02.png', png);
    expect((await store.persist(realPng)).storageStatus).toBe('verified');
  });

  it('returns a failed state with a redacted message instead of throwing', async () => {
    const written = await store.writeFile(rel, 'payload');
    gateway.failOn = (op) => op === 'create';
    const state = await store.persist(written);
    expect(state).toMatchObject({ storageStatus: 'failed', objectKey: objectKeyFor(rel), verifiedAt: null, storageError: { code: 'upload_failed' } });
    expect(JSON.stringify(state)).not.toContain('SECRET');
    expect(JSON.stringify(state)).toContain('sig=REDACTED');
  });

  it('refuses to upload a local file that no longer matches what was written', async () => {
    const written = await store.writeFile(rel, 'original');
    await writeFile(store.absolutePath(rel), 'tampered');
    expect(await store.persist(written)).toMatchObject({ storageStatus: 'failed', storageError: { code: 'local_changed' } });
    expect(gateway.calls).toEqual([]);
  });

  it('overwrites only when asked, for the progress manifest', async () => {
    const progress = 'maps-keyword-capture/2026-09-17/run_1/att_1/manifest.progress.json';
    const v1 = await store.writeFile(progress, 'v1');
    expect((await store.persist(v1, { mutable: true })).storageStatus).toBe('verified');
    const v2 = await store.writeFile(progress, 'v2');
    expect((await store.persist(v2, { mutable: true })).storageStatus).toBe('verified');
    expect(gateway.objects.get(objectKeyFor(progress))!.toString()).toBe('v2');
    expect(gateway.calls.filter((c) => c.startsWith('put'))).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/remote-store.test.ts`
Expected: FAIL, cannot find module `../src/storage/remote.js`.

- [ ] **Step 3: Implement**

Replace `src/storage/types.ts` with:

```ts
import type { StorageState } from '../contracts.js';

export interface WrittenFile { relativePath: string; bytes: number; sha256: string }

export interface PersistOptions {
  /** Replace an existing object. Only the progress manifest is mutable; everything else is created once. */
  mutable?: boolean;
}

export interface ArtifactStore {
  readonly mode: 'local_only' | 'azure_blob';
  readonly rootDirectory: string;
  absolutePath(relativePath: string): string;
  /** Atomic local write (temp file + rename). relativePath uses forward slashes. */
  writeFile(relativePath: string, data: Buffer | string): Promise<WrittenFile>;
  /** Deliver a written file. Never throws: failures come back as a `failed` state. */
  persist(file: WrittenFile, options?: PersistOptions): Promise<StorageState>;
}
```

In `tests/query-runner.test.ts`, the helper class `RefusingStore implements ArtifactStore` must satisfy the new interface; add this method inside the class, after `writeFile`:

```ts
  absolutePath(relativePath: string): string { return this.inner.absolutePath(relativePath); }
```

In `src/storage/local.ts`, change the import to `import type { ArtifactStore, PersistOptions, WrittenFile } from './types.js';` and the persist signature to:

```ts
  async persist(_file: WrittenFile, _options?: PersistOptions): Promise<StorageState> {
```

`src/storage/remote.ts`:

```ts
import { readFile } from 'node:fs/promises';
import type { StorageState } from '../contracts.js';
import { sha256Hex } from '../ids.js';
import type { BlobGateway } from './blob-gateway.js';
import { contentTypeFor } from './blob-gateway.js';
import type { LocalArtifactStore } from './local.js';
import { redactSecrets } from './redact.js';
import type { ArtifactStore, PersistOptions, WrittenFile } from './types.js';

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PRODUCT_FOLDER = 'maps-keyword-capture/';

export function objectKeyFor(relativePath: string): string {
  return relativePath.startsWith(PRODUCT_FOLDER) ? relativePath.slice(PRODUCT_FOLDER.length) : relativePath;
}

function failed(objectKey: string, code: string, message: string): StorageState {
  return { storageStatus: 'failed', objectKey, verifiedAt: null, storageError: { code, message: redactSecrets(message) } };
}

/**
 * Local staging plus remote delivery. A file is verified only when the object read back from the
 * container has the same size and SHA-256 as the local file (and a PNG signature for .png).
 */
export class RemoteArtifactStore implements ArtifactStore {
  readonly mode = 'azure_blob' as const;
  readonly gateway: BlobGateway;
  private readonly local: LocalArtifactStore;

  constructor(opts: { gateway: BlobGateway; local: LocalArtifactStore }) {
    this.gateway = opts.gateway;
    this.local = opts.local;
  }

  get rootDirectory(): string { return this.local.rootDirectory; }

  absolutePath(relativePath: string): string { return this.local.absolutePath(relativePath); }

  writeFile(relativePath: string, data: Buffer | string): Promise<WrittenFile> { return this.local.writeFile(relativePath, data); }

  async persist(file: WrittenFile, options: PersistOptions = {}): Promise<StorageState> {
    const objectKey = objectKeyFor(file.relativePath);
    const contentType = contentTypeFor(objectKey);
    try {
      const data = await readFile(this.local.absolutePath(file.relativePath));
      if (data.byteLength !== file.bytes || sha256Hex(data) !== file.sha256) {
        return failed(objectKey, 'local_changed', `local file ${file.relativePath} no longer matches its recorded size and SHA-256`);
      }
      let existed = false;
      if (options.mutable) {
        await this.gateway.put(objectKey, data, contentType);
      } else {
        existed = (await this.gateway.createIfAbsent(objectKey, data, contentType)) === 'exists';
      }
      const remote = await this.gateway.get(objectKey);
      if (remote.byteLength !== file.bytes || sha256Hex(remote) !== file.sha256) {
        return existed
          ? failed(objectKey, 'object_conflict', `an object with different content already exists at ${objectKey}`)
          : failed(objectKey, 'readback_mismatch', `read-back of ${objectKey} did not match the uploaded bytes`);
      }
      if (objectKey.endsWith('.png') && !remote.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        return failed(objectKey, 'readback_not_png', `read-back of ${objectKey} is not a PNG`);
      }
      return { storageStatus: 'verified', objectKey, verifiedAt: new Date().toISOString(), storageError: null };
    } catch (err) {
      return failed(objectKey, 'upload_failed', err instanceof Error ? err.message : String(err));
    }
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/remote-store.test.ts tests/local-store.test.ts && npm run typecheck && npm test`
Expected: remote-store 7 passed; the whole suite green (existing callers of `persist(file)` still compile because `options` is optional).

- [ ] **Step 5: Commit**

```bash
git add src/storage/types.ts src/storage/local.ts src/storage/remote.ts tests/helpers/fake-gateway.ts tests/remote-store.test.ts tests/query-runner.test.ts
git commit -m "feat: add remote artifact store with read-back verification"
```

---

### Task 3: Manifest persistence status, batch artifacts, and delivery-aware exit codes

**Files:**
- Modify: `src/runner/manifest.ts`, `tests/manifest.test.ts`

**Interfaces:**
- Consumes: `Artifact`, `BatchManifest`, `ManifestDeliveryReceipt`, `PersistenceStatus` from `src/contracts.ts`.
- Produces:
  - `persistenceStatusFor(mode: BatchManifest['persistenceMode'], artifacts: Artifact[]): PersistenceStatus` — `local_only` → `not_requested`; any `failed` → `failed`; non-empty and all `verified` → `verified`; otherwise `pending`.
  - `recordQueryAttempt` (existing signature) now sets the row's `persistenceStatus` from `persistenceStatusFor(m.persistenceMode, <all manifest artifacts with this queryId after appending>)`.
  - `recordBatchArtifact(m: BatchManifest, artifact: Artifact): BatchManifest` — appends an artifact with `queryId: null` (for `request.json`); rows untouched.
  - `exitCodeFor(m: BatchManifest, receipt?: ManifestDeliveryReceipt | null): 0 | 1 | 2` — in `azure_blob` mode returns `1` when any row is `failed` persistence, any artifact with `queryId === null` is not `verified`, or the receipt is missing or not `verified`; otherwise the existing status rules.
  - `deliveryStatus(m: BatchManifest, receipt: ManifestDeliveryReceipt | null): 'not_requested' | 'verified' | 'failed'` — `not_requested` in local mode; `verified` only when `exitCodeFor` would not return 1 for delivery reasons.

- [ ] **Step 1: Write the failing tests**

Update the import line of `tests/manifest.test.ts` to:

```ts
import type { Artifact, ManifestDeliveryReceipt, QueryAttemptSummary, RunMetadata, StorageState } from '../src/contracts.js';
import { createManifest, deliveryStatus, exitCodeFor, finalizeManifest, markRunning, markSkipped, persistenceStatusFor, recordBatchArtifact, recordQueryAttempt, selectAttempt } from '../src/runner/manifest.js';
```

Append to `tests/manifest.test.ts`:

```ts
function stateFor(status: 'verified' | 'failed' | 'uploaded'): StorageState {
  if (status === 'verified') return { storageStatus: 'verified', objectKey: 'k', verifiedAt: '2026-09-17T00:00:00.000Z', storageError: null };
  if (status === 'uploaded') return { storageStatus: 'uploaded', objectKey: 'k', verifiedAt: null, storageError: null };
  return { storageStatus: 'failed', objectKey: 'k', verifiedAt: null, storageError: { code: 'upload_failed', message: 'x' } };
}
function remoteArtifact(id: string, status: 'verified' | 'failed' | 'uploaded', queryId: string | null = 'q0001'): Artifact {
  return { ...stateFor(status), id, filename: `${id}.json`, kind: queryId ? 'result_json' : 'request_json', bytes: 1, sha256: 'h', queryId, queryAttemptId: queryId ? 'qa01' : null };
}
function receipt(status: 'verified' | 'failed'): ManifestDeliveryReceipt {
  return { ...stateFor(status), runId: 'run_1', attemptId: 'att_1', filename: 'manifest.json', bytes: 10, sha256: 'm' };
}
const remoteBase = () => createManifest({ runId: 'run_1', attemptId: 'att_1', startedAt: 't0', metadata, persistenceMode: 'azure_blob', keywords: ['a', 'b'] });
function captured(id: string, queryId: string): QueryAttemptSummary {
  return { queryAttemptId: id, startedAt: 't0', finishedAt: 't1', resultFile: `${queryId}/${id}/r.json`, artifactIds: [`${queryId}-${id}`], status: 'captured', stopReason: 'limit_reached', error: null };
}

describe('remote persistence bookkeeping', () => {
  it('derives persistence status from artifacts', () => {
    expect(persistenceStatusFor('local_only', [remoteArtifact('a', 'failed')])).toBe('not_requested');
    expect(persistenceStatusFor('azure_blob', [])).toBe('pending');
    expect(persistenceStatusFor('azure_blob', [remoteArtifact('a', 'verified'), remoteArtifact('b', 'uploaded')])).toBe('pending');
    expect(persistenceStatusFor('azure_blob', [remoteArtifact('a', 'verified'), remoteArtifact('b', 'verified')])).toBe('verified');
    expect(persistenceStatusFor('azure_blob', [remoteArtifact('a', 'verified'), remoteArtifact('b', 'failed')])).toBe('failed');
  });

  it('starts remote rows pending and sets each row from its own artifacts across attempts', () => {
    let m = remoteBase();
    expect(m.queries.map((q) => q.persistenceStatus)).toEqual(['pending', 'pending']);
    m = recordQueryAttempt(m, 'q0001', captured('qa01', 'q0001'), [remoteArtifact('a1', 'verified'), remoteArtifact('a2', 'verified')]);
    m = recordQueryAttempt(m, 'q0002', captured('qa01', 'q0002'), [remoteArtifact('b1', 'verified', 'q0002')]);
    expect(m.queries.map((q) => q.persistenceStatus)).toEqual(['verified', 'verified']);
    m = recordQueryAttempt(m, 'q0001', captured('qa02', 'q0001'), [remoteArtifact('a3', 'failed')]);
    expect(m.queries.map((q) => q.persistenceStatus)).toEqual(['failed', 'verified']);
  });

  it('records batch-level artifacts without changing rows', () => {
    const m = recordBatchArtifact(remoteBase(), remoteArtifact('request_json', 'verified', null));
    expect(m.artifacts.map((a) => [a.id, a.queryId])).toEqual([['request_json', null]]);
    expect(m.queries.map((q) => q.persistenceStatus)).toEqual(['pending', 'pending']);
  });

  it('requires verified rows, batch artifacts, and a verified receipt for a clean remote exit', () => {
    const complete = () => {
      let m = recordBatchArtifact(remoteBase(), remoteArtifact('request_json', 'verified', null));
      m = recordQueryAttempt(m, 'q0001', captured('qa01', 'q0001'), [remoteArtifact('a1', 'verified')]);
      m = recordQueryAttempt(m, 'q0002', captured('qa01', 'q0002'), [remoteArtifact('b1', 'verified', 'q0002')]);
      return finalizeManifest(m, 't9');
    };
    expect(exitCodeFor(complete(), receipt('verified'))).toBe(0);
    expect(deliveryStatus(complete(), receipt('verified'))).toBe('verified');
    expect(exitCodeFor(complete(), null)).toBe(1);
    expect(exitCodeFor(complete())).toBe(1);
    expect(exitCodeFor(complete(), receipt('failed'))).toBe(1);
    expect(deliveryStatus(complete(), receipt('failed'))).toBe('failed');

    let rowFailed = recordQueryAttempt(complete(), 'q0002', captured('qa02', 'q0002'), [remoteArtifact('b2', 'failed', 'q0002')]);
    rowFailed = finalizeManifest(rowFailed, 't9');
    expect(exitCodeFor(rowFailed, receipt('verified'))).toBe(1);

    const requestFailed = finalizeManifest(recordQueryAttempt(recordQueryAttempt(recordBatchArtifact(remoteBase(), remoteArtifact('request_json', 'failed', null)), 'q0001', captured('qa01', 'q0001'), [remoteArtifact('a1', 'verified')]), 'q0002', captured('qa01', 'q0002'), [remoteArtifact('b1', 'verified', 'q0002')]), 't9');
    expect(exitCodeFor(requestFailed, receipt('verified'))).toBe(1);

    const local = finalizeManifest(recordQueryAttempt(recordQueryAttempt(base(), 'q0001', summary('qa01', 'captured', 'limit_reached'), []), 'q0002', summary('qa01', 'captured', 'limit_reached'), []), 't9');
    const localAll = recordQueryAttempt(local, 'q0003', summary('qa01', 'captured', 'limit_reached'), []);
    expect(exitCodeFor(finalizeManifest(localAll, 't9'), null)).toBe(0);
    expect(deliveryStatus(finalizeManifest(localAll, 't9'), null)).toBe('not_requested');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/manifest.test.ts`
Expected: FAIL — `persistenceStatusFor`, `recordBatchArtifact`, and `deliveryStatus` are not exported.

- [ ] **Step 3: Implement**

In `src/runner/manifest.ts`, change the contracts import to:

```ts
import type { Artifact, BatchManifest, ManifestDeliveryReceipt, PersistenceStatus, QueryAttemptSummary, QueryManifestEntry, RunMetadata, SkipReason } from '../contracts.js';
```

Add after `selectAttempt`:

```ts
export function persistenceStatusFor(mode: BatchManifest['persistenceMode'], artifacts: Artifact[]): PersistenceStatus {
  if (mode === 'local_only') return 'not_requested';
  if (artifacts.some((a) => a.storageStatus === 'failed')) return 'failed';
  if (artifacts.length > 0 && artifacts.every((a) => a.storageStatus === 'verified')) return 'verified';
  return 'pending';
}

/** Artifacts that belong to the batch rather than a query, such as request.json. */
export function recordBatchArtifact(m: BatchManifest, artifact: Artifact): BatchManifest {
  return { ...m, artifacts: [...m.artifacts, artifact] };
}
```

In `recordQueryAttempt`, replace the first two statements:

```ts
  const persistenceStatus: PersistenceStatus = m.persistenceMode === 'local_only' ? 'not_requested' : 'pending';
  const withArtifacts: BatchManifest = { ...m, artifacts: [...m.artifacts, ...artifacts] };
```

with:

```ts
  const withArtifacts: BatchManifest = { ...m, artifacts: [...m.artifacts, ...artifacts] };
  const persistenceStatus = persistenceStatusFor(m.persistenceMode, withArtifacts.artifacts.filter((a) => a.queryId === queryId));
```

Replace `exitCodeFor` with:

```ts
function remoteDeliveryFailed(m: BatchManifest, receipt: ManifestDeliveryReceipt | null): boolean {
  if (m.persistenceMode === 'local_only') return false;
  if (m.queries.some((q) => q.persistenceStatus === 'failed')) return true;
  if (m.artifacts.some((a) => a.queryId === null && a.storageStatus !== 'verified')) return true;
  return receipt === null || receipt.storageStatus !== 'verified';
}

export function exitCodeFor(m: BatchManifest, receipt: ManifestDeliveryReceipt | null = null): 0 | 1 | 2 {
  if (remoteDeliveryFailed(m, receipt)) return 1;
  if (m.status === 'completed') return 0;
  if (m.status === 'failed') return 1;
  return 2;
}

export function deliveryStatus(m: BatchManifest, receipt: ManifestDeliveryReceipt | null): 'not_requested' | 'verified' | 'failed' {
  if (m.persistenceMode === 'local_only') return 'not_requested';
  return remoteDeliveryFailed(m, receipt) ? 'failed' : 'verified';
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/manifest.test.ts && npm run typecheck && npm test`
Expected: manifest tests 9 passed; the whole suite green (existing local-mode callers pass no receipt and are unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/runner/manifest.ts tests/manifest.test.ts
git commit -m "feat: track remote persistence per row and fail the exit code on undelivered artifacts"
```

---

### Task 4: Wire storage through the batch runner and CLI

**Files:**
- Modify: `src/runner/batch-runner.ts` (full replacement below), `src/cli.ts`
- Create: `src/storage/factory.ts`, `tests/storage-factory.test.ts`, `tests/batch-remote.test.ts`

**Interfaces:**
- Consumes: `ArtifactStore`, `LocalArtifactStore`, `RemoteArtifactStore`, `AzureBlobGateway`, `containerClientFromEnv` (Tasks 1-2); `recordBatchArtifact`, `exitCodeFor`, `deliveryStatus` (Task 3); `FakeGateway`, `startAzurite` (test helpers); fixture `writeFixture`, `namedCards` (use `endMarkerInitially: true` for lists of 4 or fewer cards: they cannot scroll, so the scroll-triggered end marker would never appear).
- Produces:
  - `BatchDeps.store?: ArtifactStore` (default `new LocalArtifactStore(config.outputDirectory)`)
  - `BatchOutput.manifestReceipt: ManifestDeliveryReceipt | null`
  - `closeWithin(browser: Pick<Browser, 'close'>, timeoutMs: number): Promise<'closed' | 'timed_out'>`
  - constants `UNSUPPORTED_LAYOUT_STREAK = 3`, `BROWSER_CLOSE_TIMEOUT_MS = 10_000`
  - `parseStorageFlag(value: string | null): 'local' | 'azure'` (throws `ConfigError`)
  - `createStore(mode: 'local' | 'azure', outputDirectory: string, env: NodeJS.ProcessEnv): { store: ArtifactStore; description: string | null }`

Batch behavior added, in order: create the manifest with `persistenceMode: store.mode`; write and persist `request.json` and record it with `recordBatchArtifact` (artifact id `request_json`, kind `request_json`, `queryId: null`); write and persist (`mutable: true`) `manifest.progress.json`; if `request.json` failed to persist, mark every row `skipped / storage_unavailable`, do not launch the browser, and publish; otherwise run keywords as today with two new batch stops set after each recorded attempt — `unsupported_layout` after `UNSUPPORTED_LAYOUT_STREAK` consecutive attempts ending with `stopReason: 'unsupported_layout'`, and `storage_unavailable` in remote mode when an attempt produced artifacts and none of them is `verified`; at the end, close the browser with `closeWithin(..., BROWSER_CLOSE_TIMEOUT_MS)`, finalize, write `manifest.json`, persist it (remote mode) into a `ManifestDeliveryReceipt`, and return `exitCodeFor(manifest, receipt)`. Publication runs on every path, including a rethrown error.

- [ ] **Step 1: Write the failing tests**

`tests/storage-factory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config.js';
import { createStore, parseStorageFlag } from '../src/storage/factory.js';

describe('storage selection', () => {
  it('parses the --storage flag', () => {
    expect(parseStorageFlag(null)).toBe('local');
    expect(parseStorageFlag('local')).toBe('local');
    expect(parseStorageFlag('azure')).toBe('azure');
    expect(() => parseStorageFlag('s3')).toThrow(ConfigError);
  });

  it('builds a local store without credentials and a remote store only with them', () => {
    const local = createStore('local', './outputs', {});
    expect(local.store.mode).toBe('local_only');
    expect(local.description).toBeNull();
    expect(() => createStore('azure', './outputs', {})).toThrow(ConfigError);
    const remote = createStore('azure', './outputs', { AZURE_STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=a2V5;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;' });
    expect(remote.store.mode).toBe('azure_blob');
    expect(remote.description).toBe('http://127.0.0.1:10000/devstoreaccount1/maps-keyword-capture');
  });
});
```

`tests/batch-remote.test.ts`:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlobServiceClient } from '@azure/storage-blob';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import type { BatchManifest } from '../src/contracts.js';
import { launchBrowser } from '../src/browser/launch.js';
import { closeWithin, runBatch } from '../src/runner/batch-runner.js';
import { DEFAULT_CONTAINER } from '../src/storage/azure-gateway.js';
import { createStore } from '../src/storage/factory.js';
import { LocalArtifactStore } from '../src/storage/local.js';
import { RemoteArtifactStore } from '../src/storage/remote.js';
import { startAzurite } from './helpers/azurite.js';
import { FakeGateway } from './helpers/fake-gateway.js';
import { namedCards, writeFixture } from './fixtures/feed-fixture.js';

let root: string;
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'mkc-batch-remote-')); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

function remoteStore(gateway: FakeGateway, dir = root) {
  return new RemoteArtifactStore({ gateway, local: new LocalArtifactStore(dir) });
}

describe('runBatch with remote delivery', () => {
  it('delivers every artifact and the final manifest, and exits 0', async () => {
    const gateway = new FakeGateway();
    const url = await writeFixture({ query: 'alpha', cards: namedCards(4), endMarkerInitially: true });
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['alpha'], outputDirectory: root });
    const out = await runBatch({ config, store: remoteStore(gateway), searchUrlFor: () => url });
    expect(out.exitCode).toBe(0);
    expect(out.manifest.persistenceMode).toBe('azure_blob');
    expect(out.manifest.queries.map((q) => [q.status, q.persistenceStatus])).toEqual([['captured', 'verified']]);
    expect(out.manifest.artifacts.every((a) => a.storageStatus === 'verified')).toBe(true);
    expect(out.manifest.artifacts.find((a) => a.id === 'request_json')).toMatchObject({ kind: 'request_json', queryId: null, storageStatus: 'verified' });
    expect(out.manifestReceipt).toMatchObject({ storageStatus: 'verified', filename: 'manifest.json', runId: out.manifest.runId });
    const keys = [...gateway.objects.keys()];
    expect(keys.some((k) => k.startsWith('maps-keyword-capture/'))).toBe(false);
    const prefix = out.manifestReceipt!.objectKey!.replace(/manifest\.json$/, '');
    expect(keys).toEqual(expect.arrayContaining([`${prefix}request.json`, `${prefix}manifest.progress.json`, `${prefix}manifest.json`]));
    expect(keys.some((k) => k.startsWith(`${prefix}q0001/qa01/`) && k.endsWith('.png'))).toBe(true);
    const local = await readFile(out.manifestPath);
    expect(gateway.objects.get(`${prefix}manifest.json`)!.equals(local)).toBe(true);
    const published = JSON.parse(local.toString()) as BatchManifest;
    expect(JSON.stringify(published)).not.toContain('manifest.json"');
  });

  it('skips every keyword and never launches a browser when storage is unavailable', async () => {
    const gateway = new FakeGateway();
    gateway.failOn = () => true;
    let launches = 0;
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['a', 'b'], outputDirectory: root });
    const out = await runBatch({ config, store: remoteStore(gateway), launch: async () => { launches += 1; return launchBrowser(); } });
    expect(launches).toBe(0);
    expect(out.manifest.queries.map((q) => [q.status, q.stopReason])).toEqual([['skipped', 'storage_unavailable'], ['skipped', 'storage_unavailable']]);
    expect(out.manifestReceipt).toMatchObject({ storageStatus: 'failed' });
    expect(out.exitCode).toBe(1);
    expect((await readFile(out.manifestPath, 'utf8')).length).toBeGreaterThan(0);
  });

  it('finishes the batch but exits 1 when part of one keyword cannot be delivered', async () => {
    const gateway = new FakeGateway();
    gateway.failOn = (op, key) => op === 'create' && key.includes('/q0001/') && key.endsWith('.png');
    const urls: Record<string, string> = {
      one: await writeFixture({ query: 'one', cards: namedCards(4), endMarkerInitially: true }),
      two: await writeFixture({ query: 'two', cards: namedCards(4), endMarkerInitially: true }),
    };
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['one', 'two'], outputDirectory: root });
    const out = await runBatch({ config, store: remoteStore(gateway), searchUrlFor: (k) => urls[k]! });
    expect(out.manifest.queries.map((q) => [q.status, q.persistenceStatus])).toEqual([['captured', 'failed'], ['captured', 'verified']]);
    expect(out.manifest.status).toBe('completed');
    expect(out.manifestReceipt?.storageStatus).toBe('verified');
    expect(out.exitCode).toBe(1);
  });

  it('stops the batch when a keyword delivers nothing', async () => {
    const gateway = new FakeGateway();
    gateway.failOn = (op, key) => op === 'create' && key.includes('/q0001/');
    const url = await writeFixture({ query: 'q', cards: namedCards(3), endMarkerInitially: true });
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['q', 'q', 'q'], outputDirectory: root });
    const out = await runBatch({ config, store: remoteStore(gateway), searchUrlFor: () => url });
    expect(out.manifest.queries.map((q) => [q.status, q.stopReason])).toEqual([['captured', 'end_of_results'], ['skipped', 'storage_unavailable'], ['skipped', 'storage_unavailable']]);
    expect(out.exitCode).toBe(1);
  });
});

describe('runBatch layout breaker', () => {
  it('stops after three consecutive unsupported layouts', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(3) });
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['a', 'b', 'c', 'd', 'e'], outputDirectory: root });
    let calls = 0;
    const out = await runBatch({
      config, searchUrlFor: () => url,
      openSearchImpl: async () => { calls += 1; return { state: { kind: 'place_redirect' as const }, finalUrl: 'https://www.google.com/maps/place/X' }; },
    });
    expect(calls).toBe(3);
    expect(out.manifest.queries.map((q) => [q.status, q.stopReason])).toEqual([
      ['partial', 'unsupported_layout'], ['partial', 'unsupported_layout'], ['partial', 'unsupported_layout'],
      ['skipped', 'unsupported_layout'], ['skipped', 'unsupported_layout'],
    ]);
    expect(out.exitCode).toBe(2);
  });
});

describe('closeWithin', () => {
  it('returns closed for a normal close and timed_out for a hung one', async () => {
    expect(await closeWithin({ close: async () => undefined }, 1000)).toBe('closed');
    const started = Date.now();
    expect(await closeWithin({ close: () => new Promise<void>(() => undefined) }, 100)).toBe('timed_out');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('runBatch against Azurite', () => {
  let azurite: Awaited<ReturnType<typeof startAzurite>>;
  beforeAll(async () => {
    azurite = await startAzurite();
    await BlobServiceClient.fromConnectionString(azurite.connectionString).getContainerClient(DEFAULT_CONTAINER).createIfNotExists();
  });
  afterAll(async () => { await azurite.stop(); });

  it('uploads a whole batch through the real SDK and reads it back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mkc-azurite-'));
    const { store } = createStore('azure', dir, { AZURE_STORAGE_CONNECTION_STRING: azurite.connectionString });
    const url = await writeFixture({ query: 'azurite', cards: namedCards(4), endMarkerInitially: true });
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['azurite'], outputDirectory: dir });
    const out = await runBatch({ config, store, searchUrlFor: () => url });
    expect(out.exitCode).toBe(0);
    const container = BlobServiceClient.fromConnectionString(azurite.connectionString).getContainerClient(DEFAULT_CONTAINER);
    const names: string[] = [];
    for await (const blob of container.listBlobsFlat({ prefix: out.manifestReceipt!.objectKey!.replace(/manifest\.json$/, '') })) names.push(blob.name);
    expect(names.some((n) => n.endsWith('/manifest.json'))).toBe(true);
    expect(names.some((n) => n.endsWith('.png'))).toBe(true);
    expect(names.some((n) => n.endsWith('.csv'))).toBe(true);
    const remote = await container.getBlockBlobClient(out.manifestReceipt!.objectKey!).downloadToBuffer();
    expect(remote.equals(await readFile(out.manifestPath))).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/storage-factory.test.ts tests/batch-remote.test.ts`
Expected: FAIL — `src/storage/factory.js` missing and `closeWithin` not exported.

- [ ] **Step 3: Implement the factory**

`src/storage/factory.ts`:

```ts
import { ConfigError } from '../config.js';
import { AzureBlobGateway, containerClientFromEnv } from './azure-gateway.js';
import { LocalArtifactStore } from './local.js';
import { RemoteArtifactStore } from './remote.js';
import type { ArtifactStore } from './types.js';

export function parseStorageFlag(value: string | null): 'local' | 'azure' {
  if (value === null || value === 'local') return 'local';
  if (value === 'azure') return 'azure';
  throw new ConfigError(`--storage must be "local" or "azure", got "${value}"`);
}

export function createStore(mode: 'local' | 'azure', outputDirectory: string, env: NodeJS.ProcessEnv): { store: ArtifactStore; description: string | null } {
  const local = new LocalArtifactStore(outputDirectory);
  if (mode === 'local') return { store: local, description: null };
  const gateway = new AzureBlobGateway(containerClientFromEnv(env));
  return { store: new RemoteArtifactStore({ gateway, local }), description: gateway.description };
}
```

- [ ] **Step 4: Replace the batch runner**

Replace `src/runner/batch-runner.ts` entirely with:

```ts
import type { Browser } from 'playwright';
import type { Artifact, BatchManifest, CaptureConfig, ManifestDeliveryReceipt, RunMetadata, SkipReason } from '../contracts.js';
import { launchBrowser } from '../browser/launch.js';
import { hashJson, newAttemptId, newRunId, queryAttemptIdFor, queryIdFor } from '../ids.js';
import { attemptRelativeDir, isoWithOffset } from '../naming.js';
import { LocalArtifactStore } from '../storage/local.js';
import type { ArtifactStore } from '../storage/types.js';
import { createManifest, exitCodeFor, finalizeManifest, markRunning, markSkipped, recordBatchArtifact, recordQueryAttempt } from './manifest.js';
import { runQueryAttempt, TransientBrowserError, type QueryRunnerDeps } from './query-runner.js';

export const ADAPTER_VERSION = 'maps-feed-card/v1';
/** A layout the adapter cannot read on this many keywords in a row is treated as global (design §9). */
export const UNSUPPORTED_LAYOUT_STREAK = 3;
/** A hung browser close must not keep the final manifest from being published. */
export const BROWSER_CLOSE_TIMEOUT_MS = 10_000;

export interface BatchDeps {
  config: CaptureConfig;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
  launch?: () => Promise<Browser>;
  searchUrlFor?: (keyword: string) => string;
  openSearchImpl?: QueryRunnerDeps['openSearchImpl'];
  signal?: AbortSignal;
  /** Where artifacts are written and delivered. Defaults to local disk under config.outputDirectory. */
  store?: ArtifactStore;
}

export interface BatchOutput {
  manifest: BatchManifest;
  attemptRoot: string;
  manifestPath: string;
  /** Delivery receipt for manifest.json in remote mode; null in local mode or if it could not be written. */
  manifestReceipt: ManifestDeliveryReceipt | null;
  exitCode: 0 | 1 | 2;
}

export function batchDeadlineMs(config: CaptureConfig): number {
  const n = config.keywords.length;
  return (60 + n * (config.keywordTimeoutMs / 1000 + 30) + 60) * 1000;
}

export async function closeWithin(browser: Pick<Browser, 'close'>, timeoutMs: number): Promise<'closed' | 'timed_out'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timed_out'>((resolve) => { timer = setTimeout(() => resolve('timed_out'), timeoutMs); });
  try {
    return await Promise.race([browser.close().then(() => 'closed' as const, () => 'closed' as const), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runBatch(deps: BatchDeps): Promise<BatchOutput> {
  const { config } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const startedAtDate = now();
  const runId = newRunId(startedAtDate);
  const attemptId = newAttemptId();
  const tz = config.filenameTimezone;
  const store = deps.store ?? new LocalArtifactStore(config.outputDirectory);
  const attemptRel = attemptRelativeDir(startedAtDate, tz, runId, attemptId);
  const attemptRoot = store.absolutePath(attemptRel);
  const manifestPath = store.absolutePath(`${attemptRel}/manifest.json`);
  const metadata: RunMetadata = {
    configHash: hashJson(config),
    profileHash: hashJson({ surface: 'google-maps-desktop', locale: config.locale, browserTimezoneId: config.browserTimezoneId, viewport: config.viewport, deviceScaleFactor: 1, locationMode: 'query_only', adapterVersion: ADAPTER_VERSION }),
    adapterVersion: ADAPTER_VERSION,
    sourceCommit: process.env['GIT_COMMIT'] ?? null,
    browserVersion: null,
    imageDigest: process.env['IMAGE_DIGEST'] ?? null,
    egressProfileId: process.env['EGRESS_PROFILE_ID'] ?? null,
  };
  const startedAt = isoWithOffset(startedAtDate, tz);
  let manifest = createManifest({ runId, attemptId, startedAt, metadata, persistenceMode: store.mode, keywords: config.keywords });

  // request.json is also the storage preflight: nothing is launched if it cannot be delivered.
  const requestWritten = await store.writeFile(`${attemptRel}/request.json`, JSON.stringify({ runId, attemptId, startedAt, config }, null, 2));
  const requestState = await store.persist(requestWritten);
  const requestArtifact: Artifact = {
    ...requestState, id: 'request_json', filename: 'request.json', kind: 'request_json',
    bytes: requestWritten.bytes, sha256: requestWritten.sha256, queryId: null, queryAttemptId: null,
  };
  manifest = recordBatchArtifact(manifest, requestArtifact);

  let progressWarned = false;
  const writeProgress = async () => {
    const written = await store.writeFile(`${attemptRel}/manifest.progress.json`, JSON.stringify(manifest, null, 2));
    const state = await store.persist(written, { mutable: true });
    if (state.storageStatus === 'failed' && !progressWarned) {
      progressWarned = true;
      log({ stage: 'progress_persist_failed', runId, attemptId, code: state.storageError.code, message: state.storageError.message });
    }
  };

  const finish = async (): Promise<BatchOutput> => {
    manifest = finalizeManifest(manifest, isoWithOffset(now(), tz));
    let receipt: ManifestDeliveryReceipt | null = null;
    try {
      const written = await store.writeFile(`${attemptRel}/manifest.json`, JSON.stringify(manifest, null, 2));
      if (store.mode !== 'local_only') {
        const state = await store.persist(written);
        receipt = { ...state, runId, attemptId, filename: 'manifest.json', bytes: written.bytes, sha256: written.sha256 };
        log({ stage: 'manifest_published', runId, attemptId, storageStatus: receipt.storageStatus, objectKey: receipt.objectKey });
      }
    } catch (err) {
      log({ stage: 'manifest_write_failed', runId, attemptId, message: err instanceof Error ? err.message : String(err) });
    }
    log({ stage: 'batch_done', runId, attemptId, status: manifest.status });
    return { manifest, attemptRoot, manifestPath, manifestReceipt: receipt, exitCode: exitCodeFor(manifest, receipt) };
  };

  await writeProgress();
  log({ stage: 'batch_start', runId, attemptId, keywords: config.keywords.length, attemptRoot, storage: store.mode });

  if (requestState.storageStatus === 'failed') {
    log({ stage: 'storage_unavailable', runId, attemptId, code: requestState.storageError.code, message: requestState.storageError.message });
    for (const q of manifest.queries) manifest = markSkipped(manifest, q.queryId, 'storage_unavailable');
    return finish();
  }

  let browser: Browser;
  try {
    browser = await (deps.launch ?? launchBrowser)();
  } catch (err) {
    log({ stage: 'browser_startup_failed', runId, attemptId, message: (err as Error).message });
    for (const q of manifest.queries) manifest = markSkipped(manifest, q.queryId, 'browser_startup_failed');
    return finish();
  }
  manifest = { ...manifest, metadata: { ...metadata, browserVersion: browser.version() } };

  const batchDeadlineAt = startedAtDate.getTime() + batchDeadlineMs(config);
  const skipRemaining = (reason: SkipReason) => {
    for (const q of manifest.queries) {
      if (q.status === 'pending' || q.status === 'running') manifest = markSkipped(manifest, q.queryId, reason);
    }
  };
  let breaker = false;
  let batchStop: SkipReason | null = null;
  let unsupportedStreak = 0;
  let output: BatchOutput | undefined;
  try {
    for (const [inputIndex, keyword] of config.keywords.entries()) {
      const queryId = queryIdFor(inputIndex);
      if (batchStop) { manifest = markSkipped(manifest, queryId, batchStop); await writeProgress(); continue; }
      if (deps.signal?.aborted) { manifest = markSkipped(manifest, queryId, 'cancelled'); await writeProgress(); continue; }
      if (breaker) { manifest = markSkipped(manifest, queryId, 'batch_blocked'); await writeProgress(); continue; }
      if (Date.now() > batchDeadlineAt) { manifest = markSkipped(manifest, queryId, 'batch_timeout'); await writeProgress(); continue; }

      manifest = markRunning(manifest, queryId);
      const keywordDeadline = Math.min(Date.now() + config.keywordTimeoutMs, batchDeadlineAt);
      const runnerDeps: QueryRunnerDeps = {
        browser, store, config, runId, attemptId, metadata: manifest.metadata, attemptRelativeDir: attemptRel, now, log,
        ...(deps.searchUrlFor ? { searchUrlFor: deps.searchUrlFor } : {}),
        ...(deps.openSearchImpl ? { openSearchImpl: deps.openSearchImpl } : {}),
        ...(deps.signal ? { signal: deps.signal } : {}),
      };
      let attemptNumber = 1;
      let allowTransientThrow = keywordDeadline - Date.now() > 15_000;
      try {
        for (;;) {
          try {
            const out = await runQueryAttempt(runnerDeps, { queryId, inputIndex, keyword, queryAttemptId: queryAttemptIdFor(attemptNumber), deadlineAt: keywordDeadline, allowTransientThrow });
            manifest = recordQueryAttempt(manifest, queryId, out.summary, out.artifacts);
            // Any blocked outcome, CAPTCHA or an unresolved consent wall, means the session cannot
            // collect; do not push the rest of the batch through it.
            if (out.summary.status === 'blocked') breaker = true;
            unsupportedStreak = out.summary.stopReason === 'unsupported_layout' ? unsupportedStreak + 1 : 0;
            if (unsupportedStreak >= UNSUPPORTED_LAYOUT_STREAK && !batchStop) {
              batchStop = 'unsupported_layout';
              log({ stage: 'layout_breaker', runId, attemptId, queryId, streak: unsupportedStreak });
            }
            if (store.mode !== 'local_only' && out.artifacts.length > 0 && !out.artifacts.some((a) => a.storageStatus === 'verified')) {
              batchStop = 'storage_unavailable';
              log({ stage: 'storage_unavailable', runId, attemptId, queryId });
            }
            break;
          } catch (err) {
            if (err instanceof TransientBrowserError && attemptNumber === 1) {
              log({ stage: 'retry', queryId, message: err.message });
              attemptNumber = 2;
              allowTransientThrow = false;
              continue;
            }
            throw err;
          }
        }
        await writeProgress();
        const row = manifest.queries.find((q) => q.queryId === queryId);
        log({ stage: 'query_done', queryId, status: row?.status, stopReason: row?.stopReason, persistence: row?.persistenceStatus });
      } catch (err) {
        // runQueryAttempt records its own terminal result for everything it can observe, so an
        // exception here means the browser or the store is gone. Keep the row terminal either way.
        const message = err instanceof Error ? err.message : String(err);
        log({ stage: 'query_error', runId, attemptId, queryId, message });
        const browserGone = /Target (page|context|browser) has been closed|browser has been closed|has been closed|crashed|disconnected/i.test(message);
        const reason: SkipReason = browserGone ? 'browser_startup_failed' : 'storage_unavailable';
        const row = manifest.queries.find((q) => q.queryId === queryId);
        if (row && (row.status === 'pending' || row.status === 'running')) manifest = markSkipped(manifest, queryId, reason);
        await writeProgress().catch(() => undefined);
        if (browserGone) { batchStop = reason; continue; }
        skipRemaining(reason);
        throw err;
      }
    }
  } finally {
    if (await closeWithin(browser, BROWSER_CLOSE_TIMEOUT_MS) === 'timed_out') log({ stage: 'browser_close_timeout', runId, attemptId });
    output = await finish();
  }
  if (!output) throw new Error('batch finished without publishing a manifest');
  return output;
}
```

- [ ] **Step 5: Update the CLI**

Replace `src/cli.ts` entirely with:

```ts
import { ConfigError, loadConfigFile } from './config.js';
import { runBatch } from './runner/batch-runner.js';
import { deliveryStatus } from './runner/manifest.js';
import { createSignalHandler } from './runner/signals.js';
import { createStore, parseStorageFlag } from './storage/factory.js';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main(): Promise<number> {
  const configPath = argValue('--config');
  if (!configPath) {
    process.stderr.write('usage: npm run capture -- --config <keywords.json> [--storage local|azure]\n');
    return 64;
  }
  const storageMode = parseStorageFlag(argValue('--storage'));
  const { config, duplicateKeywordCount } = await loadConfigFile(configPath);
  if (duplicateKeywordCount > 0) {
    process.stderr.write(`note: ${duplicateKeywordCount} duplicate keyword row(s); each row is collected separately\n`);
  }
  const { store, description } = createStore(storageMode, config.outputDirectory, process.env);

  const controller = new AbortController();
  const onSignal = createSignalHandler(controller, (m) => process.stderr.write(m));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => onSignal(sig));

  const out = await runBatch({
    config,
    store,
    signal: controller.signal,
    log: (event) => process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`),
  });
  const counts: Record<string, number> = {};
  for (const q of out.manifest.queries) counts[q.status] = (counts[q.status] ?? 0) + 1;
  process.stdout.write(`${JSON.stringify({
    summary: true, runId: out.manifest.runId, attemptId: out.manifest.attemptId, status: out.manifest.status,
    counts, manifest: out.manifestPath,
    remotePersistence: deliveryStatus(out.manifest, out.manifestReceipt),
    storage: description,
    manifestReceipt: out.manifestReceipt,
  })}\n`);
  return out.exitCode;
}

main().then(
  (code) => { process.exitCode = code; },
  (err) => {
    if (err instanceof ConfigError) { process.stderr.write(`${err.message}\n`); process.exitCode = err.exitCode; return; }
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/storage-factory.test.ts tests/batch-remote.test.ts tests/batch-runner.test.ts && npm run typecheck && npm test && npm run build && rm -rf dist`
Expected: storage-factory 2 passed, batch-remote 7 passed, existing batch-runner tests unchanged and passing, whole suite green, build clean.

CLI checks (no Azure contact; the second must fail fast with exit 64 and no stack trace):

```bash
npx tsx src/cli.ts; echo "exit=$?"                                                        # usage, exit=64
npx tsx src/cli.ts --config examples/keywords.json --storage azure; echo "exit=$?"       # needs AZURE_STORAGE_..., exit=64
npx tsx src/cli.ts --config examples/keywords.json --storage s3; echo "exit=$?"          # --storage must be..., exit=64
```

- [ ] **Step 7: Commit**

```bash
git add src/storage/factory.ts src/runner/batch-runner.ts src/cli.ts tests/storage-factory.test.ts tests/batch-remote.test.ts
git commit -m "feat: deliver batches to Azure Blob with preflight, breakers, and a manifest receipt"
```

---

### Task 5: Keep blocked outcomes through export failures, and cover the batch exception path

**Files:**
- Modify: `src/runner/query-runner.ts` (one statement), `tests/query-runner.test.ts`, `tests/batch-runner.test.ts`

**Interfaces:**
- Consumes: `RefusingStore` helper in `tests/query-runner.test.ts` (has `absolutePath` since Task 2); `runBatch`, `BatchDeps.store` (Task 4); `LocalArtifactStore`.
- Produces: no new exports. Behavior: when an export write fails on an attempt whose collection outcome is `blocked`, the result stays `blocked` (with the `export_failed` warning) instead of becoming `failed / error`, so the batch circuit breaker still trips.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('runQueryAttempt', ...)` block of `tests/query-runner.test.ts`:

```ts
  it('keeps blocked / captcha when an export write fails, so the batch breaker still trips', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(5) });
    const d = {
      ...deps(url),
      store: new RefusingStore(new LocalArtifactStore(root), (p) => p.endsWith('observations.jsonl')),
      openSearchImpl: async () => ({ state: { kind: 'captcha' as const }, finalUrl: 'https://www.google.com/sorry/index' }),
    };
    const out = await runQueryAttempt(d, input({ queryId: 'q0095', keyword: 'q' }));
    expect(out.result).toMatchObject({ status: 'blocked', stopReason: 'captcha' });
    expect(out.summary.status).toBe('blocked');
    expect(out.result.quality.warnings.map((w) => w.code)).toContain('export_failed');
  });
```

Append inside `describe('runBatch', ...)` of `tests/batch-runner.test.ts`, and add `readdir` to its `node:fs/promises` import and `LocalArtifactStore` / `WrittenFile` imports as shown:

```ts
// add to imports at the top of the file:
// import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
// import { LocalArtifactStore } from '../src/storage/local.js';
// import type { ArtifactStore, PersistOptions, WrittenFile } from '../src/storage/types.js';

  it('publishes a terminal manifest and rethrows when a keyword cannot write its result JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mkc-batch-throw-'));
    const inner = new LocalArtifactStore(dir);
    const store: ArtifactStore = {
      mode: 'local_only',
      rootDirectory: inner.rootDirectory,
      absolutePath: (p: string) => inner.absolutePath(p),
      writeFile: async (p: string, data: Buffer | string): Promise<WrittenFile> => {
        if (/__q0001\.json$/.test(p)) throw new Error('disk full');
        return inner.writeFile(p, data);
      },
      persist: (file: WrittenFile, options?: PersistOptions) => inner.persist(file, options),
    };
    const url = await writeFixture({ query: 'q', cards: namedCards(3), endMarkerInitially: true });
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['q', 'q'], outputDirectory: dir });
    await expect(runBatch({ config, store, searchUrlFor: () => url })).rejects.toThrow(/result JSON could not be written/);
    const files = (await readdir(dir, { recursive: true })).map(String);
    const manifestFile = files.find((f) => f.endsWith('manifest.json') && !f.endsWith('progress.json'));
    expect(manifestFile).toBeDefined();
    const published = JSON.parse(await readFile(join(dir, manifestFile!), 'utf8')) as BatchManifest;
    expect(published.finishedAt).not.toBeNull();
    expect(published.queries.map((q) => [q.status, q.stopReason])).toEqual([['skipped', 'storage_unavailable'], ['skipped', 'storage_unavailable']]);
    await rm(dir, { recursive: true, force: true });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/query-runner.test.ts -t "export write fails" && npx vitest run tests/batch-runner.test.ts -t "cannot write its result JSON"`
Expected: the query-runner test FAILS (`status` is `failed`); the batch test PASSES already (Task 4's `finally` publishes) — keep it as the regression guard the final review asked for and note that in the report.

- [ ] **Step 3: Implement**

In `src/runner/query-runner.ts`, replace:

```ts
  const finalOutcome: CollectionOutcome = exportError ? { status: 'failed', stopReason: 'error', error: exportError } : outcome;
```

with:

```ts
  // A blocked page stays blocked: the batch breaker depends on it, and the export failure is
  // already recorded as a warning on the result.
  const finalOutcome: CollectionOutcome = exportError && outcome.status !== 'blocked'
    ? { status: 'failed', stopReason: 'error', error: exportError }
    : outcome;
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/query-runner.test.ts tests/batch-runner.test.ts && npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/runner/query-runner.ts tests/query-runner.test.ts tests/batch-runner.test.ts
git commit -m "fix: keep blocked outcomes through export failures; cover the batch exception path"
```

---

### Task 6: Production Job template and deployment instructions

**Files:**
- Create: `deploy/job/configmap.yaml`, `deploy/job/job.yaml`, `deploy/job/README.md`
- Modify: `docs/deployment.md` (link the README; replace the storage paragraph), `README.md` (Development setup: `--storage azure` line)

**Interfaces:**
- Consumes: CLI flags `--config`, `--storage azure` and env `AZURE_STORAGE_CONTAINER_SAS_URL` (Tasks 1, 4); image `fbrdevacr.azurecr.io/ai/maps-keyword-capture` (Dockerfile, unchanged); Secret `maps-keyword-capture-storage` (created in Task 7).
- Produces: a Job created with `kubectl create -f deploy/job/job.yaml` (uses `generateName: maps-capture-`), reading keywords from ConfigMap `maps-capture-keywords`.

- [ ] **Step 1: Write the ConfigMap**

`deploy/job/configmap.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: maps-capture-keywords
  namespace: dev-ai
  labels:
    app.kubernetes.io/name: maps-keyword-capture
    app.kubernetes.io/component: batch
data:
  keywords.json: |
    {
      "schemaVersion": "1",
      "keywords": [
        "bubble tea garden city ny",
        "fried chicken mineola",
        "matcha mineola",
        "plumber mineola ny",
        "dentist garden city ny",
        "nail salon garden city ny",
        "hair salon mineola ny",
        "pizza garden city ny",
        "sushi mineola ny",
        "coffee shop garden city ny",
        "dry cleaner mineola ny",
        "auto repair garden city ny",
        "pharmacy mineola ny",
        "gym garden city ny",
        "yoga studio mineola ny",
        "bakery garden city ny",
        "florist mineola ny",
        "pet grooming garden city ny",
        "chiropractor mineola ny",
        "real estate agent garden city ny"
      ],
      "maxResultsPerKeyword": 15,
      "maxScrollsPerKeyword": 6,
      "maxScreenshotsPerKeyword": 5,
      "keywordTimeoutMs": 90000,
      "locale": "en-US",
      "browserTimezoneId": "America/New_York",
      "filenameTimezone": "Asia/Shanghai",
      "viewport": { "width": 1440, "height": 1000 },
      "outputDirectory": "/work/outputs"
    }
```

- [ ] **Step 2: Write the Job**

`deploy/job/job.yaml` (the digest is the current image; Task 7 replaces it with the image built from this branch):

```yaml
# Production batch Job. Create a new run with `kubectl create -f` (generateName), not `apply`.
# Artifacts are uploaded to fbrdevstorage/maps-keyword-capture and verified by read-back; the Pod's
# emptyDir is only staging.
apiVersion: batch/v1
kind: Job
metadata:
  generateName: maps-capture-
  namespace: dev-ai
  labels:
    app.kubernetes.io/name: maps-keyword-capture
    app.kubernetes.io/component: batch
spec:
  backoffLimit: 0
  # 20 keywords: 60 + 20 * (90 + 30) + 60 = 2520 s application budget, plus margin for the measured
  # per-keyword overshoot and manifest publication.
  activeDeadlineSeconds: 3000
  ttlSecondsAfterFinished: 86400
  template:
    metadata:
      labels:
        app.kubernetes.io/name: maps-keyword-capture
        app.kubernetes.io/component: batch
    spec:
      restartPolicy: Never
      nodeSelector:
        envpool: aiapp
      automountServiceAccountToken: false
      # SIGTERM stops the in-flight keyword at its next round, then results and the manifest are
      # uploaded; 60 s covers one round plus delivery.
      terminationGracePeriodSeconds: 60
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001
      containers:
        - name: capture
          image: fbrdevacr.azurecr.io/ai/maps-keyword-capture@sha256:9c7c86e3a329027befc540fb859ad6c5c332e4dd8d4d21e9f453c81a7b07433a
          args: ["node", "dist/cli.js", "--config", "/config/keywords.json", "--storage", "azure"]
          env:
            - name: IMAGE_DIGEST
              value: sha256:9c7c86e3a329027befc540fb859ad6c5c332e4dd8d4d21e9f453c81a7b07433a
            - name: EGRESS_PROFILE_ID
              value: aks-fbrdev-eastus2-aiapp
            - name: AZURE_STORAGE_CONTAINER_SAS_URL
              valueFrom:
                secretKeyRef:
                  name: maps-keyword-capture-storage
                  key: AZURE_STORAGE_CONTAINER_SAS_URL
          resources:
            requests:
              cpu: "1"
              memory: 1Gi
              ephemeral-storage: 1Gi
            limits:
              cpu: "2"
              memory: 2Gi
              ephemeral-storage: 3Gi
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - { name: config, mountPath: /config, readOnly: true }
            - { name: work, mountPath: /work }
            - { name: tmp, mountPath: /tmp }
            - { name: dshm, mountPath: /dev/shm }
      volumes:
        - name: config
          configMap:
            name: maps-capture-keywords
        - name: work
          emptyDir: { sizeLimit: 2Gi }
        - name: tmp
          emptyDir: { sizeLimit: 1Gi }
        - name: dshm
          emptyDir: { medium: Memory, sizeLimit: 512Mi }
```

- [ ] **Step 3: Write the README**

`deploy/job/README.md`:

````markdown
# Production batch Job

Runs a keyword batch in `dev-ai` on the `aiapp` pool and delivers every artifact to the private container `maps-keyword-capture` in storage account `fbrdevstorage`. Each file is read back and checked by size and SHA-256 before the manifest calls it verified. For a run that keeps results on the Pod instead, see `deploy/dev-trial/`.

## One-time setup

Requires Contributor on resource group `FBRDev` and `kubectl` access to `dev-ai`. The SAS is container-scoped and tied to a stored access policy, so it can be revoked without rotating the account key. Never paste the SAS into a terminal, a chat, or a commit.

```bash
az storage container create --account-name fbrdevstorage --name maps-keyword-capture --public-access off --auth-mode login
KEY=$(az storage account keys list -g FBRDev -n fbrdevstorage --query '[0].value' -o tsv)
EXPIRY=$(date -u -v+1y +%Y-%m-%dT%H:%MZ 2>/dev/null || date -u -d '+1 year' +%Y-%m-%dT%H:%MZ)
az storage container policy create --account-name fbrdevstorage --account-key "$KEY" \
  --container-name maps-keyword-capture --name maps-capture-writer --permissions rcw --expiry "$EXPIRY"
SAS=$(az storage container generate-sas --account-name fbrdevstorage --account-key "$KEY" \
  --name maps-keyword-capture --policy-name maps-capture-writer --https-only -o tsv)
ENV_FILE=$(mktemp); chmod 600 "$ENV_FILE"
printf 'AZURE_STORAGE_CONTAINER_SAS_URL=https://fbrdevstorage.blob.core.windows.net/maps-keyword-capture?%s\n' "$SAS" > "$ENV_FILE"
kubectl -n dev-ai create secret generic maps-keyword-capture-storage --from-env-file="$ENV_FILE"
rm -f "$ENV_FILE"; unset KEY SAS
```

Check the container is private: `az storage container show --account-name fbrdevstorage --name maps-keyword-capture --auth-mode login --query properties.publicAccess` must print nothing (`null`).

## Build and pin the image

```bash
SHA=$(git rev-parse --short HEAD)
az acr build --registry FBRDevAcr --platform linux/amd64 \
  --image ai/maps-keyword-capture:$SHA --build-arg GIT_COMMIT=$SHA .
```

Put the printed digest into `job.yaml` in both `image` and `IMAGE_DIGEST`, and commit.

## Run a batch

Edit the keywords in `configmap.yaml` (at most 20), then:

```bash
kubectl apply -f deploy/job/configmap.yaml
JOB=$(kubectl create -f deploy/job/job.yaml -o name)
kubectl -n dev-ai logs -f "$JOB"
```

The last log line is a JSON summary with `remotePersistence` (`verified` or `failed`) and `manifestReceipt.objectKey`. Exit code 0 means every keyword was captured and every artifact verified; 2 means some keywords were partial, blocked, or skipped but everything collected was delivered; 1 means a delivery failure or a failed batch.

## Inspect results

```bash
PREFIX=<manifestReceipt.objectKey without manifest.json>     # e.g. 2026-09-18/run_.../att_.../
az storage blob list --account-name fbrdevstorage --container-name maps-keyword-capture --auth-mode login --prefix "$PREFIX" --query "[].name" -o tsv
az storage blob download-batch --account-name fbrdevstorage --source maps-keyword-capture --auth-mode login --pattern "${PREFIX}*" --destination outputs/azure
```

## Stop, revoke, rotate

- Stop a running batch: `kubectl -n dev-ai delete "$JOB"`. The Pod receives SIGTERM, stops the current keyword at its next round, skips the rest, and uploads the manifest within the 60-second grace period.
- Revoke the SAS immediately (read the key again first, since setup unsets it): `KEY=$(az storage account keys list -g FBRDev -n fbrdevstorage --query '[0].value' -o tsv)`, then `az storage container policy delete --account-name fbrdevstorage --account-key "$KEY" --container-name maps-keyword-capture --name maps-capture-writer`.
- Extend it: `az storage container policy update --account-name fbrdevstorage --account-key "$KEY" --container-name maps-keyword-capture --name maps-capture-writer --expiry <YYYY-MM-DDTHH:MMZ>`; the Secret does not change.
````

- [ ] **Step 4: Update the docs**

In `docs/deployment.md`, replace the paragraph that begins `Storage target:` with:

```markdown
Storage target: private container `maps-keyword-capture` in account `fbrdevstorage` (the `seo` container is publicly readable and is not used). Pods authenticate with a container-scoped SAS tied to stored access policy `maps-capture-writer`, from Secret `maps-keyword-capture-storage`; local runs use `az login` with `AZURE_STORAGE_ACCOUNT_URL`. Setup, run, inspection, and revocation steps are in [deploy/job/README.md](../deploy/job/README.md).
```

In `README.md`, inside the "Development setup" section after the `npm run capture -- --config examples/keywords.json` line of the code block, add:

```bash
AZURE_STORAGE_ACCOUNT_URL=https://fbrdevstorage.blob.core.windows.net npm run capture -- --config examples/keywords.json --storage azure   # after az login
```

- [ ] **Step 5: Validate**

```bash
kubectl create --dry-run=server -f deploy/job/configmap.yaml
kubectl create --dry-run=server -f deploy/job/job.yaml
grep -rn "sig=" deploy docs README.md | grep -v "sig=REDACTED" && echo "SAS found" || echo "no SAS in repo"
```

Expected: both dry runs print `created (server dry run)`; the grep prints `no SAS in repo`.

- [ ] **Step 6: Commit**

```bash
git add deploy/job docs/deployment.md README.md
git commit -m "deploy: add production batch Job with Azure delivery and setup instructions"
```

---

### Task 7: Infrastructure and in-cluster acceptance (controller-executed)

This task changes shared Azure and cluster resources and handles a credential, so the controller runs it directly rather than dispatching an implementer. Nothing in it is committed except the pinned digest and documentation.

- [ ] **Step 1: Create the container, access policy, SAS, and Secret** exactly as in `deploy/job/README.md` "One-time setup". Verify: container `publicAccess` is null; `kubectl -n dev-ai get secret maps-keyword-capture-storage -o jsonpath='{.data}' | python3 -c "import sys,json; print(list(json.load(sys.stdin)))"` prints `['AZURE_STORAGE_CONTAINER_SAS_URL']`; the SAS never appears in terminal output.

- [ ] **Step 2: Local end-to-end through `az login`.** Run one keyword with `AZURE_STORAGE_ACCOUNT_URL=https://fbrdevstorage.blob.core.windows.net npm run capture -- --config <one-keyword config> --storage azure`. Expect exit 0, `remotePersistence: verified`, and the blob list under the receipt prefix to contain request, progress, manifest, JSON, CSV, observations, and PNGs.

- [ ] **Step 3: Build and pin.** `az acr build` at the branch head; put the digest into `deploy/job/job.yaml` (`image` and `IMAGE_DIGEST`); commit `deploy: pin batch Job to <sha>`.

- [ ] **Step 4: Run the 20-keyword batch in `dev-ai`.** `kubectl apply -f deploy/job/configmap.yaml`, `kubectl create -f deploy/job/job.yaml`; sample `kubectl top pod` every 15 s; record duration, peak CPU and memory, per-keyword status, stop reasons, screenshots per keyword, warnings, and the summary line.

- [ ] **Step 5: Independent verification.** With `--auth-mode login`, download every blob under the run prefix to a temporary directory; for every artifact in the downloaded `manifest.json` compare size and SHA-256; check PNG signatures; compare the downloaded `manifest.json` SHA-256 with the receipt in the Pod log. Expect zero mismatches.

- [ ] **Step 6: Durability.** Delete the Job and its Pod; list the run prefix again and download `manifest.json` again. Expect identical content.

- [ ] **Step 7: SIGTERM.** Apply a 5-keyword ConfigMap, create a Job, wait for the first `query_done`, then `kubectl -n dev-ai delete pod <pod> --grace-period=60`. Expect in the uploaded `manifest.json`: the first keyword terminal and verified, the in-flight keyword `partial` or `failed` with `stopReason: cancelled`, the remaining keywords `skipped / cancelled`, and a `manifest_published` log line with `storageStatus: verified` before the Pod exits. Restore the 20-keyword ConfigMap afterwards.

- [ ] **Step 8: Record and clean up.** Append a "Production Job acceptance" section to `docs/validation-status.md` with the measured values and any defect found; update the Evidence ledger rows "Sandboxed Chromium in target Pod" (SIGTERM) and "Azure persistence"; add Milestone 3 and 4 status lines to `docs/implementation-plan.md`. Delete the finished acceptance Jobs (the Secret, ConfigMap, container, and uploaded evidence stay). Commit `docs: record production Job acceptance`.

If Step 4 or 7 exposes a code defect, fix it on this branch with a failing test first (dispatched as a fix task through the normal review loop), rebuild, re-pin, and repeat the affected step.

---

## Not covered by this plan

Workload identity (needs a role assignment the current account cannot make), a CronJob schedule, a results viewer, report generation, and multi-locale adapters.
