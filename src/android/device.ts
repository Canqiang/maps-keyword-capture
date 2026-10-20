import { execFile } from 'node:child_process';
import type { AndroidCaptureConfig, AndroidDevice, AndroidDeviceInfo, LocationEvidence, NativeScreen, NativeScrollEvidence, ObservationLocation } from './contracts.js';
import { analyzeScreen, hasBlankNativeSearchWrapper, inspectNativeResultList, parseUiNodes, type NativeResultList } from './ui.js';

export type AdbExecutor = (file: string, args: string[], options: { timeoutMs: number; signal: AbortSignal }) => Promise<{ stdout: Buffer; stderr: Buffer }>;
export interface NativeMapsTransport { adb?: AdbExecutor; commandTimeoutMs?: number; signal?: AbortSignal }

const MAPS = 'com.google.android.apps.maps';
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
// Maps resource IDs/accessibility labels are implementation assumptions, not a public API.
// They must be checked against a real pinned Maps build before the pilot is accepted.
// Do not replace a missing native selector with a browser/deep-link search.
const SEARCH_IDS = ['search_omnibox_text_box', 'search_omnibox_text_box_search'].map((id) => `${MAPS}:id/${id}`);
// Observed on Maps 11.129.0103 / Android 15: the outer EditText is a display
// wrapper; its nested search_omnibox_edit_text is the focused, editable input.
const SEARCH_INPUT_ID = `${MAPS}:id/search_omnibox_edit_text`;
const CLOSE_IDS = ['terra_navigation_header_close_button', 'search_omnibox_text_clear'].map(id => `${MAPS}:id/${id}`);
const RECENTER = 'Re-center map to your location';
const FOLLOWING = 'Enter compass mode';

export class AndroidDeviceError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'AndroidDeviceError'; }
}

const executeAdb: AdbExecutor = (file, args, options) => new Promise((resolve, reject) => {
  // Argument arrays avoid both host shell interpolation and query text in adb shell.
  // Force the local ADB server even if the invoking environment has remote ADB settings.
  const env = { ...process.env };
  delete env.ADB_SERVER_SOCKET;
  delete env.ANDROID_ADB_SERVER_PORT;
  execFile(file, args, { encoding: 'buffer', timeout: options.timeoutMs, signal: options.signal, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024, env }, (error, stdout, stderr) => {
    if (error) reject(error); else resolve({ stdout, stderr });
  });
});

function fail(code: string, message: string): never { throw new AndroidDeviceError(code, message); }
function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}; }

/** Plan one overlap-preserving attempt; gesture percent is not measured movement.
 * The next persisted frame still must pass the unchanged native reconciler.
 */
function resultScrollPercent(xml: string, list: NativeResultList, evidence?: NativeScrollEvidence): number {
  const defaultPercent = 0.35, fallbackPercent = 0.1;
  if (evidence === undefined) return fallbackPercent;
  const valid = (bounds: NativeScrollEvidence['listBounds']): bounds is NonNullable<NativeScrollEvidence['listBounds']> => !!bounds &&
    [bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) && bounds.left >= 0 && bounds.top >= 0 &&
    bounds.right > bounds.left && bounds.bottom > bounds.top;
  const same = (left: NonNullable<NativeScrollEvidence['listBounds']>, right: NonNullable<NativeScrollEvidence['listBounds']>): boolean =>
    left.left === right.left && left.top === right.top && left.right === right.right && left.bottom === right.bottom;
  if (evidence.sourceXml !== xml || !valid(evidence.listBounds) || !same(evidence.listBounds, list.bounds) || !Array.isArray(evidence.anchors)) {
    fail('UNKNOWN_SCROLL_LAYOUT', 'Persisted scroll geometry no longer matches the native result list');
  }
  const normalize = (text: string): string => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const native = parseUiNodes(xml);
  const tops = new Map<string, number>();
  for (const anchor of evidence.anchors) {
    if (!anchor || typeof anchor.text !== 'string' || !normalize(anchor.text) || !valid(anchor.bounds) ||
      anchor.bounds.left < list.bounds.left || anchor.bounds.right > list.bounds.right ||
      anchor.bounds.top < list.bounds.top || anchor.bounds.bottom > list.bounds.bottom ||
      !native.some(node => node.packageName === MAPS && node.bounds && same(node.bounds, anchor.bounds) &&
        [node.text, node.description].some(text => normalize(text) === normalize(anchor.text)))) {
      fail('UNKNOWN_SCROLL_LAYOUT', 'A scroll anchor is not bounded native evidence from this source');
    }
    // Match the reconciler's full vertical-anchor boundary. Choose distinct
    // labels with the most headroom; repeated controls do not add support.
    if (anchor.bounds.top > list.bounds.top + 3 && anchor.bounds.bottom < list.bounds.bottom - 3) {
      const text = normalize(anchor.text);
      tops.set(text, Math.max(tops.get(text) ?? -Infinity, anchor.bounds.top));
    }
  }
  const available = [...tops.values()].sort((a, b) => b - a);
  if (!available.length) return fallbackPercent;
  const height = list.bounds.bottom - list.bounds.top;
  // Preserve two full labels when available, or one for existing edge-backed
  // reconciliation. Leave >=12px/2% headroom for gesture/layout variability.
  const supportTop = available[Math.min(1, available.length - 1)]!;
  const margin = Math.max(12, Math.ceil(height * 0.02));
  const plannedDistance = supportTop - list.bounds.top - margin;
  // Tiny gestures can stall before these near-top anchors leave the viewport.
  // Use the existing10% fallback as a floor. When preserving both anchors is
  // impossible at that size, continuity remains unproven until the next frame.
  return Math.max(fallbackPercent, Math.min(defaultPercent, plannedDistance / height));
}

export class NativeMapsDevice implements AndroidDevice {
  private readonly config: AndroidCaptureConfig;
  private readonly baseUrl: string;
  private readonly execute: AdbExecutor;
  private readonly commandTimeoutMs: number;
  private readonly cancellationSignal: AbortSignal | undefined;
  private closing = false;
  private sessionId: string | undefined;
  private creationOutcomeUnknown = false;
  private queryDeadline: number | undefined;
  private activeKeyword: string | undefined;
  private searchFailed = false;
  private diagnosticPending = false;
  private locationProofExpected = false;
  private checked = false;

  constructor(config: AndroidCaptureConfig, transport: NativeMapsTransport = {}) {
    if (!/^emulator-\d{4,5}$/.test(config.serial)) fail('UNSAFE_DEVICE', 'An explicit dedicated emulator serial is required');
    let endpoint: URL;
    try { endpoint = new URL(config.appiumUrl); } catch { fail('UNSAFE_APPIUM_URL', 'Invalid Appium URL'); }
    if (!['http:', 'https:'].includes(endpoint.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname)
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['/', '/wd/hub', '/wd/hub/'].includes(endpoint.pathname)) {
      fail('UNSAFE_APPIUM_URL', 'Appium must use a credential-free loopback endpoint');
    }
    // localhost is normalized to a literal to avoid resolver changes escaping loopback.
    if (endpoint.hostname === 'localhost') endpoint.hostname = '127.0.0.1';
    if (!Number.isFinite(config.keywordTimeoutMs) || config.keywordTimeoutMs <= 0 || config.keywordTimeoutMs > 600_000) fail('INVALID_TIMEOUT', 'A bounded keyword timeout is required');
    this.commandTimeoutMs = transport.commandTimeoutMs ?? 30_000;
    if (!Number.isFinite(this.commandTimeoutMs) || this.commandTimeoutMs <= 0 || this.commandTimeoutMs > 60_000) fail('INVALID_TIMEOUT', 'Command timeout must be between 1 and 60000 ms');
    this.config = { ...config };
    this.cancellationSignal = transport.signal;
    this.baseUrl = endpoint.href.replace(/\/$/, '');
    this.execute = transport.adb ?? executeAdb;
  }

  private async bounded<T>(operation: (signal: AbortSignal, timeoutMs: number) => Promise<T>): Promise<T> {
    const cancellation = this.closing ? undefined : this.cancellationSignal;
    if (cancellation?.aborted) fail('CANCELLED', 'Native Maps capture was cancelled');
    const remaining = this.queryDeadline === undefined ? Infinity : this.queryDeadline - Date.now();
    if (remaining <= 0) fail('QUERY_TIMEOUT', 'Native Maps query deadline expired');
    const timeoutMs = Math.max(1, Math.min(this.commandTimeoutMs, remaining));
    const queryLimited = remaining <= this.commandTimeoutMs;
    const controller = new AbortController();
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => {
        reject(new AndroidDeviceError('CANCELLED', 'Native Maps capture was cancelled'));
        controller.abort();
      };
      cancellation?.addEventListener('abort', onAbort, { once: true });
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new AndroidDeviceError(queryLimited ? 'QUERY_TIMEOUT' : 'COMMAND_TIMEOUT', `Native command timed out after ${timeoutMs} ms`));
        controller.abort();
      }, timeoutMs);
    });
    try { return await Promise.race([operation(controller.signal, timeoutMs), timeout, cancelled]); }
    finally { clearTimeout(timer); if (onAbort) cancellation?.removeEventListener('abort', onAbort); }
  }

  private async adb(args: string[]): Promise<string> {
    try {
      const result = await this.bounded((signal, timeoutMs) => this.execute(this.config.adbPath, ['-H', '127.0.0.1', '-P', '5037', '-s', this.config.serial, ...args], { signal, timeoutMs }));
      return result.stdout.toString('utf8').trim();
    } catch (error) {
      if (error instanceof AndroidDeviceError) throw error;
      fail('ADB_COMMAND_FAILED', 'ADB command failed; verify the configured local SDK and dedicated emulator');
    }
  }

  private async http(method: string, path: string, body?: unknown): Promise<unknown> {
    return this.bounded(async (signal) => {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, { method, signal, redirect: 'error', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const reader = response.body?.getReader();
        if (!reader) fail('APPIUM_PROTOCOL_ERROR', 'Appium returned no response body');
        const chunks: Buffer[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 16 * 1024 * 1024) { await reader.cancel(); fail('APPIUM_PROTOCOL_ERROR', 'Appium response exceeded the size limit'); }
          chunks.push(Buffer.from(value));
        }
        const payload = object(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
        if (method === 'DELETE' && response.status === 404 && object(payload.value).error === 'invalid session id') return null;
        if (!response.ok || !Object.hasOwn(payload, 'value') || typeof object(payload.value).error === 'string') {
          fail('APPIUM_PROTOCOL_ERROR', `Appium command failed (HTTP ${response.status}); inspect the local Appium log`);
        }
        return payload.value;
      } catch (error) {
        if (error instanceof AndroidDeviceError) throw error;
        fail('APPIUM_PROTOCOL_ERROR', 'Appium transport or response failed; inspect the local Appium log');
      }
    });
  }

  private command(method: string, path: string, body?: unknown): Promise<unknown> {
    if (!this.sessionId) fail('SESSION_NOT_STARTED', 'Start a native Maps session first');
    return this.http(method, `/session/${encodeURIComponent(this.sessionId)}${path}`, body);
  }
  private mobile(script: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.command('POST', '/execute/sync', { script: `mobile: ${script}`, args: [args] });
  }
  private async foreground(): Promise<void> {
    if (await this.mobile('getCurrentPackage') !== MAPS) fail('WRONG_FOREGROUND', 'Official Google Maps is not the foreground app; native capture stopped');
  }

  async preflight(): Promise<AndroidDeviceInfo> {
    if (await this.adb(['get-state']) !== 'device' || await this.adb(['shell', 'getprop', 'sys.boot_completed']) !== '1') fail('DEVICE_NOT_READY', 'The selected emulator is offline or has not completed boot');
    if (await this.adb(['shell', 'getprop', 'ro.kernel.qemu']) !== '1') fail('NOT_EMULATOR', 'The selected Android device is not a verified emulator');
    const locale = (await this.adb(['shell', 'getprop', 'persist.sys.locale']) || await this.adb(['shell', 'getprop', 'ro.product.locale'])).replaceAll('_', '-');
    const timezone = await this.adb(['shell', 'getprop', 'persist.sys.timezone']);
    if (locale !== this.config.locale || timezone !== this.config.timezone) fail('ENVIRONMENT_MISMATCH', 'Emulator locale/timezone does not match the profile; configure the dedicated AVD before capture');
    for (const [pkg, code] of [[MAPS, 'MAPS_UNAVAILABLE'], ['com.google.android.gms', 'GMS_UNAVAILABLE']] as const) {
      const packages = await this.adb(['shell', 'pm', 'list', 'packages', '-e', pkg]);
      if (!packages.split(/\r?\n/).includes(`package:${pkg}`)) fail(code, `${pkg} must be installed and enabled on the dedicated emulator`);
    }
    const appVersion = /\bversionName=([^\s]+)/.exec(await this.adb(['shell', 'dumpsys', 'package', MAPS]))?.[1];
    const androidVersion = await this.adb(['shell', 'getprop', 'ro.build.version.release']);
    if (!appVersion || !androidVersion) fail('VERSION_UNAVAILABLE', 'Cannot read Maps/Android version evidence');
    this.checked = true;
    return { serial: this.config.serial, androidVersion, appVersion, appPackage: MAPS, locale, timezone, emulator: true };
  }

  async start(): Promise<void> {
    if (this.sessionId) { await this.foreground(); return; }
    if (this.creationOutcomeUnknown) fail('SESSION_OUTCOME_UNKNOWN', 'Earlier session creation is unconfirmed; inspect the dedicated local Appium server before retrying');
    await this.preflight();
    this.creationOutcomeUnknown = true;
    const value = object(await this.http('POST', '/session', { capabilities: { alwaysMatch: {
      platformName: 'Android', 'appium:automationName': 'UiAutomator2', 'appium:udid': this.config.serial,
      'appium:remoteAdbHost': '127.0.0.1', 'appium:adbPort': 5037,
      'appium:appPackage': MAPS, 'appium:appActivity': 'com.google.android.maps.MapsActivity', 'appium:appWaitPackage': MAPS,
      'appium:noReset': true, 'appium:fullReset': false, 'appium:forceAppLaunch': true,
      'appium:autoWebview': false, 'appium:newCommandTimeout': Math.ceil(this.config.keywordTimeoutMs / 1000) + 30,
      'appium:adbExecTimeout': this.commandTimeoutMs, 'appium:uiautomator2ServerReadTimeout': this.commandTimeoutMs,
    }, firstMatch: [{}] } }).catch((error: unknown) => {
      if (error instanceof AndroidDeviceError && error.code === 'COMMAND_TIMEOUT') {
        error.message += '; session-creation outcome is unknown. Inspect the local Appium server before retrying.';
      }
      // A request timeout does not cancel server-side startup. No unowned session is deleted.
      throw error;
    }));
    if (typeof value.sessionId !== 'string' || !value.sessionId) fail('APPIUM_PROTOCOL_ERROR', 'Appium did not establish a W3C native session');
    this.sessionId = value.sessionId;
    this.creationOutcomeUnknown = false;
    await this.command('POST', '/appium/settings', { settings: {
      ignoreUnimportantViews: false, includeExtrasInPageSource: true,
      includeA11yActionsInPageSource: true, allowInvisibleElements: false,
    } });
    await this.foreground();
  }

  async setLocation(location: ObservationLocation): Promise<LocationEvidence> {
    if (!Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180
      || !Number.isFinite(location.toleranceMeters) || location.toleranceMeters <= 0) fail('INVALID_LOCATION', 'Invalid observation coordinates or tolerance');
    // A new observation must not inherit an expired query deadline or stale query
    // readiness state. Preparation has its own bounded budget, including UI work.
    this.queryDeadline = Date.now() + Math.min(60_000, this.config.keywordTimeoutMs);
    this.activeKeyword = undefined;
    this.searchFailed = false;
    this.diagnosticPending = false;
    this.locationProofExpected = false;
    const preparation: NonNullable<LocationEvidence['preparation']> = {
      homeReadyAt: null, providerReadyAt: null, injectedAt: null, beforeElapsedMs: null,
      observedElapsedMs: null, readbackElapsedMs: null, accuracyMeters: null,
      viewportStatus: 'unverified', viewportAction: null, viewportCheckedAt: null,
    };
    const evidence: LocationEvidence = { requested: { ...location }, injectionStatus: 'failed', deviceLocationStatus: 'unverified', observed: null, mapsLocationStatus: 'unverified', checkedAt: new Date().toISOString(), preparation, note: 'Location preparation has not completed; no Maps location claim.' };
    try {
      await this.foreground();
      await this.prepareHome();
      preparation.homeReadyAt = new Date().toISOString();
      // Force-launch briefly tears down Maps' GPS request. Inject only after the
      // current provider is active for Maps, not a historical Event Log entry.
      while (!mapsGpsReady(await this.adb(['shell', 'dumpsys', 'location']))) await this.observationPause();
      preparation.providerReadyAt = new Date().toISOString();
      const before = await this.elapsedRealtime();
      preparation.beforeElapsedMs = before;
      const output = await this.adb(['emu', 'geo', 'fix', String(location.longitude), String(location.latitude)]);
      if (!/^OK$/m.test(output) || /^KO\b/m.test(output)) fail('GPS_INJECTION_REJECTED', 'Emulator did not accept the GPS fix');
      evidence.injectionStatus = 'sent';
      preparation.injectedAt = new Date().toISOString();
      evidence.note = 'GPS command accepted; a fresh matching GPS receipt and map follow state are still required.';
      const preparationDeadline = this.queryDeadline;
      const readbackDeadline = Math.min(preparationDeadline!, Date.now() + 15_000);
      this.queryDeadline = readbackDeadline;
      try {
        while (Date.now() < readbackDeadline) {
          const dump = await this.adb(['shell', 'dumpsys', 'location']);
          const after = await this.elapsedRealtime();
          preparation.readbackElapsedMs = after;
          const observed = freshGps(dump, before, after, location.toleranceMeters);
          if (observed) {
            preparation.observedElapsedMs = observed.elapsed;
            preparation.accuracyMeters = observed.accuracy;
            evidence.observed = { latitude: observed.latitude, longitude: observed.longitude, provider: 'gps' };
            evidence.deviceLocationStatus = distanceMeters(location, observed) <= location.toleranceMeters ? 'matched' : 'mismatch';
            if (evidence.deviceLocationStatus === 'matched') break;
          }
          // Never advance the injection freshness threshold while waiting. A stale
          // matching point is not a receipt, even on a return to a previous point.
          await this.observationPause();
        }
      } finally { this.queryDeadline = preparationDeadline; }
      if (evidence.deviceLocationStatus !== 'matched') fail('GPS_READBACK_UNVERIFIED', 'No fresh matching GPS fix arrived within the preparation budget');
      preparation.viewportAction = await this.prepareViewport();
      // Enter compass mode means this control already follows location; clicking
      // it would switch modes. It is an observation only, never a click target.
      let previous: string | undefined;
      while (true) {
        await this.foreground();
        const xml = await this.nativeXml();
        const following = this.homeState(xml) === 'following';
        if (following && xml === previous) break;
        previous = following ? xml : undefined;
        await this.observationPause();
      }
      await this.locationControl(FOLLOWING);
      preparation.viewportStatus = 'following';
      preparation.viewportCheckedAt = new Date().toISOString();
      this.locationProofExpected = true;
      evidence.note = 'Fresh device GPS matched the requested point; the blank native map showed follow-location state. The Maps search backend location remains unverified.';
    } catch (error) {
      this.searchFailed = true;
      this.diagnosticPending = true;
      evidence.note = error instanceof AndroidDeviceError
        ? `Location preparation stopped (${error.code}): ${error.message}. Maps search backend location remains unverified.`
        : 'Location preparation could not be verified; preserve diagnostics and inspect the native runtime.';
    } finally {
      evidence.checkedAt = new Date().toISOString();
      this.queryDeadline = undefined;
    }
    return evidence;
  }

  private async elapsedRealtime(): Promise<number> {
    const elapsed = Number((await this.adb(['shell', 'cat', '/proc/uptime'])).split(/\s/)[0]) * 1000;
    if (!Number.isFinite(elapsed) || elapsed < 0) fail('GPS_CLOCK_UNAVAILABLE', 'Android elapsed realtime is unavailable');
    return elapsed;
  }

  private homeState(xml: string): 'following' | 'recenter' | null {
    let nodes;
    try {
      const analysis = analyzeScreen(xml, '');
      if (analysis.kind === 'blocked' || analysis.kind === 'consent') fail('SEARCH_INTERRUPTED', 'Maps requires interaction before location preparation');
      nodes = parseUiNodes(xml).filter(node => node.packageName === MAPS);
    } catch (error) {
      if (error instanceof AndroidDeviceError) throw error;
      fail('INVALID_UI_SOURCE', 'Native Maps hierarchy could not be validated');
    }
    if (!hasBlankNativeSearchWrapper(xml)
      || !nodes.some(node => node.resourceId === `${MAPS}:id/explore_tab_strip_button` && node.description === 'Explore')
      || nodes.some(node => CLOSE_IDS.includes(node.resourceId) || /:id\/(?:search_results_list|search_list_layout)$/.test(node.resourceId))) return null;
    const controls = nodes.filter(node => [RECENTER, FOLLOWING].includes(node.description));
    if (controls.length !== 1) return null;
    return controls[0]!.description === FOLLOWING ? 'following' : 'recenter';
  }

  private async locationControl(label: typeof RECENTER | typeof FOLLOWING): Promise<string> {
    return this.uniqueControl(this.locationSelector(label));
  }

  private locationSelector(label: typeof RECENTER | typeof FOLLOWING): { using: string; value: string } {
    return { using: 'xpath', value: `//*[@package="${MAPS}" and @content-desc="${label}" and @enabled="true"]/parent::*[@package="${MAPS}" and @clickable="true" and @enabled="true"]` };
  }

  private async optionalRecenterControl(): Promise<string | null> {
    const result = await this.command('POST', '/elements', this.locationSelector(RECENTER));
    // A fresh GPS fix can change this exact control into FOLLOWING while Appium
    // resolves the XPath. Only successful zero matches permit re-observation;
    // malformed/duplicate/invalid controls keep the shared hard failure guards.
    if (Array.isArray(result) && result.length === 0) return null;
    return this.checkedUniqueControl(result);
  }

  private async prepareViewport(): Promise<'recenter_clicked' | 'already_following'> {
    // Observations share the existing preparation deadline. A dispatched click
    // is never retried, including when its transport outcome is uncertain.
    const home = async (): Promise<'following' | 'recenter'> => {
      await this.foreground();
      const state = this.homeState(await this.nativeXml());
      if (!state) fail('LOCATION_HOME_LOST', 'Native Maps left its blank home map before re-centering');
      return state;
    };
    while (true) {
      if (await home() === 'following') return 'already_following';
      const parent = await this.optionalRecenterControl();
      if (parent === null) { await this.observationPause(); continue; }
      if (await home() === 'following') return 'already_following';
      // Revalidate the cached parent through the exact native label, then check
      // the full home state immediately before click. The same native button
      // can change meaning; a following control must never be toggled here.
      const confirmed = await this.optionalRecenterControl();
      if (confirmed === null) { await this.observationPause(); continue; }
      if (confirmed !== parent) fail('UNKNOWN_LOCATION_LAYOUT', 'Location preparation parent changed before click');
      if (await home() === 'following') return 'already_following';
      await this.command('POST', `/element/${encodeURIComponent(parent)}/click`, {});
      return 'recenter_clicked';
    }
  }

  private async uniqueControl(selector: { using: string; value: string }): Promise<string> {
    return this.checkedUniqueControl(await this.command('POST', '/elements', selector));
  }

  private async checkedUniqueControl(result: unknown): Promise<string> {
    if (!Array.isArray(result) || result.length !== 1) fail('UNKNOWN_LOCATION_LAYOUT', 'Location preparation control is not unique');
    const id = object(result[0])[ELEMENT];
    if (typeof id !== 'string') fail('UNKNOWN_LOCATION_LAYOUT', 'Invalid location preparation element');
    const path = `/element/${encodeURIComponent(id)}`;
    const isTrue = (value: unknown): boolean => value === true || value === 'true';
    if (await this.command('GET', `${path}/displayed`) !== true || await this.command('GET', `${path}/attribute/package`) !== MAPS
      || !isTrue(await this.command('GET', `${path}/attribute/enabled`)) || !isTrue(await this.command('GET', `${path}/attribute/clickable`))) {
      fail('UNKNOWN_LOCATION_LAYOUT', 'Location preparation control is not visible, enabled and clickable in Maps');
    }
    return id;
  }

  private async clickUnique(selector: { using: string; value: string }): Promise<void> {
    const id = await this.uniqueControl(selector);
    await this.command('POST', `/element/${encodeURIComponent(id)}/click`, {});
  }

  private async prepareHome(): Promise<void> {
    // State observations do not spend the action budget. A native close animation
    // can retain its old control for several reads, or briefly expose no control.
    // Click each observed close/clear route at most once in this preparation;
    // never repeat a pending click or send a blind Back sequence.
    const clicked = new Set<string>();
    while (true) {
      await this.foreground();
      const xml = await this.nativeXml();
      if (this.homeState(xml)) {
        const field = await this.searchField();
        // Blankness was proven from native hint ancestry above; this check only
        // confirms the live wrapper is still a usable enabled Maps control.
        if (!await this.usableSearchInput(field, false)) fail('UNKNOWN_LOCATION_LAYOUT', 'Blank native search wrapper is not enabled');
        return;
      }
      const nodes = parseUiNodes(xml).filter(node => node.packageName === MAPS);
      const closeId = CLOSE_IDS.find(id => !clicked.has(id) && nodes.some(node => node.resourceId === id && node.clickable));
      if (closeId && clicked.size < 2) {
        await this.clickUnique({ using: 'id', value: closeId });
        clicked.add(closeId);
      }
      // Unknown or persistent layouts remain unverified. Wait only inside the
      // existing preparation deadline; an absent control never means success.
      await this.observationPause();
    }
  }

  private async searchField(): Promise<string> {
    const selectors = [...SEARCH_IDS.map((value) => ({ using: 'id', value })), { using: 'accessibility id', value: 'Search here' }, { using: 'accessibility id', value: 'Search Google Maps' }];
    for (const selector of selectors) {
      const result = await this.command('POST', '/elements', selector);
      if (!Array.isArray(result)) fail('APPIUM_PROTOCOL_ERROR', 'Invalid native elements response');
      const visible: string[] = [];
      for (const entry of result.slice(0, 10)) {
        const id = object(entry)[ELEMENT];
        if (typeof id !== 'string') continue;
        const path = `/element/${encodeURIComponent(id)}`;
        if (await this.command('GET', `${path}/displayed`) === true && await this.command('GET', `${path}/attribute/package`) === MAPS) visible.push(id);
      }
      if (visible.length === 1) return visible[0]!;
      if (visible.length > 1) fail('UNKNOWN_SEARCH_LAYOUT', 'Multiple visible native search fields require selector review');
    }
    fail('UNKNOWN_SEARCH_LAYOUT', 'No supported Maps native search field; capture diagnostics and validate selectors for this Maps version');
  }

  private async nestedSearchInputs(wrapper: string): Promise<string[]> {
    const result = await this.command('POST', `/element/${encodeURIComponent(wrapper)}/elements`, { using: 'id', value: SEARCH_INPUT_ID });
    if (!Array.isArray(result) || result.length > 10) fail('UNKNOWN_SEARCH_LAYOUT', 'Unexpected native search input descendants');
    return result.map((entry) => object(entry)[ELEMENT]).filter((id): id is string => typeof id === 'string');
  }

  private async usableSearchInput(id: string, requireFocus: boolean): Promise<boolean> {
    const path = `/element/${encodeURIComponent(id)}`;
    const isTrue = (value: unknown): boolean => value === true || value === 'true';
    if (await this.command('GET', `${path}/displayed`) !== true || await this.command('GET', `${path}/attribute/package`) !== MAPS
      || await this.command('GET', `${path}/attribute/className`) !== 'android.widget.EditText'
      || !isTrue(await this.command('GET', `${path}/attribute/enabled`))) return false;
    return !requireFocus || isTrue(await this.command('GET', `${path}/attribute/focused`));
  }

  private async searchInput(wrapper: string): Promise<string> {
    const children = await this.nestedSearchInputs(wrapper);
    if (children.length) {
      const editable: string[] = [];
      for (const child of children) {
        if (await this.usableSearchInput(child, true)) editable.push(child);
      }
      if (editable.length === 1) return editable[0]!;
      fail('UNKNOWN_SEARCH_LAYOUT', 'Maps nested search input is not uniquely visible, enabled and focused');
    }
    // Older/simple layouts can expose the editable wrapper itself. ClassName alone
    // is insufficient: the real Maps display wrapper also reports EditText.
    if (await this.usableSearchInput(wrapper, true)) return wrapper;
    fail('UNKNOWN_SEARCH_LAYOUT', 'Maps search did not expose a focused editable input');
  }

  private async awaitSearchInput(): Promise<string> {
    // A native click can finish before Maps opens/focuses its editable child.
    // Observe only: never repeat the click or type into an unfocused wrapper.
    const previousDeadline = this.queryDeadline;
    const focusDeadline = Date.now() + Math.min(5_000, this.config.keywordTimeoutMs / 4);
    this.queryDeadline = Math.min(previousDeadline ?? Infinity, focusDeadline);
    try {
      while (true) {
        await this.foreground();
        try { return await this.searchInput(await this.searchField()); }
        catch (error) {
          if (!(error instanceof AndroidDeviceError) || error.code !== 'UNKNOWN_SEARCH_LAYOUT' || Date.now() >= focusDeadline) throw error;
        }
        await this.observationPause();
      }
    } catch (error) {
      if (error instanceof AndroidDeviceError && error.code === 'QUERY_TIMEOUT' &&
        (previousDeadline === undefined || focusDeadline < previousDeadline)) {
        fail('UNKNOWN_SEARCH_LAYOUT', 'The bounded native input focus window expired before a usable input was observed');
      }
      throw error;
    } finally { this.queryDeadline = previousDeadline; }
  }

  private async searchQueryMatches(wrapper: string, keyword: string): Promise<boolean> {
    const path = `/element/${encodeURIComponent(wrapper)}`;
    const wrapperText = await this.command('GET', `${path}/text`);
    if (wrapperText === keyword) return true;
    if (wrapperText !== '') return false; // A conflicting outer query must not be ignored.
    const resourceId = await this.command('GET', `${path}/attribute/resource-id`);
    // Maps 26.41 exposes the submitted query in this known wrapper's description;
    // its child becomes an anonymous TextView after IME submission.
    if (typeof resourceId === 'string' && SEARCH_IDS.includes(resourceId)
      && await this.command('GET', `${path}/attribute/content-desc`) === keyword) return true;
    const matching: string[] = [];
    for (const child of await this.nestedSearchInputs(wrapper)) {
      if (await this.usableSearchInput(child, false) && await this.command('GET', `/element/${encodeURIComponent(child)}/text`) === keyword) matching.push(child);
    }
    return matching.length === 1;
  }

  async search(keyword: string): Promise<void> {
    if (!keyword.trim() || keyword.length > 300 || /[\u0000-\u001f\u007f]/.test(keyword)) fail('INVALID_QUERY', 'Search keyword must be bounded printable text');
    this.queryDeadline = Date.now() + this.config.keywordTimeoutMs;
    this.activeKeyword = keyword;
    this.locationProofExpected = false;
    this.searchFailed = false;
    this.diagnosticPending = false;
    try {
      await this.foreground();
      let field = await this.searchField();
      await this.command('POST', `/element/${encodeURIComponent(field)}/click`, {});
      field = await this.awaitSearchInput();
      const path = `/element/${encodeURIComponent(field)}`;
      await this.command('POST', `${path}/clear`, {});
      await this.command('POST', `${path}/value`, { text: keyword });
      await this.foreground();
      if (!await this.usableSearchInput(field, true)) fail('UNKNOWN_SEARCH_LAYOUT', 'Maps search input lost visibility, ownership or focus before submission');
      if (await this.command('GET', `${path}/text`) !== keyword) fail('QUERY_NOT_VISIBLE', 'The exact keyword is not present in the native input before submission');
      // Appium's editor-action IME injected "/search" into this Maps build.
      // Native ENTER submits the verified focused input; never retry an uncertain submission.
      await this.mobile('pressKey', { keycode: 66 });
      await this.foreground();
      field = await this.searchField();
      if (!await this.searchQueryMatches(field, keyword)) fail('QUERY_NOT_VISIBLE', 'The exact submitted keyword is not visible in the native Maps search field');
      // v4: a settled layout the native analyzer does not recognize is still evidence; the
      // screen reader decides from the screenshot. Loading, blocked and consent states still wait or fail.
      await this.stableNativeXml(false, true);
    } catch (error) {
      this.searchFailed = true;
      this.diagnosticPending = true;
      throw error;
    }
  }

  private async nativeXml(): Promise<string> {
    const xml = await this.command('GET', '/source');
    if (typeof xml !== 'string' || !/^\s*(?:<\?xml[^>]*>\s*)?<hierarchy\b/.test(xml) || Buffer.byteLength(xml) > 4 * 1024 * 1024) fail('INVALID_UI_SOURCE', 'Appium did not return bounded native hierarchy XML');
    return xml;
  }

  private readyNativeXml(xml: string, allowUnknownEvidence = false): boolean {
    if (!this.activeKeyword) return !this.locationProofExpected || this.homeState(xml) === 'following';
    let analysis;
    let nodes;
    try { analysis = analyzeScreen(xml, this.activeKeyword); nodes = parseUiNodes(xml); }
    catch { fail('INVALID_UI_SOURCE', 'Native Maps hierarchy could not be validated'); }
    if (analysis.kind === 'blocked' || analysis.kind === 'consent') fail('SEARCH_INTERRUPTED', 'Maps requires interaction; preserve diagnostics and review the native screen');
    // The parser rejects loading/unknown layouts. Exact source text additionally avoids
    // accepting normalized query matches or an unchanged EditText alone as ready results.
    const exactQuery = nodes.some((node) => {
      if (node.packageName !== MAPS) return false;
      const knownWrapper = SEARCH_IDS.includes(node.resourceId);
      if (knownWrapper && node.text === '' && node.description === this.activeKeyword) return true;
      return node.text === this.activeKeyword && (knownWrapper || node.resourceId === SEARCH_INPUT_ID ||
        (node.className === 'android.widget.EditText' && ['Search here', 'Search Google Maps'].includes(node.description)));
    });
    const visibleLoading = nodes.some(node => /(?:ProgressBar|CircularProgressIndicator|LinearProgressIndicator)$/.test(node.className) ||
      (/(?:^|\/)(?:loading|loading_text|loading_indicator|progress_indicator|search_progress)$/.test(node.resourceId) &&
        [node.text, node.description].some(label => /^(?:loading(?: results)?|searching)(?:\.{3}|…)?$/.test(label.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase()))));
    // After search readiness, save an exact-query, settled unknown layout for the
    // runner to mark needs_review. This never makes that layout rankable and does
    // not relax initial search readiness, loading, foreground or PNG/XML pairing.
    const unknownEvidence = allowUnknownEvidence && analysis.kind === 'unknown' && !visibleLoading;
    return analysis.queryVisible && exactQuery && (unknownEvidence || ['results', 'no_results', 'detail', 'photo_discovery'].includes(analysis.kind));
  }

  private async observationPause(): Promise<void> {
    // This only spaces observations. Readiness always depends on their native state;
    // elapsed time by itself never turns a loading or changing screen into ready evidence.
    await this.bounded(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
  }

  private async stableNativeXml(diagnostic: boolean, allowUnknownEvidence = false): Promise<string> {
    let previous: string | undefined;
    while (true) {
      await this.foreground();
      const xml = await this.nativeXml();
      const ready = diagnostic || this.readyNativeXml(xml, allowUnknownEvidence);
      if (ready && xml === previous) return xml;
      previous = ready ? xml : undefined;
      await this.observationPause();
    }
  }

  private async nativePng(): Promise<Buffer> {
    const encoded = await this.command('GET', '/screenshot');
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail('INVALID_SCREENSHOT', 'Appium screenshot was not base64 PNG data');
    const png = Buffer.from(encoded, 'base64');
    if (png.length < 45 || png.length > 12 * 1024 * 1024 || !png.subarray(0, 8).equals(PNG_SIGNATURE)
      || png.readUInt32BE(8) !== 13 || png.toString('ascii', 12, 16) !== 'IHDR'
      || png.readUInt32BE(16) < 1 || png.readUInt32BE(16) > 10000 || png.readUInt32BE(20) < 1 || png.readUInt32BE(20) > 10000
      || png.readUInt32BE(png.length - 12) !== 0 || png.toString('ascii', png.length - 8, png.length - 4) !== 'IEND') fail('INVALID_SCREENSHOT', 'Appium screenshot was not a complete bounded PNG');
    return png;
  }

  async snapshot(): Promise<NativeScreen> {
    const diagnostic = this.searchFailed;
    if (diagnostic && !this.diagnosticPending) fail('DIAGNOSTIC_CAPTURE_EXHAUSTED', 'The bounded diagnostic capture after this failed search has already been attempted');
    const previousDeadline = this.queryDeadline;
    if (diagnostic) {
      this.diagnosticPending = false;
      this.queryDeadline = Date.now() + Math.min(this.commandTimeoutMs, 10_000);
    } else if (this.queryDeadline === undefined) this.queryDeadline = Date.now() + this.config.keywordTimeoutMs;
    try {
      while (true) {
        const xml = await this.stableNativeXml(diagnostic, true);
        const png = await this.nativePng();
        const after = await this.nativeXml();
        await this.foreground();
        // XML and PNG are separate Appium requests: discard a raced pair instead of
        // attaching the new query/state's XML to a screenshot from another state.
        if (after === xml && (diagnostic || this.readyNativeXml(after, true))) return { png, xml, packageName: MAPS, capturedAt: new Date().toISOString() };
        await this.observationPause();
      }
    } finally {
      this.queryDeadline = previousDeadline;
    }
  }

  async prepareResults(): Promise<void> {
    if (!this.activeKeyword || this.searchFailed) fail('UNKNOWN_SCROLL_LAYOUT', 'A verified native query is required before preparing results');
    try {
      const xml = await this.stableNativeXml(false);
      if (analyzeScreen(xml, this.activeKeyword).kind !== 'results') return;
      const list = inspectNativeResultList(xml, this.activeKeyword);
      if (!list) fail('UNKNOWN_SCROLL_LAYOUT', 'The query does not expose the supported native vertical result list');
      if (list.canScrollBackward !== false) fail('LIST_TOP_UNVERIFIED', 'Ranked capture requires native evidence that the result list starts at its top');
      const handle = list.sheetHandleBounds;
      const targetY = list.expansionTargetY;
      if (!handle || targetY === null) fail('UNKNOWN_RESULT_SHEET', 'The observed result-sheet handle and safe expansion bounds are unavailable');
      const centerX = Math.round((handle.left + handle.right) / 2);
      const centerY = Math.round((handle.top + handle.bottom) / 2);
      // The expanded handle can sit a few pixels below the target. Never repeat
      // this gesture or scroll upward to manufacture a missing start-of-list proof.
      if (centerY <= targetY + 2 * (handle.bottom - handle.top)) return;
      await this.foreground();
      if (await this.nativeXml() !== xml) fail('UNKNOWN_RESULT_SHEET', 'Result sheet changed before expansion');
      await this.mobile('dragGesture', { startX: centerX, startY: centerY, endX: centerX, endY: targetY, speed: 900 });
      const expandedXml = await this.stableNativeXml(false);
      const expanded = inspectNativeResultList(expandedXml, this.activeKeyword);
      if (!expanded || expanded.canScrollBackward !== false) fail('LIST_TOP_UNVERIFIED', 'Expanded native results do not retain an exact query and verified list top');
      if (expanded.bounds.top >= list.bounds.top || !expanded.sheetHandleBounds || expanded.expansionTargetY === null ||
        (expanded.sheetHandleBounds.top + expanded.sheetHandleBounds.bottom) / 2 > expanded.expansionTargetY + 2 * (expanded.sheetHandleBounds.bottom - expanded.sheetHandleBounds.top)) {
        fail('RESULT_SHEET_NOT_EXPANDED', 'The single bounded native gesture did not reach the observed expanded result sheet');
      }
    } catch (error) {
      this.searchFailed = true;
      this.diagnosticPending = true;
      throw error;
    }
  }

  private async resultListElement(list: NativeResultList): Promise<string> {
    const result = await this.command('POST', '/elements', { using: 'id', value: list.resourceId });
    if (!Array.isArray(result) || result.length !== 1) fail('UNKNOWN_SCROLL_LAYOUT', 'The vertical native result list is not unique');
    const id = object(result[0])[ELEMENT];
    if (typeof id !== 'string') fail('UNKNOWN_SCROLL_LAYOUT', 'Invalid native result list element');
    const path = `/element/${encodeURIComponent(id)}`;
    const isTrue = (value: unknown): boolean => value === true || value === 'true';
    if (await this.command('GET', `${path}/displayed`) !== true || await this.command('GET', `${path}/attribute/package`) !== MAPS ||
      await this.command('GET', `${path}/attribute/resource-id`) !== list.resourceId ||
      await this.command('GET', `${path}/attribute/className`) !== 'android.support.v7.widget.RecyclerView' ||
      !isTrue(await this.command('GET', `${path}/attribute/enabled`)) || !isTrue(await this.command('GET', `${path}/attribute/scrollable`))) {
      fail('UNKNOWN_SCROLL_LAYOUT', 'The selected native element is not the supported visible vertical result list');
    }
    const rect = object(await this.command('GET', `${path}/rect`));
    if (rect.x !== list.bounds.left || rect.y !== list.bounds.top || rect.width !== list.bounds.right - list.bounds.left || rect.height !== list.bounds.bottom - list.bounds.top) {
      fail('UNKNOWN_SCROLL_LAYOUT', 'Native list element bounds no longer match the validated source');
    }
    return id;
  }

  async scroll(evidence?: NativeScrollEvidence): Promise<boolean> {
    await this.foreground();
    if (!this.activeKeyword || this.searchFailed) fail('UNKNOWN_SCROLL_LAYOUT', 'A verified native query is required before scrolling');
    const xml = await this.nativeXml();
    // No gesture has been sent. A caller may capture and reconcile fresh
    // evidence within its existing budgets; never scroll using a stale frame.
    if (evidence !== undefined && evidence.sourceXml !== xml) fail('SOURCE_CHANGED', 'Native source changed after the persisted frame; fresh evidence is required before scrolling');
    const list = inspectNativeResultList(xml, this.activeKeyword);
    if (!list || list.canScrollForward === null || list.canScrollBackward === null) fail('UNKNOWN_SCROLL_LAYOUT', 'No supported exact-query vertical native result list is visible');
    const percent = resultScrollPercent(xml, list, evidence);
    // Resolve and validate the native list for every gesture; RecyclerView
    // elements are recycled even though this touch sequence uses viewport pixels.
    await this.resultListElement(list);
    const { left, top, right, bottom } = list.bounds;
    const height = bottom - top;
    const x = left + Math.floor((right - left) / 2);
    const inset = Math.max(1, Math.ceil(height * 0.1));
    // Trial21 retained large content jumps despite bounded 23–35% requests.
    // Cap this controlled experiment at10% (rounded up to an integral pixel),
    // without changing touch timing or weakening the next-frame overlap proof.
    const maxDistance = Math.ceil(height * 0.1);
    const distance = Math.max(1, Math.min(maxDistance, Math.round(height * percent)));
    const startY = bottom - inset, endY = startY - distance;
    if (x <= left || x >= right || endY <= top + inset || endY >= startY || startY >= bottom || distance > maxDistance) {
      fail('UNKNOWN_SCROLL_LAYOUT', 'Native list cannot contain the bounded touch movement');
    }
    await this.foreground();
    if (await this.nativeXml() !== xml) fail('SOURCE_CHANGED', 'Native result list changed before the gesture; fresh evidence is required');
    // One explicit touch attempt: move immediately after pointerDown, hold only
    // at the destination, then release. No long-press or fallback gesture. The
    // requested pixel distance is not proof of the resulting content movement.
    const result = await this.command('POST', '/actions', { actions: [{
      type: 'pointer', id: 'maps-result-scroll', parameters: { pointerType: 'touch' }, actions: [
        { type: 'pointerMove', duration: 0, origin: 'viewport', x, y: startY },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration: 650, origin: 'viewport', x, y: endY },
        { type: 'pause', duration: 300 },
        { type: 'pointerUp', button: 0 },
      ],
    }] });
    if (result !== null) fail('APPIUM_PROTOCOL_ERROR', 'Native touch action did not return the expected completion response');
    await this.foreground();
    // W3C completion is not a list-end signal. The runner always persists the
    // next native viewport and applies its unchanged overlap/end checks.
    return true;
  }

  /** One slow upward swipe over the lower half of the screen: 40% of the height in 700 ms, so the
   * sheet moves without a fling and every card is fully visible in at least one of two consecutive screenshots. */
  async swipeResults(): Promise<void> {
    await this.foreground();
    if (!this.activeKeyword || this.searchFailed) fail('UNKNOWN_SCROLL_LAYOUT', 'A verified native query is required before swiping');
    const size = /(\d{3,5})x(\d{3,5})/u.exec(await this.adb(['shell', 'wm', 'size']));
    if (!size) fail('UNKNOWN_SCROLL_LAYOUT', 'The emulator screen size is unavailable');
    const width = Number(size[1]), height = Number(size[2]);
    const x = Math.round(width / 2), startY = Math.round(height * 0.85), endY = Math.round(height * 0.45);
    if (!(endY > 0 && startY > endY && startY < height)) fail('UNKNOWN_SCROLL_LAYOUT', 'Screen geometry cannot contain the swipe');
    await this.adb(['shell', 'input', 'swipe', String(x), String(startY), String(x), String(endY), '700']);
    await this.foreground();
  }

  async close(): Promise<void> {
    this.queryDeadline = undefined;
    this.closing = true;
    try {
      const session = this.sessionId;
      this.checked = false;
      if (!session && this.creationOutcomeUnknown) fail('SESSION_OUTCOME_UNKNOWN', 'Session creation outcome is unconfirmed; retain the device lease and inspect the dedicated local Appium server');
      if (session) await this.http('DELETE', `/session/${encodeURIComponent(session)}`);
      // A failed DELETE has an unknown outcome. Retain the exact owned session for retry.
      this.sessionId = undefined;
    } finally { this.closing = false; }
  }
}

function elapsedMs(value: string): number | null {
  const match = /^\+?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?(?:(\d+)ms)?$/.exec(value);
  if (!match || !match.slice(1).some(Boolean)) return null;
  return Number(match[1] ?? 0) * 86400000 + Number(match[2] ?? 0) * 3600000 + Number(match[3] ?? 0) * 60000 + Number(match[4] ?? 0) * 1000 + Number(match[5] ?? 0);
}

/** Restrict readiness and fixes to the current provider block, never Event Log history. */
function gpsProvider(dump: string): string {
  const lines = dump.split(/\r?\n/);
  const start = lines.findIndex(line => /^\s*gps provider:\s*$/.test(line));
  if (start < 0) return '';
  const indent = /^\s*/.exec(lines[start]!)![0].length;
  let end = start + 1;
  while (end < lines.length && (!lines[end]!.trim() || /^\s*/.exec(lines[end]!)![0].length > indent)) end += 1;
  return lines.slice(start + 1, end).join('\n');
}

function mapsGpsReady(dump: string): boolean {
  const block = gpsProvider(dump);
  const service = /^\s*service:\s*ProviderRequest\[([^\r\n]+)$/m.exec(block)?.[1] ?? '';
  return !/^OFF\b/.test(service) && /\bWorkSource\{[^}]*\bcom\.google\.android\.apps\.maps\b/.test(service)
    && /^\s*enabled=true\s*$/m.test(block) && /^\s*allowed=true\s*$/m.test(block)
    && /^\s*mStarted=true(?:\s|$)/m.test(block);
}

function freshGps(dump: string, before: number, after: number, tolerance: number): { latitude: number; longitude: number; elapsed: number; accuracy: number } | null {
  if (!Number.isFinite(before) || !Number.isFinite(after) || after < before) return null;
  // Android's elapsed-realtime clock is comparable with /proc/uptime. Historical log entries,
  // missing timestamps, coarse/redacted coordinates, stale fixes and other providers are ignored.
  const candidates = [...gpsProvider(dump).matchAll(/^\s*last location=Location\[gps\s+(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s+([^\]\r\n]*)\]/gm)].flatMap((match) => {
    const timestamp = /\bet=([^\s]+)/.exec(match[3]!)?.[1];
    const elapsed = timestamp ? elapsedMs(timestamp) : null;
    const accuracy = Number(/\bhAcc=([\d.]+)/.exec(match[3]!)?.[1] ?? NaN);
    const latitude = Number(match[1]), longitude = Number(match[2]);
    if (elapsed === null || elapsed < before || elapsed > after || after - elapsed > 15000 || !Number.isFinite(accuracy) || accuracy > tolerance || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
    return [{ latitude, longitude, elapsed, accuracy }];
  }).sort((a, b) => b.elapsed - a.elapsed);
  return candidates[0] ?? null;
}

function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = Math.PI / 180;
  const lat = Math.sin((b.latitude - a.latitude) * radians / 2);
  const lon = Math.sin((b.longitude - a.longitude) * radians / 2);
  const arc = lat * lat + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * lon * lon;
  return 6371000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(Math.max(0, 1 - arc)));
}
