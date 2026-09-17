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
