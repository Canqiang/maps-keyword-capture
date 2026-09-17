import { DefaultAzureCredential } from '@azure/identity';
import { AnonymousCredential, BlobServiceClient, ContainerClient, RestError, type StoragePipelineOptions } from '@azure/storage-blob';
import { ConfigError } from '../config.js';
import type { BlobGateway } from './blob-gateway.js';
import { redactSecrets } from './redact.js';

export const DEFAULT_CONTAINER = 'maps-keyword-capture';

/**
 * Bounds on every blob call. `callTimeoutMs` is the client-side bound: an abort signal on each
 * upload or download, covering all of its tries. The SDK's `tryTimeoutInMs` (from `tryTimeoutMs`)
 * is only the server-side operation timeout sent with each request; it does not cut off a stalled
 * connection.
 */
export interface GatewayLimits { callTimeoutMs: number; maxTries: number; tryTimeoutMs: number; retryDelayMs: number; maxRetryDelayMs: number }

/**
 * SIGTERM worst case against a stalled account: the in-flight round, the browser close (capped at
 * 10 s), two failed persists before the store fast-fails (each can spend 15 s on the upload and,
 * if the upload succeeded, another 15 s on a stalled read-back), and the final manifest's one
 * attempt with its read-back (15 s each): about 100 s plus the round, inside the Job's 120 s grace.
 */
export const DEFAULT_GATEWAY_LIMITS: GatewayLimits = { callTimeoutMs: 15_000, maxTries: 3, tryTimeoutMs: 10_000, retryDelayMs: 500, maxRetryDelayMs: 2_000 };

function pipelineOptions(limits: GatewayLimits): StoragePipelineOptions {
  return {
    retryOptions: {
      maxTries: limits.maxTries,
      tryTimeoutInMs: limits.tryTimeoutMs,
      retryDelayInMs: limits.retryDelayMs,
      maxRetryDelayInMs: limits.maxRetryDelayMs,
    },
  };
}

/**
 * Pod: AZURE_STORAGE_CONTAINER_SAS_URL (container-scoped SAS from a Secret).
 * Tests: AZURE_STORAGE_CONNECTION_STRING (Azurite).
 * Local: AZURE_STORAGE_ACCOUNT_URL with `az login`, through DefaultAzureCredential.
 * AZURE_STORAGE_CONTAINER overrides the container for the last two.
 * A setting the SDK cannot parse is a configuration error, with any secret redacted from the message.
 */
export function containerClientFromEnv(env: NodeJS.ProcessEnv, limits: GatewayLimits = DEFAULT_GATEWAY_LIMITS): ContainerClient {
  const options = pipelineOptions(limits);
  let source = 'the storage settings';
  try {
    const sasUrl = env['AZURE_STORAGE_CONTAINER_SAS_URL'];
    if (sasUrl) {
      source = 'AZURE_STORAGE_CONTAINER_SAS_URL';
      return new ContainerClient(sasUrl, new AnonymousCredential(), options);
    }
    const container = env['AZURE_STORAGE_CONTAINER'] || DEFAULT_CONTAINER;
    const connectionString = env['AZURE_STORAGE_CONNECTION_STRING'];
    if (connectionString) {
      source = 'AZURE_STORAGE_CONNECTION_STRING';
      return BlobServiceClient.fromConnectionString(connectionString, options).getContainerClient(container);
    }
    const accountUrl = env['AZURE_STORAGE_ACCOUNT_URL'];
    if (accountUrl) {
      source = 'AZURE_STORAGE_ACCOUNT_URL';
      return new BlobServiceClient(accountUrl, new DefaultAzureCredential(), options).getContainerClient(container);
    }
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(redactSecrets(`${source} is not usable: ${err instanceof Error ? err.message : String(err)}`));
  }
  throw new ConfigError('--storage azure needs AZURE_STORAGE_CONTAINER_SAS_URL, AZURE_STORAGE_CONNECTION_STRING, or AZURE_STORAGE_ACCOUNT_URL (with az login)');
}

export class AzureBlobGateway implements BlobGateway {
  readonly description: string;
  private readonly container: ContainerClient;
  private readonly limits: GatewayLimits;

  constructor(container: ContainerClient, limits: GatewayLimits = DEFAULT_GATEWAY_LIMITS) {
    this.container = container;
    this.limits = limits;
    this.description = container.url.split('?')[0] ?? container.url;
  }

  async createIfAbsent(key: string, data: Buffer, contentType: string): Promise<'created' | 'exists'> {
    const abortSignal = AbortSignal.timeout(this.limits.callTimeoutMs);
    try {
      await this.container.getBlockBlobClient(key).upload(data, data.byteLength, {
        abortSignal,
        conditions: { ifNoneMatch: '*' },
        blobHTTPHeaders: { blobContentType: contentType },
      });
      return 'created';
    } catch (err) {
      if (!abortSignal.aborted && err instanceof RestError && (err.statusCode === 409 || err.statusCode === 412)) return 'exists';
      throw this.describeError(err, abortSignal, 'create', key);
    }
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const abortSignal = AbortSignal.timeout(this.limits.callTimeoutMs);
    try {
      await this.container.getBlockBlobClient(key).upload(data, data.byteLength, { abortSignal, blobHTTPHeaders: { blobContentType: contentType } });
    } catch (err) {
      throw this.describeError(err, abortSignal, 'put', key);
    }
  }

  async get(key: string): Promise<Buffer> {
    const abortSignal = AbortSignal.timeout(this.limits.callTimeoutMs);
    try {
      return await this.container.getBlockBlobClient(key).downloadToBuffer(0, undefined, { abortSignal });
    } catch (err) {
      throw this.describeError(err, abortSignal, 'get', key);
    }
  }

  private describeError(err: unknown, abortSignal: AbortSignal, action: string, key: string): Error {
    if (abortSignal.aborted) return new Error(redactSecrets(`${action} ${key} failed: timed out after ${this.limits.callTimeoutMs} ms`));
    const status = err instanceof RestError && err.statusCode !== undefined ? ` (HTTP ${err.statusCode}${err.code ? ` ${err.code}` : ''})` : '';
    const message = err instanceof Error ? err.message : String(err);
    return new Error(redactSecrets(`${action} ${key} failed${status}: ${message}`));
  }
}
