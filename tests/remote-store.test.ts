import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalArtifactStore } from '../src/storage/local.js';
import { objectKeyFor, PNG_SIGNATURE, RemoteArtifactStore } from '../src/storage/remote.js';
import { FakeGateway } from './helpers/fake-gateway.js';

let root: string;
let gateway: FakeGateway;
let store: RemoteArtifactStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mkc-remote-'));
  gateway = new FakeGateway();
  store = new RemoteArtifactStore({ gateway, local: new LocalArtifactStore(root) });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const rel = 'maps-keyword-capture/2026-09-17/run_1/att_1/q0001/qa01/r.json';
const png = Buffer.concat([PNG_SIGNATURE, Buffer.from('image-bytes')]);

describe('objectKeyFor', () => {
  it('drops the product folder because the container already names it', () => {
    expect(objectKeyFor(rel)).toBe('2026-09-17/run_1/att_1/q0001/qa01/r.json');
    expect(objectKeyFor('other/x.json')).toBe('other/x.json');
  });
});

describe('RemoteArtifactStore', () => {
  it('stages locally, uploads once, reads back, and reports verified', async () => {
    const written = await store.writeFile(rel, '{"ok":true}');
    const state = await store.persist(written);
    expect(state).toMatchObject({ storageStatus: 'verified', objectKey: '2026-09-17/run_1/att_1/q0001/qa01/r.json', storageError: null });
    expect(Date.parse((state as { verifiedAt: string }).verifiedAt)).not.toBeNaN();
    expect(gateway.objects.get('2026-09-17/run_1/att_1/q0001/qa01/r.json')!.toString()).toBe('{"ok":true}');
    expect(gateway.calls).toEqual(['create 2026-09-17/run_1/att_1/q0001/qa01/r.json', 'get 2026-09-17/run_1/att_1/q0001/qa01/r.json']);
    expect(store.mode).toBe('azure_blob');
    expect(store.absolutePath(rel)).toBe(join(root, ...rel.split('/')));
  });

  it('treats an existing identical object as verified and a different one as a conflict', async () => {
    const written = await store.writeFile(rel, 'same');
    gateway.objects.set(objectKeyFor(rel), Buffer.from('same'));
    expect((await store.persist(written)).storageStatus).toBe('verified');
    gateway.objects.set(objectKeyFor(rel), Buffer.from('different'));
    expect(await store.persist(written)).toMatchObject({ storageStatus: 'failed', storageError: { code: 'object_conflict' } });
    expect(gateway.objects.get(objectKeyFor(rel))!.toString()).toBe('different');
  });

  it('fails on a read-back mismatch and on a PNG without its signature', async () => {
    const written = await store.writeFile(rel, 'payload');
    gateway.corruptGet = () => true;
    expect(await store.persist(written)).toMatchObject({ storageStatus: 'failed', storageError: { code: 'readback_mismatch' } });

    gateway.corruptGet = () => false;
    const notPng = await store.writeFile('maps-keyword-capture/2026-09-17/run_1/att_1/q0001/qa01/shot__01.png', 'not a png');
    expect(await store.persist(notPng)).toMatchObject({ storageStatus: 'failed', storageError: { code: 'readback_not_png' } });
    const realPng = await store.writeFile('maps-keyword-capture/2026-09-17/run_1/att_1/q0001/qa01/shot__02.png', png);
    expect((await store.persist(realPng)).storageStatus).toBe('verified');
  });

  it('returns a failed state with a redacted message instead of throwing', async () => {
    const written = await store.writeFile(rel, 'payload');
    gateway.failOn = (op) => op === 'create';
    const state = await store.persist(written);
    expect(state).toMatchObject({ storageStatus: 'failed', objectKey: objectKeyFor(rel), verifiedAt: null, storageError: { code: 'upload_failed' } });
    expect(JSON.stringify(state)).not.toContain('SECRET');
    expect(JSON.stringify(state)).toContain('sig=REDACTED');
  });

  it('refuses to upload a local file that no longer matches what was written', async () => {
    const written = await store.writeFile(rel, 'original');
    await writeFile(store.absolutePath(rel), 'tampered');
    expect(await store.persist(written)).toMatchObject({ storageStatus: 'failed', storageError: { code: 'local_changed' } });
    expect(gateway.calls).toEqual([]);
  });

  it('overwrites only when asked, for the progress manifest', async () => {
    const progress = 'maps-keyword-capture/2026-09-17/run_1/att_1/manifest.progress.json';
    const v1 = await store.writeFile(progress, 'v1');
    expect((await store.persist(v1, { mutable: true })).storageStatus).toBe('verified');
    const v2 = await store.writeFile(progress, 'v2');
    expect((await store.persist(v2, { mutable: true })).storageStatus).toBe('verified');
    expect(gateway.objects.get(objectKeyFor(progress))!.toString()).toBe('v2');
    expect(gateway.calls.filter((c) => c.startsWith('put'))).toHaveLength(2);
  });
});
