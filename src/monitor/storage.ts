import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hashJson, sha256Hex } from '../ids.js';
import type { BlobGateway } from '../storage/blob-gateway.js';
import type { ArtifactStore, PersistOptions, WrittenFile } from '../storage/types.js';

export interface DailyClaim { schemaVersion: '1'; runKey: string; date: string; dailyRunId: string; startedAt: string; configHash: string }
export interface ClaimResult { status: 'created' | 'exists'; key: string; claim: DailyClaim }
export type AtomicClaim = (claim: DailyClaim) => Promise<ClaimResult>;
export function createAtomicClaim(gateway: Pick<BlobGateway, 'createIfAbsent' | 'get'>): AtomicClaim {
  return async claim => {
    const key = `claims/${claim.runKey}.json`;
    const bytes = Buffer.from(JSON.stringify(claim));
    const status = await gateway.createIfAbsent(key, bytes, 'application/json');
    const stored = await gateway.get(key);
    if (status === 'created' && sha256Hex(stored) !== sha256Hex(bytes)) throw new Error('claim_readback_mismatch');
    const prior = JSON.parse(stored.toString()) as DailyClaim;
    if (prior.schemaVersion !== '1' || prior.runKey !== claim.runKey || typeof prior.dailyRunId !== 'string' || typeof prior.configHash !== 'string') throw new Error('claim_invalid');
    return { status, key, claim: prior };
  };
}
/** Local development uses the same exclusive claim semantics; claims survive failed cycles. */
export function createLocalAtomicClaim(store: ArtifactStore): AtomicClaim {
  return createAtomicClaim({
    async createIfAbsent(key, data) {
      const path = store.absolutePath(key);
      await mkdir(dirname(path), { recursive: true });
      let file;
      try { file = await open(path, 'wx'); }
      catch (err) { if ((err as NodeJS.ErrnoException).code === 'EEXIST') return 'exists'; throw err; }
      try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
      return 'created';
    },
    get(key) { return readFile(store.absolutePath(key)); },
  });
}
/** Preserve the collector's run/attempt IDs and filenames under a dated store/batch prefix. */
export class NamespacedBatchStore implements ArtifactStore {
  constructor(private readonly base: ArtifactStore, readonly prefix: string) {
    if (!/^[a-zA-Z0-9_/-]+$/.test(prefix) || prefix.startsWith('/') || prefix.includes('//')) throw new Error('unsafe batch prefix');
  }
  get mode() { return this.base.mode; }
  get rootDirectory() { return this.base.absolutePath(this.prefix); }
  private map(relative: string): string {
    const match = /^maps-keyword-capture\/\d{4}-\d{2}-\d{2}\/(.+)$/.exec(relative);
    if (!match || match[1]!.split('/').some(p => p === '.' || p === '..' || p === '') || relative.includes('\\')) throw new Error('invalid batch artifact path');
    return `${this.prefix}/${match[1]}`;
  }
  absolutePath(relative: string) { return this.base.absolutePath(this.map(relative)); }
  writeFile(relative: string, data: Buffer | string): Promise<WrittenFile> { return this.base.writeFile(this.map(relative), data); }
  persist(file: WrittenFile, options?: PersistOptions) { return this.base.persist(file, options); }
}
export function batchIdFor(index: number, keywords: string[]): string { return `b${String(index + 1).padStart(2, '0')}-${hashJson(keywords).slice(0, 12)}`; }
