import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/domain/cli.js';
import { MongoTrackingRepository } from '../src/domain/repository.js';
import { MongoObservationStore } from '../src/domain/observation-store.js';
import { parseTrackingConfig, planScan, toAndroidRuns, withStores } from '../src/domain/tracking-config.js';
import { parseAndroidConfig } from '../src/android/config.js';

const raw = JSON.parse(await readFile(new URL('../docs/tracking-config.example.json', import.meta.url), 'utf8'));
afterEach(() => vi.restoreAllMocks());
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'tracking-command-'));
  const config = join(dir, 'config.json');
  await writeFile(config, JSON.stringify({ ...raw, stores: [], storeSource: { provider: 'mongo' } }));
  const listed = vi.spyOn(MongoTrackingRepository.prototype, 'listStores').mockResolvedValue(parseTrackingConfig(raw).stores.map(store => ({ ...store, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z' })));
  vi.spyOn(MongoTrackingRepository.prototype, 'close').mockResolvedValue();
  vi.spyOn(MongoObservationStore.prototype, 'upsert').mockImplementation(async rows => ({ inserted: rows.length, updated: 0 }));
  vi.spyOn(MongoObservationStore.prototype, 'close').mockResolvedValue();
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return { dir, listed, output, args: ['--config', config, '--mongo-uri-env', 'TEST_MONGO'], env: { TEST_MONGO: 'mongodb://unused' } };
}
describe('database-backed tracking commands', () => {
  it('loads fresh store catalog before Android planning', async () => {
    const s = await setup();
    expect(await main(['plan', ...s.args, '--surface', 'android', '--tier', 'point'], s.env)).toBe(0);
    expect(s.listed).toHaveBeenCalledOnce();
    expect(JSON.parse(s.output.mock.calls.at(-1)![0]).count).toBe(3);
  });
  it('accepts the documented valueless --list flag', async () => {
    const s = await setup();
    expect(await main(['stores', ...s.args, '--list'], s.env)).toBe(0);
    expect(s.listed).toHaveBeenCalledWith({ includeInactive: true });
    expect(JSON.parse(s.output.mock.calls.at(-1)![0])[0].storeId).toBe(raw.stores[0].storeId);
  });
  it('resolves a Mongo store before re-ingesting a Web batch', async () => {
    const s = await setup();
    await writeFile(join(s.dir, 'manifest.json'), JSON.stringify({ runId: 'run1', attemptId: 'att1', persistenceMode: 'local_only', startedAt: '2026-10-20T00:00:00Z', metadata: {}, artifacts: [], queries: [{ queryId: 'q1', inputIndex: 0, keyword: 'braised food', status: 'skipped', stopReason: 'cancelled', selectedQueryAttemptId: null, attempts: [], resultFile: null, artifactIds: [], persistenceStatus: 'not_requested' }] }));
    expect(await main(['ingest', ...s.args, '--surface', 'web', '--store-id', raw.stores[0].storeId, '--batch-dir', s.dir], s.env)).toBe(0);
    expect(s.listed).toHaveBeenCalledWith({ includeInactive: true });
    expect(vi.mocked(MongoObservationStore.prototype.upsert).mock.calls[0]![0]).toHaveLength(1);
  });
  it('resolves historical stores for Android ingestion without applying scan shards', async () => {
    const s = await setup();
    const manifest = join(s.dir, 'manifest.json');
    await writeFile(manifest, JSON.stringify({ runId: 'r1', persistenceMode: 'local_only', startedAt: '2026-10-20T00:00:00Z', queries: [{ queryId: 'q1', storeId: raw.stores[0].storeId, keyword: 'braised food', location: { id: 'r0c0', ...raw.stores[0].center }, rankingStatus: 'not_evaluated', organicRank: null, displayPosition: null, listingStatus: 'partial', evidenceStatus: 'captured', stopReason: null, listings: [], screens: [], locationScreen: null }] }));
    expect(await main(['ingest', ...s.args, '--surface', 'android', '--manifest', manifest], { ...s.env, JOB_COMPLETION_INDEX: '99' })).toBe(0);
    expect(s.listed).toHaveBeenCalledWith({ includeInactive: true });
    const rows = vi.mocked(MongoObservationStore.prototype.upsert).mock.calls[0]![0];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.storeId).toBe(raw.stores[0].storeId);
  });
});
describe('manual ingestion delivery boundary', () => {
  it.each(['web', 'android'])('rejects unverified Azure %s evidence before opening the observation sink', async surface => {
    const s = await setup();
    await writeFile(join(s.dir, 'manifest.json'), JSON.stringify({ schemaVersion: '1', runId: 'run1', attemptId: 'att1', persistenceMode: 'azure_blob', startedAt: '2026-10-20T00:00:00Z', metadata: {}, artifacts: [], queries: [] }));
    const source = surface === 'web' ? ['--batch-dir', s.dir, '--store-id', raw.stores[0].storeId] : ['--manifest', join(s.dir, 'manifest.json')];
    expect(await main(['ingest', ...s.args, '--surface', surface, ...source], s.env)).not.toBe(0);
    expect(MongoObservationStore.prototype.upsert).not.toHaveBeenCalled();
  });
  it.each([false, true])('checks imported result bytes against the verified selected artifact (modified=%s)', async modified => {
    const s = await setup();
    const certified = JSON.stringify({ runId: 'run1', attemptId: 'att1', queryId: 'q1', queryAttemptId: 'qa01', keyword: 'food', startedAt: '2026-10-20T00:00:00Z', status: 'captured', stopReason: 'end_of_results', sequenceVerified: true, context: { locationMode: 'map_view', configuredMapView: { ...raw.stores[0].center, zoom: 15 } }, quality: { classificationComplete: true, screenshotCoverageComplete: true, verifiedPrefixLength: 1, resultSurface: 'results_list', warnings: [] }, listings: [{ displayPosition: 1, organicRank: 1, resultType: 'organic', placeId: raw.stores[0].placeId, name: 'Keke', mapsUrl: null }], screenshots: [] });
    await writeFile(join(s.dir, 'result.json'), modified ? certified.replace('"organicRank":1', '"organicRank":2') : certified);
    const manifest = { schemaVersion: '1', runId: 'run1', attemptId: 'att1', persistenceMode: 'azure_blob', startedAt: '2026-10-20T00:00:00Z', metadata: {}, artifacts: [{ id: 'result', queryId: 'q1', queryAttemptId: 'qa01', kind: 'result_json', filename: 'result.json', bytes: Buffer.byteLength(certified), sha256: createHash('sha256').update(certified).digest('hex'), storageStatus: 'verified', objectKey: 'tracking/web/run1/result.json' }], queries: [{ queryId: 'q1', inputIndex: 0, keyword: 'food', status: 'captured', stopReason: 'end_of_results', selectedQueryAttemptId: 'qa01', attempts: [], resultFile: 'result.json', artifactIds: ['result'], persistenceStatus: 'verified' }] };
    const bytes = JSON.stringify(manifest);
    await writeFile(join(s.dir, 'manifest.json'), bytes);
    await writeFile(join(s.dir, 'receipt.json'), JSON.stringify({ runId: 'run1', attemptId: 'att1', storageStatus: 'verified', objectKey: 'tracking/web/run1/manifest.json', verifiedAt: '2026-10-20T00:00:01Z', storageError: null, bytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') }));
    const code = await main(['ingest', ...s.args, '--surface', 'web', '--batch-dir', s.dir, '--store-id', raw.stores[0].storeId, '--manifest-receipt', join(s.dir, 'receipt.json')], s.env);
    expect(code).toBe(modified ? 64 : 0);
    expect(vi.mocked(MongoObservationStore.prototype.upsert).mock.calls.length).toBe(modified ? 0 : 1);
  });
  it.each(['verified', 'wrong_hash', 'failed_query'])('requires a matching verified manifest receipt (%s)', async state => {
    const s = await setup();
    const manifest = { schemaVersion: '1', runId: 'run1', attemptId: 'att1', persistenceMode: 'azure_blob', startedAt: '2026-10-20T00:00:00Z', metadata: {}, artifacts: [], queries: [{ queryId: 'q1', inputIndex: 0, keyword: 'food', status: 'captured', stopReason: 'end_of_results', selectedQueryAttemptId: 'qa01', attempts: [], resultFile: 'missing.json', artifactIds: [], persistenceStatus: state === 'failed_query' ? 'failed' : 'verified' }] };
    const bytes = JSON.stringify(manifest);
    await writeFile(join(s.dir, 'manifest.json'), bytes);
    const receipt = { runId: 'run1', attemptId: 'att1', filename: 'manifest.json', storageStatus: 'verified', objectKey: 'tracking/web/run1/manifest.json', verifiedAt: '2026-10-20T00:00:01Z', storageError: null, bytes: Buffer.byteLength(bytes), sha256: state === 'wrong_hash' ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex') };
    await writeFile(join(s.dir, 'receipt.json'), JSON.stringify(receipt));
    const code = await main(['ingest', ...s.args, '--surface', 'web', '--batch-dir', s.dir, '--store-id', raw.stores[0].storeId, '--manifest-receipt', join(s.dir, 'receipt.json')], s.env);
    expect(code).toBe(state === 'verified' ? 0 : 64);
    expect(vi.mocked(MongoObservationStore.prototype.upsert).mock.calls.length).toBe(state === 'verified' ? 1 : 0);
  });
});
describe('tracking planner contracts', () => {
  it.each(['braised  food', 'ｂｒａｉｓｅｄ food'])('rejects normalized duplicate keyword %s', duplicate => {
    const store = { ...raw.stores[0], keywords: { core: ['braised food'], longTail: [duplicate] } };
    expect(() => parseTrackingConfig({ ...raw, stores: [store] })).toThrow(/repeats/);
  });
  it.each([{ storeId: 'a'.repeat(102) }, { name: 'a'.repeat(501) }, { keywords: { core: ['braised\nfood'], longTail: [] } }])('rejects store values that cannot be sent to Android', extra => {
    expect(() => parseTrackingConfig({ ...raw, stores: [{ ...raw.stores[0], ...extra }] })).toThrow();
  });
  it('validates stores returned by the database too', () => {
    expect(() => withStores(parseTrackingConfig(raw), [{ ...raw.stores[0], center: { latitude: 999, longitude: 0 } }])).toThrow();
  });
  it('emits valid Android grid tasks in every 20-task chunk', () => {
    const config = parseTrackingConfig(raw);
    const runs = toAndroidRuns(planScan(config, { surface: 'android', tier: 'grid' }), config);
    expect(runs.map(run => run.length)).toEqual([20, 20, 20, 15]);
    for (const tasks of runs) expect(() => parseAndroidConfig({ schemaVersion: 'android-maps-input/v1', serial: 'emulator-5554', tasks })).not.toThrow();
  });
});
