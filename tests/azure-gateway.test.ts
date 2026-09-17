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
