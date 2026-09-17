import { readFile } from 'node:fs/promises';
import type { StorageState } from '../contracts.js';
import { sha256Hex } from '../ids.js';
import type { BlobGateway } from './blob-gateway.js';
import { contentTypeFor } from './blob-gateway.js';
import type { LocalArtifactStore } from './local.js';
import { redactSecrets } from './redact.js';
import type { ArtifactStore, PersistOptions, WrittenFile } from './types.js';

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** After this many persists in a row end in upload_failed, storage is treated as down and later persists skip the gateway. */
export const UPLOAD_FAILURE_LIMIT = 2;
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
 * Once storage is clearly down (UPLOAD_FAILURE_LIMIT upload failures in a row), later persists fail
 * fast as storage_unavailable so a stalled account cannot eat the shutdown grace period.
 */
export class RemoteArtifactStore implements ArtifactStore {
  readonly mode = 'azure_blob' as const;
  readonly gateway: BlobGateway;
  private readonly local: LocalArtifactStore;
  private consecutiveUploadFailures = 0;

  constructor(opts: { gateway: BlobGateway; local: LocalArtifactStore }) {
    this.gateway = opts.gateway;
    this.local = opts.local;
  }

  get rootDirectory(): string { return this.local.rootDirectory; }

  absolutePath(relativePath: string): string { return this.local.absolutePath(relativePath); }

  writeFile(relativePath: string, data: Buffer | string): Promise<WrittenFile> { return this.local.writeFile(relativePath, data); }

  async persist(file: WrittenFile, options: PersistOptions = {}): Promise<StorageState> {
    const objectKey = objectKeyFor(file.relativePath);
    if (this.consecutiveUploadFailures >= UPLOAD_FAILURE_LIMIT && !options.alwaysAttempt) {
      return failed(objectKey, 'storage_unavailable', 'skipped after repeated upload failures');
    }
    const state = await this.deliver(file, objectKey, options);
    // Only verified resets the count; other failures (conflict, read-back mismatch, local change) neither count nor reset.
    if (state.storageStatus === 'verified') this.consecutiveUploadFailures = 0;
    else if (state.storageStatus === 'failed' && state.storageError.code === 'upload_failed') this.consecutiveUploadFailures += 1;
    return state;
  }

  private async deliver(file: WrittenFile, objectKey: string, options: PersistOptions): Promise<StorageState> {
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
