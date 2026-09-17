import type { StorageState } from '../contracts.js';
export interface WrittenFile { relativePath: string; bytes: number; sha256: string }
export interface ArtifactStore {
  readonly mode: 'local_only' | 'azure_blob';
  readonly rootDirectory: string;
  /** Atomic local write (temp file + rename). relativePath uses forward slashes. */
  writeFile(relativePath: string, data: Buffer | string): Promise<WrittenFile>;
  /** Local mode never uploads; returns the local_only state. */
  persist(file: WrittenFile): Promise<StorageState>;
}
