import { mkdir, readFile, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashJson, newRunId, queryIdFor, sha256Hex } from '../ids.js';
import { dateFolder, keywordSlug } from '../naming.js';
import type { CaptureError, StorageState } from '../contracts.js';
import type { ArtifactStore, WrittenFile } from '../storage/types.js';
import type { AndroidArtifact, AndroidCaptureConfig, AndroidDevice, AndroidDeviceInfo, AndroidTask, LocationEvidence, NativeScreen, NativeScrollEvidence, ScreenAnalysis } from './contracts.js';
import { analyzeScreen, hasBlankNativeSearchWrapper, inspectNativeResultList, parseUiNodes } from './ui.js';
import { hasMeasuredScreenProgress, matchTarget, onlyPendingLowConfidence, parseScreenFrame, reconcileScreenFrames, recognizeScreen, targetAliases, validateScreenOcr, type RankedListing, type ScreenFrame, type ScreenRecognizer, type TargetMatch } from './screen-reader.js';

export type AndroidManifestReceipt = StorageState & WrittenFile;
export interface AndroidScreenEvidence {
  png: AndroidArtifact; xml: AndroidArtifact; width: number; height: number;
  capturedAt: string; role: 'capture' | 'diagnostic' | 'location'; analysis: ScreenAnalysis;
  frameId?: string; ocr?: AndroidArtifact; screenFrame?: AndroidArtifact; cardsRecognized?: number;
  /** Set when a backward correction removed this frame from the reconciled sequence; the evidence stays. */
  discarded?: 'ordered_overlap_missing';
}
export interface AndroidListingQuality {
  adCount: number; organicCount: number; unknownCount: number; rankingReliable: boolean; frames: number; warnings: string[];
  sequenceVerified?: boolean; classificationComplete?: boolean; screenshotCoverageComplete?: boolean; organicCoverage?: number; endOfResults?: boolean; truncatedCount?: number;
}
export interface AndroidQueryEvidence extends AndroidTask {
  queryId: string;
  /** One fresh captured frame may replace stale pre-gesture evidence. Historical manifests omit this field. */
  nativeFrameRefreshes?: Array<{ reason: 'source_changed'; afterFrameId: string; refreshFrameId: string | null }>;
  /** Backward corrections after a missing ordered overlap: the discarded frame and the last kept frame. */
  nativeFrameCorrections?: Array<{ reason: 'ordered_overlap_missing'; afterFrameId: string; discardedFrameId: string }>;
  /** ranked: the target was found; not_found: a complete list without it; not_found_in_prefix: a partial list without it. */
  rankingStatus: 'ranked' | 'not_found' | 'not_found_in_prefix' | 'not_evaluated';
  organicRank: number | null; displayPosition: number | null;
  targetMatch: TargetMatch | null; targetMatches: TargetMatch[]; targetAliases: string[];
  listingStatus: 'not_evaluated' | 'complete' | 'partial' | 'non_ranking';
  listings: RankedListing[]; listingQuality: AndroidListingQuality | null;
  evidenceStatus: 'captured' | 'needs_review' | 'failed' | 'skipped';
  locationEvidence: LocationEvidence | null;
  locationScreen: AndroidScreenEvidence | null;
  screens: AndroidScreenEvidence[];
  error: CaptureError | null;
  stopReason: string | null;
}
export interface AndroidCaptureManifest {
  schemaVersion: 'android-maps-manifest/v1'; runId: string; prefix: string;
  surface: 'google_maps_android_app'; adapterVersion: 'android-screen-ocr/v4'; profileHash: string | null;
  startedAt: string; finishedAt: string;
  executionStatus: 'completed' | 'needs_review' | 'failed';
  persistenceMode: ArtifactStore['mode']; device: AndroidDeviceInfo | null;
  rankingStatus: 'evaluated'; mapsLocationStatus: 'unverified';
  queries: AndroidQueryEvidence[]; artifacts: AndroidArtifact[];
  counts: { total: number; captured: number; needsReview: number; failed: number; skipped: number; screenshots: number; locationScreenshots: number; completeListingQueries: number; partialListingQueries: number; rankedQueries: number; listings: number; ads: number; organic: number; unknown: number };
  errors: CaptureError[];
  evidenceLimits: string[];
}
export interface AndroidCaptureOutput { manifest: AndroidCaptureManifest; receipt: AndroidManifestReceipt; exitCode: 0 | 2; cancelled: boolean }
export interface AndroidRunOptions { signal?: AbortSignal; screenRecognizer?: ScreenRecognizer }

class CaptureFailure extends Error {
  constructor(readonly code: string) { super(code); }
}

/** A shared per-serial lease, independent of output directories. Stale leases are never stolen. */
export async function acquireDeviceLease(serial: string): Promise<() => Promise<void>> {
  const directory = join(tmpdir(), `maps-keyword-capture-android-${sha256Hex(serial).slice(0, 32)}.lock`);
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new CaptureFailure('device_busy');
    throw new CaptureFailure('device_lease_failed');
  }
  const identity = await stat(directory);
  const owner = `${process.pid}:${randomUUID()}`;
  const ownerFile = join(directory, 'owner');
  try { await writeFile(ownerFile, owner, { flag: 'wx', mode: 0o600 }); }
  catch { await rmdir(directory).catch(() => undefined); throw new CaptureFailure('device_lease_failed'); }
  let released = false;
  return async () => {
    if (released) return;
    // Do not recursively remove a replaced directory or another worker's lease.
    const current = await stat(directory);
    if (current.dev !== identity.dev || current.ino !== identity.ino || await readFile(ownerFile, 'utf8') !== owner) {
      throw new CaptureFailure('device_lease_owner_changed');
    }
    await unlink(ownerFile);
    await rmdir(directory);
    released = true;
  };
}

/** Backward corrections a query may spend when a forward gesture skipped content (probe 6/7 page-boundary jump). */
const MAX_OVERLAP_CORRECTIONS = 2;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let result = value;
  for (let i = 0; i < 8; i++) result = result & 1 ? 0xedb88320 ^ (result >>> 1) : result >>> 1;
  return result >>> 0;
});
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Checks bounded PNG framing, chunk CRCs and dimensions; does not render or decode pixels. */
function pngDimensions(bytes: Buffer): { width: number; height: number } {
  const invalid = (): never => { throw new CaptureFailure('invalid_png'); };
  if (bytes.length < 57 || bytes.length > 16 * 1024 * 1024 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) invalid();
  let offset = 8, chunks = 0, width = 0, height = 0, idatBytes = 0;
  let ended = false, palette = false, color = -1, afterIdat = false;
  while (offset < bytes.length) {
    if (++chunks > 4096 || offset + 12 > bytes.length) invalid();
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) invalid();
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) invalid();
    if (chunks === 1 && (type !== 'IHDR' || length !== 13)) invalid();
    if (type === 'IHDR') {
      if (chunks !== 1 || length !== 13) invalid();
      width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12);
      const depth = bytes[offset + 16]!; color = bytes[offset + 17]!;
      const validDepths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (width < 1 || height < 1 || width > 10_000 || height > 10_000 || width * height > 40_000_000 ||
        !validDepths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || ![0, 1].includes(bytes[offset + 20]!)) invalid();
    } else if (type === 'PLTE') {
      if (palette || idatBytes || !length || length > 768 || length % 3 || [0, 4].includes(color)) invalid();
      palette = true;
    } else if (type === 'IDAT') {
      if (afterIdat || (color === 3 && !palette)) invalid();
      idatBytes += length;
    } else if (type === 'IEND') {
      if (length !== 0 || !idatBytes || end !== bytes.length) invalid();
      ended = true;
    } else {
      if (type[0] === type[0]!.toUpperCase()) invalid(); // Unknown critical chunk.
      if (idatBytes) afterIdat = true;
    }
    offset = end;
  }
  if (!ended) invalid();
  return { width, height };
}

function safeError(error: unknown, fallback: string): CaptureError {
  const nativeCodes = new Set(['CANCELLED', 'QUERY_TIMEOUT', 'COMMAND_TIMEOUT', 'WRONG_FOREGROUND', 'UNKNOWN_SEARCH_LAYOUT', 'QUERY_NOT_VISIBLE', 'INVALID_SCREENSHOT', 'INVALID_UI_SOURCE', 'APPIUM_PROTOCOL_ERROR', 'ADB_COMMAND_FAILED', 'SESSION_OUTCOME_UNKNOWN', 'LIST_TOP_UNVERIFIED', 'UNKNOWN_SCROLL_LAYOUT', 'SOURCE_CHANGED', 'UNKNOWN_RESULT_SHEET', 'RESULT_SHEET_NOT_EXPANDED', 'DISPLAY_UNAVAILABLE']);
  const candidate = error !== null && typeof error === 'object' && 'code' in error ? (error as { code: unknown }).code : null;
  const code = error instanceof CaptureFailure ? error.code : typeof candidate === 'string' && nativeCodes.has(candidate) ? candidate.toLowerCase() : fallback;
  return { code, message: `Android capture stopped: ${code}. Inspect local device or storage logs for details.` };
}

function failedState(mode: ArtifactStore['mode'], path: string, code: string): StorageState {
  return { storageStatus: 'failed', objectKey: mode === 'azure_blob' ? path : null, verifiedAt: null, storageError: safeError(new CaptureFailure(code), code) };
}
function delivered(state: StorageState, mode: ArtifactStore['mode']): boolean {
  return mode === 'local_only' ? state.storageStatus === 'local_only' : state.storageStatus === 'verified';
}
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
function csvFor(queries: AndroidQueryEvidence[]): string {
  const rows: unknown[][] = [['queryId', 'storeId', 'storeName', 'keyword', 'locationId', 'latitude', 'longitude', 'evidenceStatus', 'rankingStatus', 'organicRank', 'displayPosition', 'matchedName', 'screenshots', 'deviceLocationStatus', 'mapsLocationStatus', 'sourceReference', 'errorCode', 'injectionStatus', 'viewportStatus', 'locationScreenshots', 'locationPng', 'locationXml', 'listingStatus', 'listingRows', 'stopReason']];
  for (const query of queries) rows.push([query.queryId, query.storeId, query.storeName, query.keyword, query.location.id, query.location.latitude, query.location.longitude, query.evidenceStatus, query.rankingStatus, query.organicRank, query.displayPosition, query.targetMatch?.name ?? '', query.screens.length, query.locationEvidence?.deviceLocationStatus ?? '', 'unverified', query.sourceReference, query.error?.code ?? '', query.locationEvidence?.injectionStatus ?? '', query.locationEvidence?.preparation?.viewportStatus ?? 'unverified', query.locationScreen ? 1 : 0, query.locationScreen?.png.relativePath ?? '', query.locationScreen?.xml.relativePath ?? '', query.listingStatus, query.listings.length, query.stopReason ?? '']);
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function listingsCsv(queries: AndroidQueryEvidence[]): string {
  const rows: unknown[][] = [['queryId', 'storeId', 'keyword', 'locationId', 'listingStatus', 'displayPosition', 'organicRank', 'resultType', 'adLabel', 'name', 'nameConfidence', 'rating', 'reviewCount', 'priceText', 'category', 'distanceText', 'distanceMeters', 'openText', 'isTarget', 'frameIds', 'warnings']];
  for (const q of queries) for (const row of q.listings) rows.push([q.queryId, q.storeId, q.keyword, q.location.id, q.listingStatus, row.displayPosition, row.organicRank, row.resultType, row.adLabel, row.name, row.nameConfidence, row.rating, row.reviewCount, row.priceText, row.category, row.distanceText, row.distanceMeters, row.openText, q.targetMatches.some(m => m.displayPosition === row.displayPosition) ? 1 : 0, row.frameIds.join('|'), row.warnings.join('|')]);
  return `${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** A second, screenshot-time check of the device's previously verified home/following state. */
function locationScreenFollowsDevice(xml: string, analysis: ScreenAnalysis): boolean {
  if (analysis.kind !== 'unknown' || analysis.queryVisible) return false;
  const nodes = parseUiNodes(xml).filter((node) => node.packageName === 'com.google.android.apps.maps');
  const normalize = (value: string): string => value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
  const fields = nodes.filter((node) => /:id\/search_omnibox_(?:text_box(?:_search)?|edit_text)$/.test(node.resourceId));
  if (!hasBlankNativeSearchWrapper(xml) || fields.length !== 1 || fields[0]!.bounds === null) return false;
  if (nodes.some((node) => /(?:ProgressBar|CircularProgressIndicator|LinearProgressIndicator)$/.test(node.className) ||
      /:id\/(?:search_list_layout|search_results_list|search_results|results_list)$/.test(node.resourceId))) return false;
  return nodes.some((node) => node.bounds !== null && normalize(node.description) === 'enter compass mode');
}

/** Motion support comes from the already persisted frame. It is not ranking
 * evidence until a subsequent captured frame passes ordered reconciliation. */
function scrollEvidence(frame: ScreenFrame, sourceXml: string, listBounds: NativeScrollEvidence['listBounds']): NativeScrollEvidence {
  const inside = (bounds: NonNullable<NativeScrollEvidence['listBounds']>): boolean => !!listBounds &&
    bounds.left >= listBounds.left && bounds.right <= listBounds.right && bounds.top >= listBounds.top && bounds.bottom <= listBounds.bottom;
  const anchors: NativeScrollEvidence['anchors'] = [];
  const height = listBounds ? listBounds.bottom - listBounds.top : 0;
  const minimumTitleTop = listBounds ? listBounds.top + Math.ceil(height * 0.1) + Math.max(12, Math.ceil(height * 0.02)) : Infinity;
  const actionLabels = new Set(['directions', 'call', 'menu', 'website', 'order', 'reserve', 'save', 'share']);
  for (const node of parseUiNodes(sourceXml)) {
    if (node.packageName !== 'com.google.android.apps.maps' || !node.clickable || !node.bounds || !inside(node.bounds)) continue;
    const text = [node.description, node.text].find(text => actionLabels.has(text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase()));
    if (text) anchors.push({ text, bounds: node.bounds });
  }
  const card = frame.cards.filter(card => card.name !== null && (card.nameConfidence ?? 0) >= 40 && card.resultType !== 'unknown' &&
    card.nameBounds && card.ratingBounds && inside(card.nameBounds) && inside(card.ratingBounds) && card.nameBounds.top >= minimumTitleTop &&
    card.nameBounds.bottom <= card.ratingBounds.top && card.ratingBounds.top - card.nameBounds.bottom <= 90 &&
    !card.warnings.some(warning => ['low_name_confidence', 'low_rating_confidence', 'card_header_clipped', 'name_clipped_at_top',
      'uncertain_ad_label', 'native_ad_evidence_unresolved', 'sheet_header_unverified'].includes(warning)))
    .sort((a, b) => b.nameBounds!.top - a.nameBounds!.top)[0];
  return { sourceXml, listBounds, anchors, ...(card ? { ocrScrollAnchor: { name: card.name!, nameConfidence: card.nameConfidence!,
    nameBounds: card.nameBounds!, ratingBounds: card.ratingBounds!, imageSha256: frame.imageSha256 } } : {}) };
}

export async function runAndroidCapture(config: AndroidCaptureConfig, device: AndroidDevice, store: ArtifactStore, options: AndroidRunOptions = {}): Promise<AndroidCaptureOutput> {
  const started = new Date();
  const runId = newRunId(started);
  const prefix = `android-maps/${dateFolder(started, 'Asia/Shanghai')}/${runId}`;
  const manifest: AndroidCaptureManifest = {
    schemaVersion: 'android-maps-manifest/v1', runId, prefix,
    surface: 'google_maps_android_app', adapterVersion: 'android-screen-ocr/v4', profileHash: null, startedAt: started.toISOString(), finishedAt: started.toISOString(),
    executionStatus: 'completed', persistenceMode: store.mode, device: null,
    rankingStatus: 'evaluated', mapsLocationStatus: 'unverified',
    queries: config.tasks.map((task, index) => ({ ...task, location: { ...task.location }, queryId: queryIdFor(index), nativeFrameRefreshes: [], nativeFrameCorrections: [], rankingStatus: 'not_evaluated', organicRank: null, displayPosition: null, targetMatch: null, targetMatches: [], targetAliases: targetAliases(task), listingStatus: 'not_evaluated', listings: [], listingQuality: null, evidenceStatus: 'skipped', locationEvidence: null, locationScreen: null, screens: [], error: null, stopReason: 'not_started' })),
    artifacts: [], counts: { total: config.tasks.length, captured: 0, needsReview: 0, failed: 0, skipped: config.tasks.length, screenshots: 0, locationScreenshots: 0, completeListingQueries: 0, partialListingQueries: 0, rankedQueries: 0, listings: 0, ads: 0, organic: 0, unknown: 0 }, errors: [],
    evidenceLimits: [
      'Listings come from full-screen OCR of each result-sheet screenshot: a card is a rating line, the name line above it and the status line below it. Native UI XML is retained as auxiliary evidence only.',
      'Display positions follow the order cards first appear while swiping the sheet; ads consume display positions but not organic ranks. Unreadable names remain null and lower rankingReliable.',
      'Target ranks are the first listing whose OCR name contains a configured alias; a store with several Google listings needs one alias per listing it should count.',
      'Distances on cards are measured by Google from the injected device location; they corroborate but do not formally verify the backend location.',
    ],
  };
  let storageBroken = false;
  let release: (() => Promise<void>) | undefined;
  const checkActive = (): void => { if (options.signal?.aborted) throw new CaptureFailure('cancelled'); };
  const persist = async (relativePath: string, data: Buffer | string, terminal = false): Promise<AndroidManifestReceipt> => {
    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const expected: WrittenFile = { relativePath, bytes: buffer.length, sha256: sha256Hex(buffer) };
    try {
      const written = await store.writeFile(relativePath, buffer);
      if (written.relativePath !== expected.relativePath || written.bytes !== expected.bytes || written.sha256 !== expected.sha256) throw new CaptureFailure('artifact_write_mismatch');
      const state = await store.persist(written, terminal ? { alwaysAttempt: true } : {});
      // Raw error strings and delivery keys from arbitrary gateways never enter evidence.
      if (state.storageStatus === 'failed') return { ...expected, ...failedState(store.mode, relativePath, 'artifact_delivery_failed') };
      if (state.storageStatus === 'verified') {
        if (state.objectKey !== relativePath || !Number.isFinite(Date.parse(state.verifiedAt))) return { ...expected, ...failedState(store.mode, relativePath, 'invalid_storage_receipt') };
        return { ...expected, ...state };
      }
      if (state.storageStatus === 'uploaded') return { ...expected, storageStatus: 'uploaded', objectKey: relativePath, verifiedAt: null, storageError: null };
      if (state.storageStatus === 'local_only') return { ...expected, storageStatus: 'local_only', objectKey: null, verifiedAt: null, storageError: null };
      return { ...expected, ...failedState(store.mode, relativePath, 'invalid_storage_receipt') };
    } catch { return { ...expected, ...failedState(store.mode, relativePath, 'artifact_storage_failed') }; }
  };
  const saveArtifact = async (kind: AndroidArtifact['kind'], relativePath: string, data: Buffer | string): Promise<AndroidArtifact> => {
    if (storageBroken) throw new CaptureFailure('storage_unavailable');
    const artifact: AndroidArtifact = { kind, ...await persist(relativePath, data) };
    manifest.artifacts.push(artifact);
    if (!delivered(artifact, store.mode)) { storageBroken = true; throw new CaptureFailure('storage_unverified'); }
    return artifact;
  };
  const saveScreen = async (query: AndroidQueryEvidence, screen: NativeScreen, role: AndroidScreenEvidence['role']): Promise<AndroidScreenEvidence> => {
    if (screen.packageName !== 'com.google.android.apps.maps') throw new CaptureFailure('wrong_foreground');
    const dimensions = pngDimensions(screen.png);
    const captured = new Date(screen.capturedAt);
    if (!Number.isFinite(captured.getTime())) throw new CaptureFailure('invalid_capture_timestamp');
    if (typeof screen.xml !== 'string' || Buffer.byteLength(screen.xml, 'utf8') > 4 * 1024 * 1024) throw new CaptureFailure('invalid_ui_xml');
    let analysis: ScreenAnalysis;
    let invalidUi = false;
    try { analysis = analyzeScreen(screen.xml, role === 'location' ? '' : query.keyword); }
    catch {
      invalidUi = true;
      analysis = { kind: 'unknown', queryVisible: false, texts: [], adLabels: [], warnings: ['invalid_ui_xml: native XML could not be safely parsed; raw diagnostic evidence is retained.', 'Ranks, text coverage and advertisement coverage are not evaluated.'] };
    }
    const stamp = captured.toISOString().replaceAll('-', '').replaceAll(':', '');
    const suffix = role === 'location' ? 'location' : String(query.screens.length + 1).padStart(2, '0');
    const base = `${prefix}/${query.queryId}/${stamp}__${keywordSlug(query.keyword)}__${suffix}`;
    const png = await saveArtifact('png', `${base}.png`, screen.png);
    const xml = await saveArtifact('ui_xml', `${base}.xml`, screen.xml);
    const evidence: AndroidScreenEvidence = { png, xml, ...dimensions, capturedAt: screen.capturedAt, role: invalidUi && role !== 'location' ? 'diagnostic' : role, analysis };
    if (role === 'location') query.locationScreen = evidence;
    else query.screens.push(evidence);
    if (invalidUi) throw new CaptureFailure('invalid_ui_xml');
    return evidence;
  };
  const evaluateTarget = (query: AndroidQueryEvidence): void => {
    const { match, matches } = matchTarget(query.listings, query.targetAliases);
    query.targetMatch = match; query.targetMatches = matches;
    if (query.listingQuality?.rankingReliable !== true || query.evidenceStatus === 'failed') {
      query.displayPosition = null; query.organicRank = null; query.rankingStatus = 'not_evaluated'; return;
    }
    query.displayPosition = match?.displayPosition ?? null; query.organicRank = match?.organicRank ?? null;
    query.rankingStatus = match ? 'ranked' : query.listingStatus === 'complete' ? 'not_found' : query.listingStatus === 'partial' ? 'not_found_in_prefix' : 'not_evaluated';
  };
  try {
    checkActive();
    release = await acquireDeviceLease(config.serial);
    await saveArtifact('input', `${prefix}/input.json`, JSON.stringify(config, null, 2));
    checkActive();
    const info = await device.preflight();
    if (info.serial !== config.serial || info.appPackage !== 'com.google.android.apps.maps' || !info.emulator || info.locale !== config.locale || info.timezone !== config.timezone) throw new CaptureFailure('device_preflight_mismatch');
    manifest.device = info;
    manifest.profileHash = hashJson({
      surface: manifest.surface, adapterVersion: manifest.adapterVersion,
      androidVersion: info.androidVersion, appVersion: info.appVersion, appPackage: info.appPackage, emulator: info.emulator,
      locale: info.locale, timezone: info.timezone,
      ...(info.display === undefined ? {} : { display: info.display }),
      locationMethod: 'adb_emulator_geo_fix', captureMethod: 'appium_uiautomator2_screenshot_ui_xml',
      listingMethod: 'full_screen_ocr_native_context_ordered_overlap/v14', ocrLanguages: config.ocrLanguages, ocrScale: config.ocrScale,
    });
    await saveArtifact('device', `${prefix}/device.json`, JSON.stringify(info, null, 2));
    checkActive();
    await device.start();
    for (const query of manifest.queries) {
      checkActive();
      query.evidenceStatus = 'failed'; query.stopReason = null;
      let stage = 'location';
      let snapshotAttempted = false;
      let locationSnapshotAttempted = false;
      try {
        const location = await device.setLocation(query.location);
        query.locationEvidence = { ...location, mapsLocationStatus: 'unverified' };
        if (location.injectionStatus !== 'sent' || location.deviceLocationStatus === 'mismatch') throw new CaptureFailure('location_failed');
        if (location.requested.latitude !== query.location.latitude || location.requested.longitude !== query.location.longitude || location.requested.id !== query.location.id) throw new CaptureFailure('location_request_mismatch');
        if (location.deviceLocationStatus !== 'matched') throw new CaptureFailure('location_unverified');
        if (location.preparation?.viewportStatus !== 'following') throw new CaptureFailure('viewport_unverified');
        checkActive();
        stage = 'location_snapshot'; locationSnapshotAttempted = true;
        const locationSource = await device.snapshot();
        const locationScreen = await saveScreen(query, locationSource, 'location');
        if (!locationScreenFollowsDevice(locationSource.xml, locationScreen.analysis)) throw new CaptureFailure('location_screen_unverified');
        checkActive();
        stage = 'search';
        const deadline = Date.now() + config.keywordTimeoutMs;
        const checkQuery = (): void => { checkActive(); if (Date.now() >= deadline) throw new CaptureFailure('query_timeout'); };
        await device.search(query.keyword);
        checkQuery();
        stage = 'snapshot';
        let swipes = 0, unchangedFrames = 0, refreshPending = false, correctionPending = false;
        const frames: ScreenFrame[] = [];
        const seenHashes = new Set<string>();
        for (let shot = 0; shot < config.maxScreenshotsPerQuery; shot++) {
          checkQuery(); snapshotAttempted = true;
          const refreshedWithoutGesture = refreshPending; refreshPending = false;
          const source = await device.snapshot();
          const evidence = await saveScreen(query, source, 'capture');
          checkQuery();
          const analysis = evidence.analysis;
          if (analysis.kind === 'blocked' || analysis.kind === 'consent') throw new CaptureFailure(`screen_${analysis.kind}`);
          stage = 'screen_ocr';
          const frameId = `${query.queryId}:frame-${String(shot + 1).padStart(3, '0')}`;
          const ocr = await (options.screenRecognizer ?? recognizeScreen)({
            png: Buffer.from(source.png), timeoutMs: Math.max(1, Math.min(config.ocrTimeoutMs, deadline - Date.now())), languages: config.ocrLanguages, scale: config.ocrScale,
            ...(options.signal ? { signal: options.signal } : {}),
          });
          checkQuery();
          try { validateScreenOcr(ocr); } catch { throw new CaptureFailure('invalid_screen_ocr'); }
          if (ocr.imageSha256 !== evidence.png.sha256) throw new CaptureFailure('ocr_provenance_mismatch');
          if (ocr.imageWidth !== evidence.width || ocr.imageHeight !== evidence.height) throw new CaptureFailure('ocr_dimensions_mismatch');
          if (ocr.scale !== config.ocrScale) throw new CaptureFailure('ocr_scale_mismatch');
          const base = evidence.png.relativePath.slice(0, -4);
          evidence.frameId = frameId;
          evidence.ocr = await saveArtifact('ocr_json', `${base}.ocr.json`, JSON.stringify(ocr, null, 2));
          const frame = parseScreenFrame(ocr, query.keyword, frameId, source.capturedAt, source.xml);
          if (correctionPending) { frame.afterBackwardCorrection = true; correctionPending = false; }
          const nativeList = inspectNativeResultList(source.xml, query.keyword);
          // A known native list already scrolled backwards contradicts an OCR top marker.
          if (frames.length === 0 && nativeList?.canScrollBackward === true) {
            frame.topStateVerified = false; frame.warnings.push('native_list_top_contradicted');
          }
          evidence.screenFrame = await saveArtifact('screen_frame', `${base}.frame.json`, JSON.stringify(frame, null, 2));
          if (refreshedWithoutGesture) query.nativeFrameRefreshes!.at(-1)!.refreshFrameId = frameId;
          evidence.cardsRecognized = frame.cards.length;
          const before = reconcileScreenFrames(frames, config.maxDisplayedResults).listings.length;
          frames.push(frame);
          const reconciled = reconcileScreenFrames(frames, config.maxDisplayedResults);
          query.listings = reconciled.listings;
          query.listingQuality = { adCount: reconciled.adCount, organicCount: reconciled.organicCount, unknownCount: reconciled.unknownCount, rankingReliable: reconciled.rankingReliable, frames: frames.length, warnings: reconciled.warnings,
            sequenceVerified: reconciled.sequenceVerified, classificationComplete: reconciled.unknownCount === 0, screenshotCoverageComplete: true,
            organicCoverage: reconciled.listings.filter(row => row.organicRank !== null).length, truncatedCount: reconciled.truncatedCount,
            endOfResults: frame.endOfResults && reconciled.rankingReliable && reconciled.truncatedCount === 0 };
          // The query must be visible either in native XML or in the OCR'd sheet header.
          if (!analysis.queryVisible && !frame.queryVisible) { query.evidenceStatus = 'needs_review'; query.stopReason = 'query_not_visible'; break; }
          // A forward gesture whose next frame shares nothing with the previous one (probe 6/7: the
          // list re-laid out by about a card height at a page boundary) is corrected by scrolling
          // back a bounded distance and capturing again. The skipped frame stays as evidence but
          // leaves the reconciled sequence; the fresh frame must pass the unchanged overlap rules.
          const previousKept = frames.at(-2);
          if (previousKept && frame.cards.length && nativeList && !refreshedWithoutGesture && query.nativeFrameCorrections!.length < MAX_OVERLAP_CORRECTIONS &&
            reconciled.warnings.includes(`ordered_overlap_missing: ${previousKept.frameId} -> ${frameId}`)) {
            frames.pop(); evidence.discarded = 'ordered_overlap_missing';
            query.nativeFrameCorrections!.push({ reason: 'ordered_overlap_missing', afterFrameId: previousKept.frameId, discardedFrameId: frameId });
            const kept = reconcileScreenFrames(frames, config.maxDisplayedResults);
            query.listings = kept.listings;
            query.listingQuality = { ...query.listingQuality, adCount: kept.adCount, organicCount: kept.organicCount, unknownCount: kept.unknownCount, rankingReliable: kept.rankingReliable, frames: frames.length, warnings: kept.warnings,
              sequenceVerified: kept.sequenceVerified, classificationComplete: kept.unknownCount === 0, organicCoverage: kept.listings.filter(row => row.organicRank !== null).length, truncatedCount: kept.truncatedCount, endOfResults: false };
            checkQuery(); stage = 'swipe';
            try { await device.swipeResults(scrollEvidence(frame, source.xml, nativeList.bounds), 'backward'); }
            catch (error) {
              const code = safeError(error, 'swipe_failed').code;
              if (!['unknown_scroll_layout', 'source_changed'].includes(code)) throw error;
              query.stopReason = code; query.listingQuality.rankingReliable = false; query.listingQuality.warnings.push(code); break;
            }
            swipes++; correctionPending = true; stage = 'snapshot'; continue;
          }
          if (!frame.cards.length && frames.length === 1) {
            if (['detail', 'no_results', 'photo_discovery'].includes(analysis.kind)) { query.evidenceStatus = 'captured'; query.listingStatus = 'non_ranking'; query.stopReason = `screen_${analysis.kind}`; }
            else { query.evidenceStatus = 'needs_review'; query.stopReason = 'no_cards_recognized'; }
            break;
          }
          query.listingStatus = 'partial'; query.evidenceStatus = 'captured';
          const hash = sha256Hex(source.png);
          const repeated = seenHashes.has(hash); seenHashes.add(hash);
          // Repeated merchants are expected while a tall card moves through the
          // viewport. A fresh PNG alone is not progress; named OCR geometry in
          // the same exact native list must demonstrate upward movement.
          const moved = hasMeasuredScreenProgress(frames.at(-2), frame);
          if (!refreshedWithoutGesture || query.listings.length !== before || moved) {
            unchangedFrames = query.listings.length === before && !moved ? unchangedFrames + 1 : 0;
          }
          // Candidate10: a trailing card first read below the name-confidence floor may resolve in the next frame.
          if (!reconciled.rankingReliable && !onlyPendingLowConfidence(reconciled, frames)) { query.stopReason = 'ranking_unreliable'; break; }
          if (query.listingQuality.endOfResults) { query.listingStatus = 'complete'; query.stopReason = 'list_end'; break; }
          if (query.listings.length >= config.maxDisplayedResults) { query.listingStatus = 'complete'; query.stopReason = 'target_reached'; break; }
          // A stalled viewport can be a failed swipe or a tall photo module; neither proves absence.
          if ((repeated && !refreshedWithoutGesture) || unchangedFrames >= 3) { query.stopReason = repeated ? 'stalled_same_frame' : 'stalled_no_new_cards'; break; }
          if (shot + 1 >= config.maxScreenshotsPerQuery) { query.stopReason = 'screenshot_budget'; break; }
          if (swipes >= config.maxScrolls) { query.stopReason = 'scroll_budget'; break; }
          checkQuery(); stage = 'swipe';
          try {
            await device.swipeResults(scrollEvidence(frame, source.xml, nativeList?.bounds ?? null));
          } catch (error) {
            // These guards reject before sending a gesture. Keep the observed
            // prefix as an unqualified partial, then allow the next task to
            // prepare its own location/query. Transport, storage, cancellation
            // and unknown action outcomes still take the fatal path below.
            const code = safeError(error, 'swipe_failed').code;
            if (!['unknown_scroll_layout', 'source_changed'].includes(code)) throw error;
            if (code === 'source_changed' && !refreshedWithoutGesture && query.nativeFrameRefreshes!.length <= swipes) {
              // The device guarantees this refusal occurred before /actions.
              // Capture a new PNG/XML/OCR/frame within the same loop budget,
              // then re-run every query, native, ad and ordered-overlap gate.
              // No blind gesture retry and no deadline/screenshot extension.
              // Probe 5 (q0003) lost a verified 17-frame sequence to a second
              // source change after a successful gesture: a fresh frame is
              // allowed again after each sent gesture, never twice in a row.
              // Candidate10: the budget is one per sent gesture (probe 9 q0004 lost
              // its run to a fixed three-per-query cap); the screenshot budget and
              // query deadline still bound the loop.
              query.nativeFrameRefreshes!.push({ reason: 'source_changed', afterFrameId: frameId, refreshFrameId: null });
              refreshPending = true; stage = 'snapshot'; continue;
            }
            query.stopReason = code;
            query.listingQuality.rankingReliable = false;
            query.listingQuality.warnings.push(code);
            break;
          }
          swipes++;
          stage = 'snapshot';
        }
        if (query.listingStatus === 'partial') query.evidenceStatus = 'needs_review';
        evaluateTarget(query);
      } catch (error) {
        query.evidenceStatus = 'failed'; query.error = safeError(error, `${stage}_failed`); query.stopReason = query.error.code;
        evaluateTarget(query);
        // Preserve one location-stage diagnostic without treating it as a search screenshot.
        if (stage === 'location' && query.locationEvidence && !locationSnapshotAttempted && !storageBroken && !options.signal?.aborted) {
          locationSnapshotAttempted = true;
          try { await saveScreen(query, await device.snapshot(), 'location'); }
          catch { /* Preserve the primary location failure and any partial artifact receipts. */ }
        }
        // One diagnostic snapshot after search failure only. No search retries, no snapshots of other apps,
        // no extra device commands after cancellation/storage failure, and no second snapshot after a bad one.
        if (stage === 'search' && !snapshotAttempted && !storageBroken && !options.signal?.aborted && query.screens.length < config.maxScreenshotsPerQuery) {
          try { await saveScreen(query, await device.snapshot(), 'diagnostic'); }
          catch { /* The primary failure remains authoritative; partial artifacts remain in the ledger. */ }
        }
        manifest.errors.push(query.error);
        break;
      }
    }
  } catch (error) { manifest.errors.push(safeError(error, 'device_setup_failed')); }
  finally {
    if (release) {
      let cleanupConfirmed = false;
      try { await device.close(); cleanupConfirmed = true; }
      catch (error) {
        manifest.errors.push(safeError(error, 'device_cleanup_failed'));
        manifest.errors.push({ code: 'device_lease_quarantined', message: 'Device lease retained because session cleanup is unconfirmed. Inspect the dedicated emulator and local Appium server before manually clearing this lease.' });
      }
      if (cleanupConfirmed) {
        try { await release(); } catch { manifest.errors.push(safeError(null, 'device_lease_release_failed')); }
      }
    }
  }
  if (options.signal?.aborted && !manifest.errors.some((error) => error.code === 'cancelled')) manifest.errors.push(safeError(new CaptureFailure('cancelled'), 'cancelled'));
  for (const query of manifest.queries) if (query.evidenceStatus === 'skipped') query.stopReason = 'run_stopped';
  if (!storageBroken) {
    try {
      for (const query of manifest.queries) await saveArtifact('query_json', `${prefix}/${query.queryId}/query.json`, JSON.stringify(query, null, 2));
      await saveArtifact('csv', `${prefix}/queries.csv`, csvFor(manifest.queries));
      await saveArtifact('csv', `${prefix}/listings.csv`, listingsCsv(manifest.queries));
    } catch (error) { manifest.errors.push(safeError(error, 'artifact_summary_failed')); }
  }
  for (const query of manifest.queries) {
    if (query.evidenceStatus === 'captured') manifest.counts.captured++;
    else if (query.evidenceStatus === 'needs_review') manifest.counts.needsReview++;
    else if (query.evidenceStatus === 'failed') manifest.counts.failed++;
    manifest.counts.screenshots += query.screens.length;
    if (query.locationScreen) manifest.counts.locationScreenshots++;
    if (query.listingStatus === 'complete') manifest.counts.completeListingQueries++;
    if (query.listingStatus === 'partial') manifest.counts.partialListingQueries++;
    if (query.rankingStatus === 'ranked') manifest.counts.rankedQueries++;
    manifest.counts.listings += query.listings.length;
    manifest.counts.ads += query.listings.filter(row => row.resultType === 'ad').length;
    manifest.counts.organic += query.listings.filter(row => row.resultType === 'organic').length;
    manifest.counts.unknown += query.listings.filter(row => row.resultType === 'unknown').length;
  }
  manifest.counts.skipped = manifest.queries.filter((query) => query.evidenceStatus === 'skipped').length;
  // Cancellation during summary persistence still marks the run; it is never reported as success.
  if (options.signal?.aborted && !manifest.errors.some((error) => error.code === 'cancelled')) manifest.errors.push(safeError(new CaptureFailure('cancelled'), 'cancelled'));
  manifest.executionStatus = manifest.errors.length || storageBroken || manifest.counts.failed || manifest.counts.skipped ? 'failed' : manifest.counts.needsReview ? 'needs_review' : 'completed';
  manifest.finishedAt = new Date().toISOString();
  // The immutable terminal manifest excludes itself. Its delivery outcome is this separate receipt.
  const receipt = await persist(`${prefix}/manifest.json`, JSON.stringify(manifest, null, 2), true);
  const cancelled = options.signal?.aborted ?? false;
  return { manifest, receipt, cancelled, exitCode: !cancelled && manifest.executionStatus === 'completed' && delivered(receipt, store.mode) ? 0 : 2 };
}
