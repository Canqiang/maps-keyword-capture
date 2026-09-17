import { mkdir, open, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import type { StorageState } from '../contracts.js';
import { sha256Hex } from '../ids.js';
import type { ArtifactStore, PersistOptions, WrittenFile } from './types.js';

export class LocalArtifactStore implements ArtifactStore {
  readonly mode = 'local_only' as const;
  readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = resolve(rootDirectory);
  }

  absolutePath(relativePath: string): string {
    return join(this.rootDirectory, ...relativePath.split('/'));
  }

  async writeFile(relativePath: string, data: Buffer | string): Promise<WrittenFile> {
    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const finalPath = this.absolutePath(relativePath);
    await mkdir(dirname(finalPath), { recursive: true });
    const tmpPath = `${finalPath}.tmp-${randomBytes(4).toString('hex')}`;
    try {
      const handle = await open(tmpPath, 'wx');
      try {
        await handle.writeFile(buffer);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tmpPath, finalPath);
    } catch (err) {
      await rm(tmpPath, { force: true });
      throw err;
    }
    return { relativePath, bytes: buffer.byteLength, sha256: sha256Hex(buffer) };
  }

  async persist(_file: WrittenFile, _options?: PersistOptions): Promise<StorageState> {
    return { storageStatus: 'local_only', objectKey: null, verifiedAt: null, storageError: null };
  }
}
