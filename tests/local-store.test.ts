import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalArtifactStore } from '../src/storage/local.js';
import { sha256Hex } from '../src/ids.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mkc-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('LocalArtifactStore', () => {
  it('writes nested files atomically and reports size and hash', async () => {
    const store = new LocalArtifactStore(root);
    const written = await store.writeFile('a/b/c.txt', 'hello');
    expect(written).toEqual({ relativePath: 'a/b/c.txt', bytes: 5, sha256: sha256Hex('hello') });
    expect(await readFile(join(root, 'a/b/c.txt'), 'utf8')).toBe('hello');
    expect((await readdir(join(root, 'a/b'))).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('overwrites on rewrite and reports local_only persistence', async () => {
    const store = new LocalArtifactStore(root);
    await store.writeFile('m.json', '{"a":1}');
    const second = await store.writeFile('m.json', '{"a":2}');
    expect(await readFile(join(root, 'm.json'), 'utf8')).toBe('{"a":2}');
    expect(await store.persist(second)).toEqual({ storageStatus: 'local_only', objectKey: null, verifiedAt: null, storageError: null });
    expect(store.mode).toBe('local_only');
  });

  it('removes the temp file when the final write cannot complete', async () => {
    const store = new LocalArtifactStore(root);
    await mkdir(join(root, 'blocked.txt'), { recursive: true }); // a directory where the file should go
    await expect(store.writeFile('blocked.txt', 'x')).rejects.toThrow();
    expect((await readdir(root)).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });
});
