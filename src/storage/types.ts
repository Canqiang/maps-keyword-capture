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
