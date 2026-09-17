import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config.js';
import { AzureBlobGateway, containerClientFromEnv, type GatewayLimits } from '../src/storage/azure-gateway.js';
import { LocalArtifactStore } from '../src/storage/local.js';
import { RemoteArtifactStore } from '../src/storage/remote.js';
import { AZURITE_ACCOUNT_KEY } from './helpers/azurite.js';

// A blob endpoint that accepts connections and never answers: the shape of a stalled storage account.
let server: Server;
let port: number;
let accepted = 0;
const sockets = new Set<Socket>();
let root: string;

beforeAll(async () => {
  server = createServer((socket) => {
    accepted += 1;
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  root = await mkdtemp(join(tmpdir(), 'mkc-timeouts-'));
});
afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

const limits: GatewayLimits = { callTimeoutMs: 800, maxTries: 2, tryTimeoutMs: 400, retryDelayMs: 50, maxRetryDelayMs: 100 };
const env = () => ({
  AZURE_STORAGE_CONNECTION_STRING: `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=${AZURITE_ACCOUNT_KEY};BlobEndpoint=http://127.0.0.1:${port}/devstoreaccount1;`,
});
const stalledGateway = () => new AzureBlobGateway(containerClientFromEnv(env(), limits), limits);

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T | undefined; error: Error | undefined; ms: number }> {
  const started = Date.now();
  try {
    const value = await fn();
    return { value, error: undefined, ms: Date.now() - started };
  } catch (err) {
    return { value: undefined, error: err as Error, ms: Date.now() - started };
  }
}

describe('AzureBlobGateway against a stalled endpoint', () => {
  it('bounds createIfAbsent and reports a timeout', async () => {
    const { error, ms } = await timed(() => stalledGateway().createIfAbsent('2026-09-17/run/att/a.json', Buffer.from('{}'), 'application/json'));
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain('timed out after 800 ms');
    expect(ms).toBeLessThan(3000);
  });

  it('bounds put and reports a timeout', async () => {
    const { error, ms } = await timed(() => stalledGateway().put('2026-09-17/run/att/manifest.progress.json', Buffer.from('{}'), 'application/json'));
    expect(error?.message).toContain('timed out after 800 ms');
    expect(ms).toBeLessThan(3000);
  });

  it('bounds get', async () => {
    const { error, ms } = await timed(() => stalledGateway().get('2026-09-17/run/att/a.json'));
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain('timed out');
    expect(ms).toBeLessThan(3000);
  });

  it('lets RemoteArtifactStore fast-fail once storage is clearly down', async () => {
    const store = new RemoteArtifactStore({ gateway: stalledGateway(), local: new LocalArtifactStore(root) });
    const files = await Promise.all(['a', 'b', 'c'].map((n) => store.writeFile(`maps-keyword-capture/2026-09-17/run_1/att_1/q0001/qa01/${n}.json`, n)));
    for (const file of files.slice(0, 2)) {
      const { value, ms } = await timed(() => store.persist(file));
      expect(value).toMatchObject({ storageStatus: 'failed', storageError: { code: 'upload_failed' } });
      expect(ms).toBeLessThan(3000);
    }
    const connectionsBefore = accepted;
    const { value, ms } = await timed(() => store.persist(files[2]!));
    expect(value).toMatchObject({ storageStatus: 'failed', storageError: { code: 'storage_unavailable' } });
    expect(ms).toBeLessThan(50);
    await new Promise((r) => setTimeout(r, 200));
    expect(accepted).toBe(connectionsBefore);
  });
});

describe('containerClientFromEnv pipeline options', () => {
  it('applies maxTries to both the connection-string and the SAS URL clients', async () => {
    let requests = 0;
    const unavailable = createHttpServer((_req, res) => { requests += 1; res.writeHead(503, { 'content-length': '0', connection: 'close' }).end(); });
    await new Promise<void>((resolve) => unavailable.listen(0, '127.0.0.1', resolve));
    const busyPort = (unavailable.address() as AddressInfo).port;
    const retryLimits: GatewayLimits = { callTimeoutMs: 30_000, maxTries: 2, tryTimeoutMs: 400, retryDelayMs: 50, maxRetryDelayMs: 100 };
    try {
      const settings = [
        { AZURE_STORAGE_CONNECTION_STRING: `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=${AZURITE_ACCOUNT_KEY};BlobEndpoint=http://127.0.0.1:${busyPort}/devstoreaccount1;` },
        { AZURE_STORAGE_CONTAINER_SAS_URL: `http://127.0.0.1:${busyPort}/devstoreaccount1/maps-keyword-capture?sv=2024-01-01&sig=FAKESIGNATURE` },
      ];
      for (const env of settings) {
        requests = 0;
        const g = new AzureBlobGateway(containerClientFromEnv(env, retryLimits), retryLimits);
        const err = await g.createIfAbsent('2026-09-17/run/att/a.json', Buffer.from('{}'), 'application/json').catch((e: unknown) => e as Error);
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('HTTP 503');
        expect((err as Error).message).not.toContain('FAKESIGNATURE');
        expect(requests).toBe(2);
      }
    } finally {
      unavailable.closeAllConnections();
      await new Promise<void>((resolve) => unavailable.close(() => resolve()));
    }
  });
});

describe('containerClientFromEnv with malformed settings', () => {
  it('turns a malformed connection string into a configuration error', () => {
    expect(() => containerClientFromEnv({ AZURE_STORAGE_CONNECTION_STRING: 'not a connection string' })).toThrow(ConfigError);
  });

  it('turns a malformed SAS URL into a configuration error without echoing the signature', () => {
    let error: unknown;
    try {
      containerClientFromEnv({ AZURE_STORAGE_CONTAINER_SAS_URL: '::not a url::?sv=1&sig=FAKESIGNATURE' });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).not.toContain('FAKESIGNATURE');
  });
});
