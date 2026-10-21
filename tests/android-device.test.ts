import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AndroidCaptureConfig, NativeScrollEvidence } from '../src/android/contracts.js';
import { NativeMapsDevice, type AdbExecutor } from '../src/android/device.js';
import { parseUiNodes } from '../src/android/ui.js';

const maps = 'com.google.android.apps.maps';
const fieldId = `${maps}:id/search_omnibox_text_box`;
const inputId = `${maps}:id/search_omnibox_edit_text`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const location = { id: 'center', label: 'Center', latitude: 35, longitude: -80, accuracyMeters: 10, toleranceMeters: 100, source: 'test' };
const config: AndroidCaptureConfig = {
  schemaVersion: 'android-maps-input/v1', appiumUrl: 'http://127.0.0.1:4723', adbPath: '/sdk/platform-tools/adb', serial: 'emulator-5554',
  locale: 'en-US', timezone: 'America/New_York', outputDirectory: '/tmp/maps-native-tests', maxScreenshotsPerQuery: 3, keywordTimeoutMs: 1000, tasks: [],
};
const servers: Server[] = [];
function resultsXml(keyword: string, card = 'Current result', loading = false, nestedInput = false, queryInDescription = false): string {
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const field = queryInDescription
    ? `<node resource-id="${fieldId}" class="android.widget.EditText" text="" content-desc="${escape(keyword)}" enabled="true"><node class="android.widget.TextView" text="${escape(keyword)}"/></node>`
    : nestedInput
    ? `<node resource-id="${fieldId}" class="android.widget.EditText" text="" enabled="true" focused="false"><node resource-id="${inputId}" class="android.widget.EditText" text="${escape(keyword)}" enabled="true" focused="false"/></node>`
    : `<node resource-id="${fieldId}" class="android.widget.EditText" text="${escape(keyword)}" enabled="true"/>`;
  return `<hierarchy><node package="${maps}" class="android.widget.FrameLayout">${field}<node text="Filters" clickable="true"/><node resource-id="${maps}:id/search_results_list" class="androidx.recyclerview.widget.RecyclerView"><node resource-id="${maps}:id/result_card" clickable="true" text="${escape(card)}"/></node>${loading ? '<node class="android.widget.ProgressBar" resource-id="com.google.android.apps.maps:id/search_loading"/>' : ''}</node></hierarchy>`;
}
// Move only the query clock after the intended native state is observed. Real HTTP and
// real command timers remain active; scheduler contention cannot consume setup's budget.
// Invalid states get at least three reads before expiry: a broken readiness gate would
// otherwise return a screenshot and fail the test, rather than being hidden by timeout.
function queryClock() {
  let now = Date.now(), expired = false;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  return { expire: () => { if (!expired) { now += 10_000; expired = true; } } };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const readyProvider = 'gps provider:\n service: ProviderRequest[@+997ms, HIGH_ACCURACY, WorkSource{10160 com.google.android.apps.maps}]\n enabled=true\n allowed=true\n mStarted=true\n';
function homeXml(following = false): string {
 return `<hierarchy><node package="${maps}" class="android.widget.FrameLayout"><node resource-id="${fieldId}" class="android.widget.EditText" text="" content-desc="Search here" enabled="true"/><node resource-id="${maps}:id/explore_tab_strip_button" content-desc="Explore"/><node class="android.view.View" package="${maps}" clickable="true" enabled="true" displayed="true"><node class="android.view.View" package="${maps}" content-desc="${following ? 'Enter compass mode' : 'Re-center map to your location'}" enabled="true" displayed="true"/></node></node></hierarchy>`;
}
function adbFixture(overrides: Record<string, string> = {}) {
  const calls: string[][] = [];
  let injected = false;
  const adb: AdbExecutor = async (_file, args) => {
    calls.push([...args]);
    const command = args.slice(args.indexOf('-s') + 2).join(' ');
    if (command.startsWith('emu geo fix')) injected = true;
    const responses: Record<string, string> = {
      'get-state': 'device', 'shell getprop sys.boot_completed': '1', 'shell getprop ro.kernel.qemu': '1',
      'shell getprop ro.build.version.release': '15', 'shell getprop persist.sys.locale': 'en-US',
      'shell getprop persist.sys.timezone': 'America/New_York',
      [`shell pm list packages -e ${maps}`]: `package:${maps}`,
      'shell pm list packages -e com.google.android.gms': 'package:com.google.android.gms',
      [`shell dumpsys package ${maps}`]: 'versionName=25.40.01\n',
      'shell cat /proc/uptime': injected ? '105.00 10.00' : '100.00 10.00',
      'shell dumpsys location': injected ? readyProvider + ' last location=Location[gps 35.000000,-80.000000 hAcc=10 et=+1m44s]' : readyProvider + ' last location=Location[gps 34.000000,-81.000000 hAcc=10 et=+1m30s]',
      'emu geo fix -80 35': 'OK',
    };
    const stdout = overrides[command] ?? responses[command];
    if (stdout === undefined) throw new Error(`Unexpected ADB command: ${command}`);
    return { stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) };
  };
  return { adb, calls };
}

async function appiumFixture(options: { foreground?: string; missingField?: boolean; staleQuery?: boolean; stall?: boolean; redirect?: string; screenshot?: string; deleteFailures?: number; sessionAlreadyGone?: boolean; source?: (read: number, keyword: string, following: boolean) => string; onScreenshot?: () => void; nestedInput?: boolean; inputFocused?: boolean | (() => boolean); stallFocusedAttribute?: boolean; wrapperFocused?: boolean; queryInDescription?: boolean; wrapperResourceId?: string; initialQuery?: string; initiallyFollowing?: boolean; stuckRecenter?: boolean; locationLookup?: (selector: string, following: boolean) => { following?: boolean; result: unknown } | undefined; stallRecenterClick?: boolean; onScroll?: () => boolean; actionOutcome?: 'timeout' | 'http-error' | 'non-null'; onDrag?: () => void; listRect?: () => { x: number; y: number; width: number; height: number }; listResourceId?: string; editorActionTypesLiteral?: boolean; inputAfterTyping?: { text?: string; focused?: boolean; enabled?: boolean; displayed?: boolean; packageName?: string; foreground?: string }; submitOutcome?: 'timeout' | 'http-error'; queryAfterSubmit?: string } = {}) {
  const calls: { method: string; path: string; body: any }[] = [];
  let typed = options.initialQuery ?? '';
  let following = options.initiallyFollowing ?? false;
  let sourceReads = 0;
  let submitted = false;
  let hasTyped = false;
  const submittedQueries: string[] = [];
  const inputState = () => hasTyped && !submitted ? options.inputAfterTyping : undefined;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const path = req.url!;
    calls.push({ method: req.method!, path, body });
    if (options.stallRecenterClick && path.endsWith('/recenter-parent/click')) return;
    if (options.stall || (path.endsWith('/actions') && options.actionOutcome === 'timeout')) return;
    if (path.endsWith('/actions') && options.actionOutcome === 'http-error') { res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ value: { error: 'unknown error', message: 'unknown action outcome' } })); return; }
    if (options.stallFocusedAttribute && path.endsWith('/attribute/focused')) return;
    if (options.redirect) { res.writeHead(302, { location: options.redirect }).end(); return; }
    let value: unknown = null;
    if (req.method === 'DELETE' && options.sessionAlreadyGone) {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ value: { error: 'invalid session id', message: 'Session already ended', stacktrace: '' } }));
      return;
    }
    if (req.method === 'DELETE' && options.deleteFailures) {
      options.deleteFailures -= 1;
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ value: { error: 'unknown error', message: 'transient cleanup failure', stacktrace: '' } }));
      return;
    }
    if (path === '/session' && req.method === 'POST') value = { sessionId: 'native-session', capabilities: { platformName: 'Android' } };
    else if (path.endsWith('/execute/sync')) {
      if (body.script === 'mobile: getCurrentPackage') value = inputState()?.foreground ?? options.foreground ?? maps;
      else if (body.script === 'mobile: scrollGesture') value = options.onScroll?.() ?? false;
      else if (body.script === 'mobile: dragGesture') options.onDrag?.();
      else if (body.script === 'mobile: performEditorAction' || body.script === 'mobile: pressKey') {
        if (body.script === 'mobile: pressKey' && body.args?.[0]?.keycode !== 66) {
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ value: { error: 'invalid argument', message: 'Fixture accepts only ENTER for search submission' } }));
          return;
        }
        // Real Android 15 / Maps 26.41 evidence: Appium's editor-action IME
        // injected "/search" into the field instead of submitting its contents.
        if (body.script === 'mobile: performEditorAction' && options.editorActionTypesLiteral) typed += '/search';
        submittedQueries.push(typed);
        submitted = true;
        if (options.queryAfterSubmit !== undefined) typed = options.queryAfterSubmit;
        // The input may already have been submitted when the HTTP outcome is unknown.
        if (options.submitOutcome === 'timeout') return;
        if (options.submitOutcome === 'http-error') {
          res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ value: { error: 'unknown error', message: 'Submission outcome is unknown' } }));
          return;
        }
      }
    } else if (path.endsWith('/actions')) { options.onScroll?.(); value = options.actionOutcome === 'non-null' ? true : null;
    } else if (path.endsWith('/elements')) {
      if (body.value === `${maps}:id/search_list_layout`) value = [{ 'element-6066-11e4-a52e-4f735466cecf': 'vertical-list' }];
      else if (body.value === `${maps}:id/grippy`) value = [{ 'element-6066-11e4-a52e-4f735466cecf': 'sheet-handle' }];
      else if (body.value === `${maps}:id/terra_navigation_header_close_button` || body.value === `${maps}:id/search_omnibox_text_clear`) value = typed ? [{ 'element-6066-11e4-a52e-4f735466cecf': 'close-results' }] : [];
      else if (body.using === 'xpath') {
        const override = options.locationLookup?.(body.value, following);
        if (override) { following = override.following ?? following; value = override.result; }
        else value = body.value.includes(following ? 'Enter compass mode' : 'Re-center map to your location') ? [{ 'element-6066-11e4-a52e-4f735466cecf': following ? 'following-parent' : 'recenter-parent' }] : [];
      }
      else value = body.value === inputId
        ? options.nestedInput && !(submitted && options.queryInDescription) ? [{ 'element-6066-11e4-a52e-4f735466cecf': 'actual-input' }] : []
        : options.missingField ? [] : [{ 'element-6066-11e4-a52e-4f735466cecf': 'search-field' }];
    } else if (path.endsWith('/click') && path.includes('/close-results/')) { typed = ''; submitted = false; following = false; }
    else if (path.endsWith('/click') && path.includes('/recenter-parent/')) { if (!options.stuckRecenter) following = true; }
    else if (path.endsWith('/attribute/clickable')) value = 'true';
    else if (path.endsWith('/displayed')) value = inputState()?.displayed ?? true;
    else if (path.endsWith('/attribute/className')) value = path.includes('/vertical-list/') ? 'android.support.v7.widget.RecyclerView' : 'android.widget.EditText';
    else if (path.endsWith('/attribute/scrollable')) value = 'true';
    else if (path.endsWith('/rect') && path.includes('/element/')) value = options.listRect?.() ?? { x: 0, y: 272, width: 720, height: 960 };
    else if (path.endsWith('/attribute/package')) value = inputState()?.packageName ?? maps;
    else if (path.endsWith('/attribute/resource-id')) value = path.includes('/vertical-list/') ? options.listResourceId ?? `${maps}:id/search_list_layout` : path.includes('/actual-input/') ? inputId : options.wrapperResourceId ?? fieldId;
    else if (path.endsWith('/attribute/content-desc')) value = options.queryInDescription ? typed : '';
    else if (path.endsWith('/attribute/enabled')) value = String(inputState()?.enabled ?? true);
    else if (path.endsWith('/attribute/focused')) value = String(inputState()?.focused ?? (path.includes('/actual-input/') ? typeof options.inputFocused === 'function' ? options.inputFocused() : options.inputFocused ?? true : options.wrapperFocused ?? !options.nestedInput));
    else if (path.endsWith('/text')) value = options.staleQuery ? 'old query' : options.nestedInput && path.includes('/search-field/') ? '' : typed;
    else if (path.endsWith('/value')) {
      if (options.nestedInput && !path.includes('/actual-input/')) {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ value: { error: 'invalid element state', message: 'Wrapper is not editable', stacktrace: '' } }));
        return;
      }
      hasTyped = true;
      submitted = false;
      typed = options.inputAfterTyping?.text ?? body.text;
    }
    else if (path.endsWith('/source')) value = options.source?.(++sourceReads, typed, following) ?? (typed ? resultsXml(typed, 'Current result', false, options.nestedInput, options.queryInDescription).replace('</hierarchy>', `<node package="${maps}" resource-id="${maps}:id/terra_navigation_header_close_button" clickable="true" content-desc="Close"/></hierarchy>`) : homeXml(following));
    else if (path.endsWith('/screenshot')) { options.onScreenshot?.(); value = options.screenshot ?? png.toString('base64'); }
    else if (path.endsWith('/window/rect')) value = { x: 0, y: 0, width: 1080, height: 1920 };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ value }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, submittedQueries };
}

describe('NativeMapsDevice exact native search submission', () => {
  // Catches the observed editor-action text injection without bypassing the
  // production query guard. Typed text drives HTTP element reads and native XML.
  it.each(['braised food', '法拉盛 卤味'])('submits exactly %s despite the broken Appium editor-action IME', async (keyword) => {
    const appium = await appiumFixture({ nestedInput: true, queryInDescription: true, editorActionTypesLiteral: true });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await expect(device.search(keyword)).resolves.toBeUndefined();
    const frame = await device.snapshot();
    expect(appium.submittedQueries).toEqual([keyword]);
    expect(frame.xml).toContain(keyword);
    expect(frame.xml).not.toContain(`${keyword}/search`);
    expect(frame.png.equals(png)).toBe(true);
    await device.close();
  });
  // A pre-submit text check must stop wrong queries before the external action,
  // even when the post-submit guard would eventually reject them too.
  it('does not submit when native typing returned different text', async () => {
    const appium = await appiumFixture({ nestedInput: true, inputAfterTyping: { text: 'braised food/search' } });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await expect(device.search('braised food')).rejects.toMatchObject({ code: 'QUERY_NOT_VISIBLE' });
    expect(appium.submittedQueries).toEqual([]);
    await device.close();
  });
  // Focus/ownership can change after value succeeds. Reusing the earlier focus
  // proof would send ENTER to a stale or non-Maps control.
  it.each([
    ['focus lost', { focused: false }],
    ['input hidden', { displayed: false }],
    ['input disabled', { enabled: false }],
    ['ownership changed', { packageName: 'com.android.chrome' }],
  ] as const)('does not submit after typing when %s', async (_reason, inputAfterTyping) => {
    const appium = await appiumFixture({ nestedInput: true, inputAfterTyping });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await expect(device.search('braised food')).rejects.toMatchObject({ code: 'UNKNOWN_SEARCH_LAYOUT' });
    expect(appium.submittedQueries).toEqual([]);
    await device.close();
  });
  it('does not submit ENTER after typing if Maps has left the foreground', async () => {
    const appium = await appiumFixture({ nestedInput: true, inputAfterTyping: { foreground: 'com.android.chrome' } });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await expect(device.search('braised food')).rejects.toMatchObject({ code: 'WRONG_FOREGROUND' });
    expect(appium.submittedQueries).toEqual([]);
    await device.close();
  });
  it('still rejects changed post-submit text and preserves only one diagnostic screenshot', async () => {
    const appium = await appiumFixture({ nestedInput: true, queryInDescription: true, queryAfterSubmit: 'other query' });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await expect(device.search('braised food')).rejects.toMatchObject({ code: 'QUERY_NOT_VISIBLE' });
    expect(appium.submittedQueries).toEqual(['braised food']);
    expect((await device.snapshot()).xml).toContain('other query');
    await expect(device.snapshot()).rejects.toMatchObject({ code: 'DIAGNOSTIC_CAPTURE_EXHAUSTED' });
    await device.close();
  });
  it.each([
    ['timeout', 'COMMAND_TIMEOUT'],
    ['http-error', 'APPIUM_PROTOCOL_ERROR'],
  ] as const)('never repeats an uncertain native submission after %s', async (submitOutcome, code) => {
    const appium = await appiumFixture({ nestedInput: true, submitOutcome });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 5000 }, { adb: adbFixture().adb, commandTimeoutMs: 100 });
    await device.start();
    await expect(device.search('braised food')).rejects.toMatchObject({ code });
    const frame = await device.snapshot();
    expect(frame.xml).toContain('braised food');
    expect(appium.submittedQueries).toEqual(['braised food']);
    expect(appium.calls.filter(call => call.path.endsWith('/value'))).toHaveLength(1);
    await expect(device.snapshot()).rejects.toMatchObject({ code: 'DIAGNOSTIC_CAPTURE_EXHAUSTED' });
    await device.close();
  });
});

describe('NativeMapsDevice safety and preflight', () => {
  it.each(['usb-personal-device', '127.0.0.1:5555', 'emulator-5554;touch /tmp/bad'])('rejects unsafe serial %s before issuing commands', (serial) => {
    expect(() => new NativeMapsDevice({ ...config, serial })).toThrow(/emulator/i);
  });
  it.each(['https://example.com', 'http://localhost.evil:4723', 'http://user:secret@127.0.0.1:4723', 'http://127.0.0.1:4723/?token=secret'])('rejects unsafe Appium URL %s', (appiumUrl) => {
    expect(() => new NativeMapsDevice({ ...config, appiumUrl })).toThrow(/Appium/i);
  });
  it('reads emulator/package/environment evidence with an explicit serial and no settings mutations', async () => {
    const adb = adbFixture();
    const info = await new NativeMapsDevice(config, { adb: adb.adb }).preflight();
    expect(info).toEqual({ serial: 'emulator-5554', androidVersion: '15', appVersion: '25.40.01', appPackage: maps, locale: 'en-US', timezone: 'America/New_York', emulator: true });
    expect(adb.calls.every((args) => args.includes('-s') && args.includes('emulator-5554'))).toBe(true);
    expect(adb.calls.some((args) => args.includes('setprop') || args.includes('settings'))).toBe(false);
  });
  it.each([
    ['shell getprop sys.boot_completed', '0', 'DEVICE_NOT_READY'],
    ['shell getprop ro.kernel.qemu', '0', 'NOT_EMULATOR'],
    ['shell getprop persist.sys.locale', 'zh-CN', 'ENVIRONMENT_MISMATCH'],
    ['shell getprop persist.sys.timezone', 'UTC', 'ENVIRONMENT_MISMATCH'],
    [`shell pm list packages -e ${maps}`, '', 'MAPS_UNAVAILABLE'],
    ['shell pm list packages -e com.google.android.gms', '', 'GMS_UNAVAILABLE'],
  ])('rejects incompatible preflight evidence for %s', async (command, value, code) => {
    await expect(new NativeMapsDevice(config, { adb: adbFixture({ [command]: value }).adb }).preflight()).rejects.toMatchObject({ code });
  });
});

describe('NativeMapsDevice native W3C session', () => {
  it('submits Unicode and shell-like query text as JSON, verifies its field and captures original PNG/XML', async () => {
    const appium = await appiumFixture();
    const adb = adbFixture();
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adb.adb });
    await device.start();
    const keyword = '寿司 & seafood $(touch /tmp/no) "near me"';
    await device.search(keyword);
    const screen = await device.snapshot();
    expect(screen.png.equals(png)).toBe(true);
    expect(screen.xml).toContain('<hierarchy>');
    expect(screen.packageName).toBe(maps);
    expect(appium.calls.find((call) => call.path === '/session')?.body.capabilities.alwaysMatch).toMatchObject({ 'appium:udid': 'emulator-5554', 'appium:appPackage': maps, 'appium:automationName': 'UiAutomator2', 'appium:noReset': true, 'appium:remoteAdbHost': '127.0.0.1', 'appium:adbPort': 5037 });
    expect(appium.calls.find((call) => call.path.endsWith('/value'))?.body.text).toBe(keyword);
    expect(appium.submittedQueries).toEqual([keyword]);
    expect(adb.calls.some((args) => args.some((value) => value.includes('寿司')))).toBe(false);
    await expect(device.scroll()).rejects.toMatchObject({ code: 'UNKNOWN_SCROLL_LAYOUT' });
    await device.close();
    await device.close();
    expect(appium.calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });
  it('refuses any browser or other foreground app', async () => {
    const appium = await appiumFixture({ foreground: 'com.android.chrome' });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await expect(device.start()).rejects.toMatchObject({ code: 'WRONG_FOREGROUND' });
    await device.close();
  });
  it('allows cleanup retry after a failed session deletion', async () => {
    const appium = await appiumFixture({ deleteFailures: 1 });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await expect(device.close()).rejects.toMatchObject({ code: 'APPIUM_PROTOCOL_ERROR' });
    await device.close();
    expect(appium.calls.filter((call) => call.method === 'DELETE')).toHaveLength(2);
  });
  it('accepts an explicit invalid-session response as confirmed cleanup', async () => {
    const appium = await appiumFixture({ sessionAlreadyGone: true });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await expect(device.close()).resolves.toBeUndefined();
    await device.close();
    expect(appium.calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });
  it('fails with a diagnostic on unknown native search layouts', async () => {
    const appium = await appiumFixture({ missingField: true });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await expect(device.search('sushi')).rejects.toMatchObject({ code: 'UNKNOWN_SEARCH_LAYOUT' });
    await device.close();
  });
  it('does not accept a stale query as submitted', async () => {
    const appium = await appiumFixture({ staleQuery: true });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await expect(device.search('sushi')).rejects.toMatchObject({ code: 'QUERY_NOT_VISIBLE' });
    await device.close();
  });
  it('rejects a screenshot response that is not a PNG', async () => {
    const appium = await appiumFixture({ screenshot: Buffer.from('not image').toString('base64') });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await expect(device.snapshot()).rejects.toMatchObject({ code: 'INVALID_SCREENSHOT' });
    await device.close();
  });
  it('rejects a truncated PNG rather than persisting a header as a screenshot', async () => {
    const appium = await appiumFixture({ screenshot: png.subarray(0, 24).toString('base64') });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await expect(device.snapshot()).rejects.toMatchObject({ code: 'INVALID_SCREENSHOT' });
    await device.close();
  });
  it('bounds a stalled ADB process even when a transport does not acknowledge cancellation', async () => {
    const device = new NativeMapsDevice(config, { adb: () => new Promise(() => {}), commandTimeoutMs: 50 });
    await expect(device.preflight()).rejects.toMatchObject({ code: 'COMMAND_TIMEOUT' });
  });
  it('bounds a stalled HTTP command and refuses redirects outside loopback', async () => {
    const stalled = await appiumFixture({ stall: true });
    const device = new NativeMapsDevice({ ...config, appiumUrl: stalled.url }, { adb: adbFixture().adb, commandTimeoutMs: 80 });
    const started = Date.now();
    await expect(device.start()).rejects.toMatchObject({ code: 'COMMAND_TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(1500);
    const redirected = await appiumFixture({ redirect: 'http://example.com' });
    await expect(new NativeMapsDevice({ ...config, appiumUrl: redirected.url }, { adb: adbFixture().adb }).start()).rejects.toMatchObject({ code: 'APPIUM_PROTOCOL_ERROR' });
  });
  it('keeps uncertain session creation quarantined after timeout and refuses a second creation', async () => {
    const appium = await appiumFixture({ stall: true });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb, commandTimeoutMs: 80 });
    await expect(device.start()).rejects.toMatchObject({ code: 'COMMAND_TIMEOUT' });
    await expect(device.close()).rejects.toMatchObject({ code: 'SESSION_OUTCOME_UNKNOWN' });
    await expect(device.start()).rejects.toMatchObject({ code: 'SESSION_OUTCOME_UNKNOWN' });
    expect(appium.calls.filter(call => call.path === '/session' && call.method === 'POST')).toHaveLength(1);
    expect(appium.calls.filter(call => call.method === 'DELETE')).toHaveLength(0);
  });
  it('confirms cleanup after preflight fails before any session request', async () => {
    const appium = await appiumFixture();
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture({ 'get-state': 'offline' }).adb });
    await expect(device.start()).rejects.toMatchObject({ code: 'DEVICE_NOT_READY' });
    await expect(device.close()).resolves.toBeUndefined();
    expect(appium.calls).toHaveLength(0);
  });
  it('keeps a shared query deadline across search and subsequent snapshots', async () => {
    const clock = queryClock();
    const appium = await appiumFixture();
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 5000 }, { adb: adbFixture().adb });
    await device.start();
    await device.search('sushi');
    expect((await device.snapshot()).png.equals(png)).toBe(true);
    // Cross the deadline established by search, after proving snapshot readiness.
    // Resetting that deadline in snapshot() would now incorrectly return another image.
    clock.expire();
    await expect(device.snapshot()).rejects.toMatchObject({ code: 'QUERY_TIMEOUT' });
    await device.close();
  });
});

describe('NativeMapsDevice capture cancellation', () => {
  it('interrupts a polling snapshot and still closes its owned session', async () => {
    const controller = new AbortController();
    let unknown = false;
    const appium = await appiumFixture({ source: (_read, keyword) => unknown ? '<hierarchy><node package="com.google.android.apps.maps" text="Unsupported panel"/></hierarchy>' : resultsXml(keyword) });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb, signal: controller.signal });
    await device.start(); await device.search('sushi'); unknown = true;
    const pending = device.snapshot();
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(device.close()).resolves.toBeUndefined();
    expect(appium.calls.some(call => call.method === 'DELETE' && call.path === '/session/native-session')).toBe(true);
  });
  it('does not start device commands when already cancelled', async () => {
    const controller = new AbortController(); controller.abort();
    const fixture = adbFixture();
    const device = new NativeMapsDevice(config, { adb: fixture.adb, signal: controller.signal });
    await expect(device.preflight()).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fixture.calls).toHaveLength(0);
    await expect(device.close()).resolves.toBeUndefined();
  });
});

describe('NativeMapsDevice location evidence', () => {
  it.each([30_000, 80])('waits briefly for a fresh GPS fix after a stale dump with a %i ms command timeout', async (commandTimeoutMs) => {
    const fixture = adbFixture();
    let reads = 0;
    const adb: AdbExecutor = async (file, args, options) => {
      if (args.slice(-2).join(' ') === 'dumpsys location' && ++reads === 1) {
        return { stdout: Buffer.from('gps provider:\n last location=Location[gps 34.000000,-81.000000 hAcc=10 et=+1m30s]'), stderr: Buffer.alloc(0) };
      }
      return fixture.adb(file, args, options);
    };
    const appium = await appiumFixture();
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb, commandTimeoutMs });
    await device.start();
    const result = await device.setLocation(location);
    await device.close();
    expect(result).toMatchObject({ injectionStatus: 'sent', deviceLocationStatus: 'matched', mapsLocationStatus: 'unverified', observed: { latitude: 35, longitude: -80, provider: 'gps' } });
    expect(reads).toBeGreaterThanOrEqual(2);
  });
  it('bounds readback polling and leaves only stale matching coordinates unverified', async () => {
    const fixture = adbFixture({ 'shell dumpsys location': readyProvider + ' last location=Location[gps 35.000000,-80.000000 hAcc=10 et=+1m30s]' });
    const started = Date.now();
    const appium = await appiumFixture();
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 360 }, { adb: fixture.adb });
    await device.start();
    const result = await device.setLocation(location);
    await device.close();
    expect(result).toMatchObject({ injectionStatus: 'sent', deviceLocationStatus: 'unverified', observed: null });
    expect(fixture.calls.filter((args) => args.slice(-2).join(' ') === 'dumpsys location').length).toBeGreaterThanOrEqual(2);
    expect(Date.now() - started).toBeLessThan(1500);
  });
  it('sends longitude before latitude and only matches a fresh last GPS location', async () => {
    const adb = adbFixture();
    const appium = await appiumFixture();
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adb.adb });
    await device.start();
    const result = await device.setLocation(location);
    await device.close();
    expect(result).toMatchObject({ injectionStatus: 'sent', deviceLocationStatus: 'matched', mapsLocationStatus: 'unverified', observed: { latitude: 35, longitude: -80, provider: 'gps' } });
    expect(adb.calls.find((args) => args.includes('geo'))?.slice(-5)).toEqual(['emu', 'geo', 'fix', '-80', '35']);
  });
  it.each([
    ['gps provider:\n last location=Location[gps 35.000000,-80.000000 hAcc=10 et=+1m30s]', 'unverified'],
    ['gps provider:\n last location=Location[gps 36.000000,-80.000000 hAcc=10 et=+1m44s]', 'mismatch'],
    ['historical locations: Location[gps 35.000000,-80.000000 hAcc=10 et=+1m44s]', 'unverified'],
    ['gps provider:\n last location=Location[gps 35.000000,-80.000000 hAcc=10]', 'unverified'],
  ])('does not infer fresh matching coordinates from %s', async (dump, status) => {
    const appium = await appiumFixture();
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture({ 'shell dumpsys location': readyProvider + dump.replace('gps provider:\n', '') }).adb });
    await device.start();
    const result = await device.setLocation(location);
    await device.close();
    expect(result.deviceLocationStatus).toBe(status);
    expect(result.mapsLocationStatus).toBe('unverified');
  });
});

describe('NativeMapsDevice native readiness and screenshot pairing', () => {
  it('preserves a stable unsupported post-search screen for review without waiting for the full query deadline', async () => {
    let unsupported = false;
    const appium = await appiumFixture({ source: (_read, keyword) => unsupported
      ? resultsXml(keyword).replaceAll('search_results_list', 'unsupported_results').replaceAll('result_card', 'unsupported_card')
      : resultsXml(keyword) });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 5000 }, { adb: adbFixture().adb });
    await device.start(); await device.search('sushi'); unsupported = true;
    const before = appium.calls.length;
    const screen = await device.snapshot();
    expect(screen.xml).toContain('unsupported_results');
    expect(screen.png.equals(png)).toBe(true);
    expect(appium.calls.slice(before).filter(call => call.path.endsWith('/source'))).toHaveLength(3);
    await device.close();
  });
  it('does not accept persistent loading as an unsupported post-search diagnostic', async () => {
    let loading = false, loadingReads = 0; const clock = queryClock();
    const appium = await appiumFixture({ source: (_read, keyword) => { if (loading && ++loadingReads >= 4) clock.expire(); return resultsXml(keyword, 'Current result', loading); } });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 5000 }, { adb: adbFixture().adb });
    await device.start(); await device.search('sushi'); loading = true;
    await expect(device.snapshot()).rejects.toMatchObject({ code: 'QUERY_TIMEOUT' });
    expect(appium.calls.filter(call => call.path.endsWith('/screenshot'))).toHaveLength(0);
    await device.close();
  });
  it.each(['Loading  results', 'Loading\u00a0results', 'Ｌｏａｄｉｎｇ results'])('keeps normalized loading label %s out of post-search diagnostics', async (label) => {
    let loading = false, loadingReads = 0; const clock = queryClock();
    const appium = await appiumFixture({ source: (_read, keyword) => { if (loading && ++loadingReads >= 4) clock.expire(); return loading
      ? resultsXml(keyword).replace('</hierarchy>', `<node package="${maps}" class="android.widget.TextView" resource-id="${maps}:id/loading_text" text="${label}"/></hierarchy>`)
      : resultsXml(keyword); } });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 5000 }, { adb: adbFixture().adb });
    await device.start(); await device.search('sushi'); loading = true;
    await expect(device.snapshot()).rejects.toMatchObject({ code: 'QUERY_TIMEOUT' });
    expect(appium.calls.filter(call => call.path.endsWith('/screenshot'))).toHaveLength(0);
    await device.close();
  });
  it('does not accept an unsupported screen whose query changed after search', async () => {
    let wrong = false, wrongReads = 0; const clock = queryClock();
    const appium = await appiumFixture({ source: (_read, keyword) => { if (wrong && ++wrongReads >= 4) clock.expire(); return resultsXml(wrong ? 'other query' : keyword)
      .replaceAll(wrong ? 'search_results_list' : 'absent token', 'unsupported_results'); } });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 5000 }, { adb: adbFixture().adb });
    await device.start(); await device.search('sushi'); wrong = true;
    await expect(device.snapshot()).rejects.toMatchObject({ code: 'QUERY_TIMEOUT' });
    expect(appium.calls.filter(call => call.path.endsWith('/screenshot'))).toHaveLength(0);
    await device.close();
  });
  it('accepts a settled layout the native analyzer does not recognize once the exact query is visible (v4)', async () => {
    const appium = await appiumFixture({ source: (_read, keyword) => resultsXml(keyword)
      .replaceAll('search_results_list', 'unsupported_results').replaceAll('result_card', 'unsupported_card') });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 2000 }, { adb: adbFixture().adb });
    await device.start();
    await expect(device.search('sushi')).resolves.toBeUndefined();
    await device.close();
  });
  it('still waits while an unrecognized layout shows a loading indicator', async () => {
    const appium = await appiumFixture({ source: (_read, keyword) => resultsXml(keyword, 'Current result', true)
      .replaceAll('search_results_list', 'unsupported_results').replaceAll('result_card', 'unsupported_card') });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 200 }, { adb: adbFixture().adb });
    await device.start();
    await expect(device.search('sushi')).rejects.toMatchObject({ code: 'QUERY_TIMEOUT' });
    await device.close();
  });

  it('waits for loading to end and two identical terminal observations', async () => {
    const appium = await appiumFixture({ source: (read, keyword) => resultsXml(keyword, read < 3 ? 'Stale result' : 'New result', read < 3) });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await device.search('new query');
    expect(appium.calls.filter((call) => call.path.endsWith('/source')).length).toBeGreaterThanOrEqual(4);
    const screen = await device.snapshot();
    expect(screen.xml).toContain('New result');
    expect(screen.xml).not.toContain('ProgressBar');
    await device.close();
  });
  it('times out persistent loading and still captures a bounded diagnostic screenshot', async () => {
    const clock = queryClock();
    const appium = await appiumFixture({ source: (read, keyword) => { if (read >= 3) clock.expire(); return resultsXml(keyword, 'Stale result', true); } });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 5000 }, { adb: adbFixture().adb });
    await device.start();
    await expect(device.search('new query')).rejects.toMatchObject({ code: 'QUERY_TIMEOUT' });
    const diagnostic = await device.snapshot();
    expect(diagnostic.xml).toContain('ProgressBar');
    expect(diagnostic.png.equals(png)).toBe(true);
    await device.close();
  });
  it('never accepts continuously changing terminal observations', async () => {
    const appium = await appiumFixture({ source: (read, keyword) => resultsXml(keyword, `Result ${read}`) });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 200 }, { adb: adbFixture().adb });
    await device.start();
    await expect(device.search('new query')).rejects.toMatchObject({ code: 'QUERY_TIMEOUT' });
    await device.close();
  });
  it('discards a PNG if the native hierarchy changes around its capture', async () => {
    let card = 'Before transition';
    const appium = await appiumFixture({ source: (_read, keyword) => resultsXml(keyword, card), onScreenshot: () => { card = 'After transition'; } });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await device.search('sushi');
    const screen = await device.snapshot();
    expect(screen.xml).toContain('After transition');
    expect(appium.calls.filter((call) => call.path.endsWith('/screenshot'))).toHaveLength(2);
    await device.close();
  });
  it('does not return an XML/PNG pair when every capture races a state change', async () => {
    let version = 0; const clock = queryClock();
    const appium = await appiumFixture({ source: (_read, keyword) => resultsXml(keyword, `Version ${version}`), onScreenshot: () => { version += 1; if (version >= 2) clock.expire(); } });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 5000 }, { adb: adbFixture().adb });
    await device.start();
    await device.search('sushi');
    await expect(device.snapshot()).rejects.toMatchObject({ code: 'QUERY_TIMEOUT' });
    await device.close();
  });
});

describe('NativeMapsDevice observed Maps editable input', () => {
  it('verifies the exact query in the known result wrapper description after the editable child disappears', async () => {
    const appium = await appiumFixture({ nestedInput: true, queryInDescription: true });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await device.search('spicy duck neck flushing');
    expect((await device.snapshot()).xml).toContain('content-desc="spicy duck neck flushing"');
    await device.close();
  });
  it('does not use matching description text from an unknown wrapper resource id', async () => {
    const appium = await appiumFixture({ nestedInput: true, queryInDescription: true, wrapperResourceId: `${maps}:id/unrelated_header` });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await expect(device.search('sushi')).rejects.toMatchObject({ code: 'QUERY_NOT_VISIBLE' });
    await device.close();
  });
  it('types into the focused nested edit_text while retaining the empty wrapper for entry and exact result verification', async () => {
    const appium = await appiumFixture({ nestedInput: true });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await device.search('spicy duck neck flushing');
    expect(appium.calls.find((call) => call.path.endsWith('/click'))?.path).toBe('/session/native-session/element/search-field/click');
    expect(appium.calls.find((call) => call.path.endsWith('/clear'))?.path).toBe('/session/native-session/element/actual-input/clear');
    expect(appium.calls.find((call) => call.path.endsWith('/value'))).toMatchObject({ path: '/session/native-session/element/actual-input/value', body: { text: 'spicy duck neck flushing' } });
    expect((await device.snapshot()).xml).toContain(inputId);
    await device.close();
  });
  it('waits after one entry click for the native input to become focused before typing', async () => {
    let focusReads = 0;
    const appium = await appiumFixture({ nestedInput: true, inputFocused: () => ++focusReads >= 3 });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start(); await device.search('hot pot near me');
    expect(appium.calls.filter(call => call.path.endsWith('/click'))).toHaveLength(1);
    const typing = appium.calls.findIndex(call => call.path.endsWith('/value'));
    expect(appium.calls.slice(0, typing).filter(call => call.path.endsWith('/actual-input/attribute/focused'))).toHaveLength(3);
    await device.close();
  });
  it('bounds a stalled native focus attribute and never types without focus proof', async () => {
    const appium = await appiumFixture({ nestedInput: true, stallFocusedAttribute: true });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    const started = Date.now();
    await expect(device.search('sushi')).rejects.toMatchObject({ code: 'UNKNOWN_SEARCH_LAYOUT' });
    expect(Date.now() - started).toBeLessThan(750);
    expect(appium.calls.filter(call => call.path.endsWith('/click'))).toHaveLength(1);
    expect(appium.calls.some(call => call.path.endsWith('/clear') || call.path.endsWith('/value'))).toBe(false);
    await device.close();
  });
  it.each([{ nestedInput: true, inputFocused: false }, { nestedInput: false, wrapperFocused: false }])('refuses to type when the only supported input is not focused: %j', async (options) => {
    const appium = await appiumFixture(options);
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await expect(device.search('sushi')).rejects.toMatchObject({ code: 'UNKNOWN_SEARCH_LAYOUT' });
    expect(appium.calls.some((call) => call.path.endsWith('/value') || call.path.endsWith('/clear'))).toBe(false);
    await device.close();
  });
});


describe('NativeMapsDevice automatic point preparation', () => {
  it.each(['Try gas stations, ATMs', 'Try coffee nearby'])('prepares a blank native home with dynamic hint %s rather than a fixed placeholder label', async (hint) => {
    const xml = readFileSync(new URL('./fixtures/android/home-dynamic-hint.xml', import.meta.url), 'utf8').replaceAll('Try gas stations, ATMs', hint);
    const appium = await appiumFixture({ initiallyFollowing: true, source: () => xml });
    const fixture = adbFixture();
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: fixture.adb });
    await device.start();
    expect(await device.setLocation(location)).toMatchObject({
      injectionStatus: 'sent', deviceLocationStatus: 'matched', preparation: { viewportStatus: 'following', viewportAction: 'already_following' },
    });
    expect(fixture.calls.filter(args => args.includes('geo'))).toHaveLength(1);
    expect(appium.calls.some(call => call.path.endsWith('/click'))).toBe(false);
    await device.close();
  });

  it.each([
    ['nonempty wrapper query', (xml: string) => xml.replace('text="" content-desc="Try gas stations, ATMs"', 'text="hot pot" content-desc="Try gas stations, ATMs"')],
    ['missing native hint', (xml: string) => xml.replace('hint="Try gas stations, ATMs"', '')],
    ['not showing hint', (xml: string) => xml.replace('showing-hint="true"', 'showing-hint="false"')],
    ['mismatched hint', (xml: string) => xml.replace('hint="Try gas stations, ATMs"', 'hint="Search here"')],
    ['mismatched child query', (xml: string) => xml.replace('text="Try gas stations, ATMs"', 'text="hot pot"')],
    ['hint in wrong ancestry', (xml: string) => xml.replace(/(<android\.widget\.TextView\b[^>]*hint="Try gas stations, ATMs"[^>]*\/>)/, '<android.widget.FrameLayout package="com.google.android.apps.maps">$1</android.widget.FrameLayout>')],
    ['foreign-package hint', (xml: string) => xml.replace(/<android\.widget\.TextView\b[^>]*hint="Try gas stations, ATMs"[^>]*\/>/, value => value.replace(`package="${maps}"`, 'package="com.example.other"'))],
    ['duplicate wrapper', (xml: string) => xml.replace('</hierarchy>', `<node package="${maps}" resource-id="${fieldId}" class="android.widget.EditText" text="" content-desc="Search here"/></hierarchy>`)],
    ['missing Explore', (xml: string) => xml.replace(`${maps}:id/explore_tab_strip_button`, `${maps}:id/other_tab_strip_button`)],
    ['existing results', (xml: string) => xml.replace('</hierarchy>', `<node package="${maps}" resource-id="${maps}:id/search_list_layout"/></hierarchy>`)],
    ['close control', (xml: string) => xml.replace('</hierarchy>', `<node package="${maps}" resource-id="${maps}:id/terra_navigation_header_close_button"/></hierarchy>`)],
  ])('does not inject GPS for %s in a dynamic hint layout', async (_label, mutate) => {
    const xml = mutate(readFileSync(new URL('./fixtures/android/home-dynamic-hint.xml', import.meta.url), 'utf8'));
    const appium = await appiumFixture({ initiallyFollowing: true, source: () => xml });
    const fixture = adbFixture();
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 150 }, { adb: fixture.adb });
    await device.start();
    expect(await device.setLocation(location)).toMatchObject({ injectionStatus: 'failed', preparation: { homeReadyAt: null } });
    expect(fixture.calls.some(args => args.includes('geo'))).toBe(false);
    await device.close();
  });

  it('clears prior results before injecting GPS, re-centers through its parent, and retains a stable pre-search proof', async () => {
    const appium = await appiumFixture({ initialQuery: 'old query' });
    const base = adbFixture();
    let clearSeenAtInjection = false;
    const adb: AdbExecutor = async (file, args, options) => {
      if (args.includes('geo')) clearSeenAtInjection = appium.calls.some(call => call.path.endsWith('/close-results/click'));
      return base.adb(file, args, options);
    };
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb });
    await device.start();
    const result = await device.setLocation(location);
    expect(clearSeenAtInjection).toBe(true);
    expect(result).toMatchObject({ deviceLocationStatus: 'matched', preparation: { viewportStatus: 'following', viewportAction: 'recenter_clicked', beforeElapsedMs: 100000, observedElapsedMs: 104000, readbackElapsedMs: 105000, accuracyMeters: 10 } });
    expect((await device.snapshot()).xml).toContain('Enter compass mode');
    expect((await device.snapshot()).xml).not.toContain('old query');
    expect(appium.calls.find(call => call.body?.using === 'xpath')?.body.value).toContain('Re-center map to your location');
    await device.close();
  });
  it('waits through delayed close transitions without repeated clicks or consuming its action budget on observations', async () => {
    let transitionReads = 0;
    const appium = await appiumFixture({ initialQuery: 'old query', source: (_read, keyword, following) => {
      if (keyword || transitionReads++ < 2) return resultsXml('old query')
        .replace('</hierarchy>', `<node package="${maps}" resource-id="${maps}:id/terra_navigation_header_close_button" clickable="true" content-desc="Close"/></hierarchy>`);
      if (transitionReads < 6) return `<hierarchy><node package="${maps}" class="android.widget.FrameLayout"><node class="android.widget.ProgressBar"/></node></hierarchy>`;
      return homeXml(following);
    } });
    const base = adbFixture();
    let transitionFinishedAtInjection = false;
    const adb: AdbExecutor = async (file, args, options) => {
      if (args.includes('geo')) transitionFinishedAtInjection = transitionReads >= 6;
      return base.adb(file, args, options);
    };
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb });
    await device.start();
    const result = await device.setLocation(location);
    expect(result).toMatchObject({ deviceLocationStatus: 'matched', preparation: { viewportStatus: 'following' } });
    expect(transitionFinishedAtInjection).toBe(true);
    expect(appium.calls.filter(call => call.path.endsWith('/close-results/click'))).toHaveLength(1);
    await device.close();
  });
  it('automatically returns A to B to A without accepting the prior point or prior query as proof', async () => {
    const appium = await appiumFixture();
    const base = adbFixture();
    let clock = 100000;
    let fixTime = 99000;
    let latitude = 34;
    let longitude = -81;
    let requested = { latitude, longitude };
    let stalePending = false;
    const fixes: number[] = [];
    const adb: AdbExecutor = async (file, args, options) => {
      const command = args.slice(args.indexOf('-s') + 2).join(' ');
      if (command === 'shell cat /proc/uptime') { clock += 20; return { stdout: Buffer.from(`${clock / 1000} 0`), stderr: Buffer.alloc(0) }; }
      if (command.startsWith('emu geo fix')) {
        requested = { latitude: Number(args.at(-1)), longitude: Number(args.at(-2)) };
        fixes.push(clock);
        stalePending = true;
        return { stdout: Buffer.from('OK'), stderr: Buffer.alloc(0) };
      }
      if (command === 'shell dumpsys location') {
        if (!stalePending && fixes.length) { latitude = requested.latitude; longitude = requested.longitude; fixTime = clock + 10; }
        stalePending = false;
        return { stdout: Buffer.from(readyProvider + ` last location=Location[gps ${latitude},${longitude} hAcc=10 et=+${fixTime}ms]`), stderr: Buffer.alloc(0) };
      }
      return base.adb(file, args, options);
    };
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb });
    await device.start();
    const receipts = [];
    for (const [index, point] of [location, { ...location, id: 'second', latitude: 36, longitude: -81 }, location].entries()) {
      const receipt = await device.setLocation(point);
      receipts.push(receipt);
      expect(receipt).toMatchObject({ deviceLocationStatus: 'matched', observed: { latitude: point.latitude, longitude: point.longitude }, preparation: { viewportStatus: 'following' } });
      expect(receipt.preparation!.observedElapsedMs!).toBeGreaterThanOrEqual(fixes[index]!);
      const beforeSearch = await device.snapshot();
      expect(beforeSearch.xml).toContain('Search here');
      expect(beforeSearch.xml).not.toContain('same keyword');
      await device.search('same keyword');
      expect((await device.snapshot()).xml).toContain('same keyword');
    }
    expect(receipts[2]!.preparation!.observedElapsedMs!).toBeGreaterThan(receipts[0]!.preparation!.observedElapsedMs!);
    expect(appium.calls.filter(call => call.path.endsWith('/close-results/click'))).toHaveLength(2);
    await device.close();
  });
  it('does not click Enter compass mode when the map already follows location', async () => {
    const appium = await appiumFixture({ initiallyFollowing: true });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    expect(await device.setLocation(location)).toMatchObject({ preparation: { viewportStatus: 'following', viewportAction: 'already_following' } });
    expect(appium.calls.some(call => call.path.endsWith('/click'))).toBe(false);
    await device.close();
  });
  it('recovers a zero recenter lookup by observing fresh following state without a click', async () => {
    const appium = await appiumFixture({ locationLookup: selector => selector.includes('Re-center map') ? { following: true, result: [] } : undefined });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    expect(await device.setLocation(location)).toMatchObject({ deviceLocationStatus: 'matched', preparation: { viewportStatus: 'following', viewportAction: 'already_following' } });
    expect(appium.calls.some(call => call.path.endsWith('/click'))).toBe(false);
    expect(appium.calls.filter(call => call.body?.using === 'xpath' && call.body.value.includes('Re-center map'))).toHaveLength(1);
    await device.close();
  });
  it.each([1, 2])('does not click a cached recenter parent that changed to following during lookup %i', async transitionAt => {
    let reads = 0;
    const appium = await appiumFixture({ locationLookup: selector => selector.includes('Re-center map') && ++reads === transitionAt
      ? { following: true, result: [{ 'element-6066-11e4-a52e-4f735466cecf': 'recenter-parent' }] } : undefined });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    expect(await device.setLocation(location)).toMatchObject({ preparation: { viewportStatus: 'following', viewportAction: 'already_following' } });
    expect(appium.calls.some(call => call.path.endsWith('/click'))).toBe(false);
    await device.close();
  });
  it('recovers one missing recenter lookup while still on the home map and clicks at most once', async () => {
    let missing = true;
    const appium = await appiumFixture({ locationLookup: selector => {
      if (missing && selector.includes('Re-center map')) { missing = false; return { result: [] }; }
      return undefined;
    } });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    expect(await device.setLocation(location)).toMatchObject({ preparation: { viewportStatus: 'following', viewportAction: 'recenter_clicked' } });
    expect(appium.calls.filter(call => call.path.endsWith('/click'))).toHaveLength(1);
    await device.close();
  });
  it('keeps a persistently missing recenter control bounded and unverified without clicking', async () => {
    const appium = await appiumFixture({ locationLookup: selector => selector.includes('Re-center map') ? { result: [] } : undefined });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 180 }, { adb: adbFixture().adb });
    await device.start();
    const start = Date.now();
    const result = await device.setLocation(location);
    expect(result).toMatchObject({ deviceLocationStatus: 'matched', preparation: { viewportStatus: 'unverified', viewportAction: null } });
    expect(Date.now() - start).toBeLessThan(1500);
    expect(appium.calls.some(call => call.path.endsWith('/click'))).toBe(false);
    await device.close();
  });
  it('does not recover a missing recenter control when fresh home state is unknown', async () => {
    let missing = false;
    const appium = await appiumFixture({
      locationLookup: selector => { if (selector.includes('Re-center map')) { missing = true; return { result: [] }; } return undefined; },
      source: (_read, _keyword, following) => missing ? `<hierarchy><node package="${maps}" text="Unknown page"/></hierarchy>` : homeXml(following),
    });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    expect(await device.setLocation(location)).toMatchObject({ preparation: { viewportStatus: 'unverified', viewportAction: null }, note: expect.stringContaining('LOCATION_HOME_LOST') });
    expect(appium.calls.some(call => call.path.endsWith('/click'))).toBe(false);
    expect(appium.calls.filter(call => call.body?.using === 'xpath' && call.body.value.includes('Re-center map'))).toHaveLength(1);
    await device.close();
  });
  it('stops zero recenter recovery on cancellation without sending a click', async () => {
    const controller = new AbortController();
    const appium = await appiumFixture({ locationLookup: selector => {
      if (selector.includes('Re-center map')) { controller.abort(); return { result: [] }; }
      return undefined;
    } });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb, signal: controller.signal });
    await device.start();
    expect(await device.setLocation(location)).toMatchObject({ preparation: { viewportStatus: 'unverified', viewportAction: null }, note: expect.stringContaining('CANCELLED') });
    expect(appium.calls.some(call => call.path.endsWith('/click'))).toBe(false);
    await device.close();
  });
  it.each([null, [{ 'element-6066-11e4-a52e-4f735466cecf': 'one' }, { 'element-6066-11e4-a52e-4f735466cecf': 'two' }], [{}]])('does not recover malformed or duplicate recenter lookup %j', async result => {
    const appium = await appiumFixture({ locationLookup: selector => selector.includes('Re-center map') ? { result } : undefined });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    expect(await device.setLocation(location)).toMatchObject({ preparation: { viewportStatus: 'unverified', viewportAction: null }, note: expect.stringContaining('UNKNOWN_LOCATION_LAYOUT') });
    expect(appium.calls.filter(call => call.body?.using === 'xpath' && call.body.value.includes('Re-center map'))).toHaveLength(1);
    expect(appium.calls.some(call => call.path.endsWith('/click'))).toBe(false);
    await device.close();
  });
  it('rejects a replacement parent found during recenter revalidation without clicking either', async () => {
    let reads = 0;
    const appium = await appiumFixture({ locationLookup: selector => selector.includes('Re-center map') && ++reads === 2
      ? { result: [{ 'element-6066-11e4-a52e-4f735466cecf': 'replacement-parent' }] } : undefined });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    expect(await device.setLocation(location)).toMatchObject({ preparation: { viewportStatus: 'unverified', viewportAction: null }, note: expect.stringContaining('UNKNOWN_LOCATION_LAYOUT') });
    expect(appium.calls.some(call => call.path.endsWith('/click'))).toBe(false);
    await device.close();
  });
  it('never repeats a recenter click after a transport timeout', async () => {
    const appium = await appiumFixture({ stallRecenterClick: true });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 180 }, { adb: adbFixture().adb });
    await device.start();
    expect(await device.setLocation(location)).toMatchObject({ preparation: { viewportStatus: 'unverified' } });
    expect(appium.calls.filter(call => call.path.endsWith('/recenter-parent/click'))).toHaveLength(1);
    await device.close();
  });
  it('waits for current Maps GPS registration and a first fix later than three seconds', async () => {
    const appium = await appiumFixture();
    const base = adbFixture();
    let injectionAt = 0;
    let providerReads = 0;
    const adb: AdbExecutor = async (file, args, options) => {
      if (args.includes('geo')) injectionAt = Date.now();
      if (args.slice(-2).join(' ') === 'dumpsys location') {
        if (!injectionAt && ++providerReads < 3) return { stdout: Buffer.from('gps provider:\n service: ProviderRequest[OFF]\n enabled=true\n allowed=true\n mStarted=false\nEvent Log:\n gps provider: Maps requested GPS'), stderr: Buffer.alloc(0) };
        if (injectionAt && Date.now() - injectionAt < 3250) return { stdout: Buffer.from(readyProvider + ' last location=Location[gps 35.000000,-80.000000 hAcc=10 et=+1m30s]'), stderr: Buffer.alloc(0) };
      }
      return base.adb(file, args, options);
    };
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 6000 }, { adb });
    await device.start();
    const result = await device.setLocation(location);
    expect(providerReads).toBeGreaterThanOrEqual(3);
    expect(Date.now() - injectionAt).toBeGreaterThanOrEqual(3250);
    expect(result).toMatchObject({ deviceLocationStatus: 'matched', preparation: { viewportStatus: 'following' } });
    await device.close();
  }, 10000);
  it('does not inject when only a historical GPS registration refers to Maps', async () => {
    const appium = await appiumFixture();
    const fixture = adbFixture({ 'shell dumpsys location': 'gps provider:\n service: ProviderRequest[OFF]\n enabled=true\n allowed=true\n mStarted=false\nEvent Log:\n service: ProviderRequest[@+997ms, WorkSource{com.google.android.apps.maps}]\n mStarted=true' });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 220 }, { adb: fixture.adb });
    await device.start();
    const result = await device.setLocation(location);
    expect(result).toMatchObject({ injectionStatus: 'failed', deviceLocationStatus: 'unverified', preparation: { providerReadyAt: null, viewportStatus: 'unverified' } });
    expect(fixture.calls.some(args => args.includes('geo'))).toBe(false);
    await device.close();
  });
  it('rejects unsupported home state before injection and preserves diagnostic capture', async () => {
    const appium = await appiumFixture({ source: () => `<hierarchy><node package="${maps}" text="Unknown location control"/></hierarchy>` });
    const fixture = adbFixture();
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: fixture.adb });
    await device.start();
    const result = await device.setLocation(location);
    expect(result).toMatchObject({ injectionStatus: 'failed', preparation: { homeReadyAt: null, viewportStatus: 'unverified' } });
    expect(fixture.calls.some(args => args.includes('geo'))).toBe(false);
    expect((await device.snapshot()).xml).toContain('Unknown location control');
    await device.close();
  });
  it('leaves viewport unverified when re-center does not reach follow mode', async () => {
    const appium = await appiumFixture({ stuckRecenter: true });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url, keywordTimeoutMs: 250 }, { adb: adbFixture().adb });
    await device.start();
    const result = await device.setLocation(location);
    expect(result).toMatchObject({ deviceLocationStatus: 'matched', preparation: { viewportStatus: 'unverified', viewportAction: 'recenter_clicked' } });
    await device.close();
  });
});


const rankingFixture = (name: string): string => readFileSync(new URL(`./fixtures/android/ranking/${name}.xml`, import.meta.url), 'utf8');

describe('NativeMapsDevice adaptive OCR-backed native gestures', () => {
  const observed = (query = 3) => {
    const base = new URL(`./fixtures/android/repair-probe-20261021/q000${query}-frame02`, import.meta.url);
    const xml = readFileSync(`${base.pathname}.xml`, 'utf8');
    const screenshot = readFileSync(`${base.pathname}.png`);
    const ocr = JSON.parse(readFileSync(`${base.pathname}.ocr.json`, 'utf8'));
    const name = query === 2 ? 'Wonder Bayside' : 'Tea Magic';
    const title = ocr.lines.find((line: any) => line.text === name);
    const rating = ocr.lines.find((line: any) => line.bounds.top > title.bounds.bottom && /^\d[.,]/u.test(line.text));
    const evidence: NativeScrollEvidence = {
      sourceXml: xml, listBounds: { left: 0, top: 272, right: 720, bottom: 1232 },
      anchors: parseUiNodes(xml).filter(node => node.clickable && node.bounds && /^(Directions|Call|Website|Order|Menu)$/u.test(node.description))
        .map(node => ({ text: node.description, bounds: node.bounds! })),
      ocrScrollAnchor: { name, nameBounds: title.bounds, ratingBounds: rating.bounds, nameConfidence: title.confidence, imageSha256: ocr.imageSha256 },
    };
    return { evidence, screenshot, keyword: query === 2 ? 'chinese food' : 'bubble tea near me', ocr };
  };
  const setup = async (query = 3, capture = true) => {
    const fixture = observed(query);
    const appium = await appiumFixture({ source: () => fixture.evidence.sourceXml, screenshot: fixture.screenshot.toString('base64'),
      listRect: () => ({ x: 0, y: 272, width: 720, height: 960 }) });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start(); await device.search(fixture.keyword);
    if (capture) await device.snapshot();
    return { ...fixture, appium, device };
  };
  const movements = (calls: Array<{ path: string; body: any }>) => calls.filter(call => call.path.endsWith('/actions')).map(call => {
    const actions = call.body.actions[0].actions;
    return { distance: actions[0].y - actions[2].y, duration: actions[2].duration, pause: actions[3].duration };
  });
  it.each([2, 3])('allows a bounded 35 percent attempt from real q000%i frame02 OCR and native controls', async query => {
    const { device, evidence, appium } = await setup(query);
    const before = structuredClone(evidence);
    await device.scroll(evidence);
    expect(movements(appium.calls)).toEqual([{ distance: 336, duration: 650, pause: 300 }]);
    expect(evidence).toEqual(before);
    await device.close();
  });
  it('caps movement at the actual first title headroom rather than cropping its OCR anchor', async () => {
    const { device, evidence, appium, ocr } = await setup();
    const title = ocr.lines.find((line: any) => line.text === 'Only Bear Chicken & Boba');
    const rating = ocr.lines.find((line: any) => line.bounds.top > title.bounds.bottom && /^4\.7/u.test(line.text));
    evidence.ocrScrollAnchor = { name: title.text, nameBounds: title.bounds, ratingBounds: rating.bounds, nameConfidence: title.confidence, imageSha256: ocr.imageSha256 };
    await device.scroll(evidence);
    expect(movements(appium.calls)[0]?.distance).toBe(109);
    await device.close();
  });
  it.each(['no OCR anchor', 'no native anchors', 'one native control', 'duplicate native control'])('retains the 10 percent fallback with %s', async mode => {
    const { device, evidence, appium } = await setup();
    if (mode === 'no OCR anchor') delete evidence.ocrScrollAnchor;
    if (mode === 'no native anchors') evidence.anchors = [];
    if (mode === 'one native control') evidence.anchors = evidence.anchors.slice(0, 1);
    if (mode === 'duplicate native control') evidence.anchors = [evidence.anchors[0]!, evidence.anchors[0]!];
    await device.scroll(evidence);
    expect(movements(appium.calls)[0]?.distance).toBe(96);
    await device.close();
  });
  it.each(['empty name', 'control character', 'overlong name', 'low confidence', 'nonfinite confidence', 'excess confidence', 'invalid hash', 'wrong PNG hash',
    'out of list', 'inverted title', 'nonfinite title', 'missing title', 'rating above name', 'rating gap', 'rating outside list'])('rejects %s before issuing a gesture', async fault => {
    const { device, evidence, appium } = await setup();
    const anchor = evidence.ocrScrollAnchor!;
    if (fault === 'empty name') anchor.name = ' ';
    if (fault === 'control character') anchor.name = 'Tea\nMagic';
    if (fault === 'overlong name') anchor.name = 'x'.repeat(301);
    if (fault === 'low confidence') anchor.nameConfidence = 39;
    if (fault === 'nonfinite confidence') anchor.nameConfidence = NaN;
    if (fault === 'excess confidence') anchor.nameConfidence = 101;
    if (fault === 'invalid hash') anchor.imageSha256 = 'not a hash';
    if (fault === 'wrong PNG hash') anchor.imageSha256 = 'a'.repeat(64);
    if (fault === 'out of list') anchor.nameBounds.top = 271;
    if (fault === 'inverted title') anchor.nameBounds.bottom = anchor.nameBounds.top;
    if (fault === 'nonfinite title') anchor.nameBounds.top = Infinity;
    if (fault === 'missing title') anchor.nameBounds = null as any;
    if (fault === 'rating above name') anchor.ratingBounds.top = anchor.nameBounds.bottom - 1;
    if (fault === 'rating gap') { anchor.nameBounds.top = 500; anchor.nameBounds.bottom = 530; }
    if (fault === 'rating outside list') anchor.ratingBounds.right = 721;
    await expect(device.scroll(evidence)).rejects.toMatchObject({ code: 'UNKNOWN_SCROLL_LAYOUT' });
    expect(movements(appium.calls)).toEqual([]);
    await device.close();
  });
  it('requires the OCR hash to match a snapshot captured by this device session', async () => {
    const { device, evidence, appium } = await setup(3, false);
    await expect(device.scroll(evidence)).rejects.toMatchObject({ code: 'UNKNOWN_SCROLL_LAYOUT' });
    expect(movements(appium.calls)).toEqual([]);
    await device.close();
  });
  it('consumes the snapshot proof before a gesture and requires a fresh captured frame for another adaptive attempt', async () => {
    const { device, evidence, appium } = await setup();
    await device.scroll(evidence);
    await expect(device.scroll(evidence)).rejects.toMatchObject({ code: 'UNKNOWN_SCROLL_LAYOUT' });
    expect(movements(appium.calls)).toHaveLength(1);
    await device.snapshot(); await device.scroll(evidence);
    expect(movements(appium.calls)).toHaveLength(2);
    await device.close();
  });
});

describe('NativeMapsDevice bounded native result list gestures', () => {
  const overlapEvidence = (name = 'before') => {
    const frame = JSON.parse(readFileSync(new URL(`./fixtures/android/ranking/trial-overlap-controls-${name}.listings.json`, import.meta.url), 'utf8'));
    return { sourceXml: rankingFixture(`trial-overlap-controls-${name}`), listBounds: frame.listBounds, anchors: frame.anchors };
  };
  it('caps the actual frame15 scroll attempt at10% without claiming measured movement', async () => {
    const evidence = overlapEvidence();
    const before = structuredClone(evidence);
    const appium = await appiumFixture({ source: () => evidence.sourceXml, listRect: () => ({ x: 0, y: 274, width: 720, height: 958 }) });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start(); await device.search('hot pot near me');
    await device.scroll(evidence);
    const gesture = appium.calls.find(call => call.path.endsWith('/actions'))!.body.actions;
    expect(gesture).toEqual([{ type: 'pointer', id: 'maps-result-scroll', parameters: { pointerType: 'touch' }, actions: [
      { type: 'pointerMove', duration: 0, origin: 'viewport', x: 360, y: 1136 },
      { type: 'pointerDown', button: 0 },
      { type: 'pointerMove', duration: 650, origin: 'viewport', x: 360, y: 1040 },
      { type: 'pause', duration: 300 },
      { type: 'pointerUp', button: 0 },
    ] }]);
    expect(appium.calls.some(call => call.body?.script === 'mobile: scrollGesture' || call.body?.script === 'mobile: dragGesture')).toBe(false);
    expect(evidence).toEqual(before);
    // This checks a planned gesture only. The recorded frame16 still has no
    // full/full nonnegative anchor pair; no synthetic next rank is accepted.
    const after = overlapEvidence('after');
    const full = (a: any) => a.bounds.top > 277 && a.bounds.bottom < 1229;
    expect(evidence.anchors.filter(full).some((a: any) => after.anchors.filter(full).some((b: any) =>
      a.text === b.text && a.bounds.top >= b.bounds.top && a.bounds.bottom - a.bounds.top === b.bounds.bottom - b.bounds.top))).toBe(false);
    await device.close();
  });
  it.each(['q0001', 'q0002'])('floors the actual stationary %s attempt at10% when two anchors are near the list top', async query => {
    const frame = JSON.parse(readFileSync(new URL(`./fixtures/android/ranking/trial-small-scroll-stalled-${query}.listings.json`, import.meta.url), 'utf8'));
    const evidence = { sourceXml: rankingFixture(`trial-small-scroll-stalled-${query}`), listBounds: frame.listBounds, anchors: frame.anchors };
    const before = structuredClone(evidence);
    const appium = await appiumFixture({ source: () => evidence.sourceXml, listRect: () => ({ x: 0, y: 274, width: 720, height: 958 }) });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start(); await device.search('hot pot near me'); await device.scroll(evidence);
    const actions = appium.calls.find(call => call.path.endsWith('/actions'))!.body.actions[0].actions;
    expect(actions[0].y - actions[2].y).toBe(96);
    expect(evidence).toEqual(before);
    // The floor may move these two anchors off-screen. The unchanged next-frame
    // reconciler, not this gesture plan, must prove continuity before ranks grow.
    await device.close();
  });
  it('caps the prior35% plan at10% even when native controls have enough vertical headroom', async () => {
    const evidence = overlapEvidence('after');
    const appium = await appiumFixture({ source: () => evidence.sourceXml, listRect: () => ({ x: 0, y: 274, width: 720, height: 958 }) });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start(); await device.search('hot pot near me'); await device.scroll(evidence);
    const actions = appium.calls.find(call => call.path.endsWith('/actions'))!.body.actions[0].actions;
    expect(actions[0].y - actions[2].y).toBe(96);
    await device.close();
  });
  it('caps the actual Trial21 q3 prior23% plan at10% while preserving all native evidence', async () => {
    const frame = JSON.parse(readFileSync(new URL('./fixtures/android/ranking/trial21-q3-before-overlap-stop.listings.json', import.meta.url), 'utf8'));
    const evidence = { sourceXml: rankingFixture('trial21-q3-before-overlap-stop'), listBounds: frame.listBounds, anchors: frame.anchors };
    const before = structuredClone(evidence);
    const appium = await appiumFixture({ source: () => evidence.sourceXml, listRect: () => ({ x: 0, y: 274, width: 720, height: 958 }) });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start(); await device.search('spicy duck neck flushing'); await device.scroll(evidence);
    const gestures = appium.calls.filter(call => call.path.endsWith('/actions'));
    expect(gestures).toHaveLength(1);
    const actions = gestures[0]!.body.actions[0].actions;
    expect(actions[0].y - actions[2].y).toBe(96);
    expect(actions[2].duration).toBe(650);
    expect(actions[3]).toEqual({ type: 'pause', duration: 300 });
    expect(actions[4]).toEqual({ type: 'pointerUp', button: 0 });
    expect(evidence).toEqual(before);
    // HTTP completion and a smaller command still do not prove the next frame's
    // overlap. No historical output or reconciliation acceptance is changed.
    await device.close();
  });
  it.each(['single', 'no full anchors', 'no anchors', 'duplicate'])('uses a bounded positive attempt with %s without claiming overlap', async mode => {
    const evidence = overlapEvidence();
    evidence.anchors = mode === 'single' ? [evidence.anchors[0]] : mode === 'duplicate' ? [evidence.anchors[0], evidence.anchors[0]] :
      mode === 'no full anchors' ? evidence.anchors.slice(4) : [];
    const appium = await appiumFixture({ source: () => evidence.sourceXml, listRect: () => ({ x: 0, y: 274, width: 720, height: 958 }) });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start(); await device.search('hot pot near me'); await device.scroll(evidence);
    const actions = appium.calls.find(call => call.path.endsWith('/actions'))!.body.actions[0].actions;
    expect(actions[0].y - actions[2].y).toBe(96);
    expect(actions[0].x).toBe(360); expect(actions[2].x).toBe(360);
    expect(actions[2].y).toBeGreaterThan(274); expect(actions[0].y).toBeLessThan(1232);
    await device.close();
  });
  it.each(['stale XML', 'missing list bounds', 'NaN list bounds', 'changed list bounds', 'negative anchor', 'inverted anchor', 'nonfinite anchor', 'invented anchor', 'missing anchors', 'null anchor', 'string coordinate'])('refuses %s before issuing a scroll', async fault => {
    const evidence = overlapEvidence(); const source = evidence.sourceXml;
    if (fault === 'stale XML') evidence.sourceXml += '\n';
    if (fault === 'missing list bounds') evidence.listBounds = null;
    if (fault === 'NaN list bounds') evidence.listBounds.top = NaN;
    if (fault === 'changed list bounds') evidence.listBounds.top += 1;
    if (fault === 'negative anchor') evidence.anchors[0].bounds.top = -1;
    if (fault === 'inverted anchor') evidence.anchors[0].bounds.bottom = evidence.anchors[0].bounds.top;
    if (fault === 'nonfinite anchor') evidence.anchors[0].bounds.top = Infinity;
    if (fault === 'invented anchor') evidence.anchors[0].text = 'Invented control';
    if (fault === 'missing anchors') evidence.anchors = undefined;
    if (fault === 'null anchor') evidence.anchors = [null];
    if (fault === 'string coordinate') evidence.anchors[0].bounds.top = '444';
    const appium = await appiumFixture({ source: () => source, listRect: () => ({ x: 0, y: 274, width: 720, height: 958 }) });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start(); await device.search('hot pot near me');
    await expect(device.scroll(evidence)).rejects.toMatchObject({ code: fault === 'stale XML' ? 'SOURCE_CHANGED' : 'UNKNOWN_SCROLL_LAYOUT' });
    expect(appium.calls.some(call => call.path.endsWith('/actions') || call.body?.script === 'mobile: scrollGesture')).toBe(false); await device.close();
  });

  it.each(['same list', 'unknown layout'])('reports SOURCE_CHANGED before element lookup for a changed %s', async mode => {
    const evidence = overlapEvidence();
    let live = evidence.sourceXml;
    const appium = await appiumFixture({ source: () => live, listRect: () => ({ x: 0, y: 274, width: 720, height: 958 }) });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start(); await device.search('hot pot near me');
    const before = appium.calls.length;
    live = mode === 'same list' ? live + '\n' : `<hierarchy><node package="${maps}" text="Changed native layout"/></hierarchy>`;
    await expect(device.scroll(evidence)).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    const attempt = appium.calls.slice(before);
    expect(attempt.some(call => call.body?.value === `${maps}:id/search_list_layout`)).toBe(false);
    expect(attempt.some(call => call.path.endsWith('/actions') || call.body?.script === 'mobile: scrollGesture')).toBe(false);
    if (mode === 'same list') {
      // A caller must supply freshly persisted evidence; retrying the old one
      // still sends no gesture. A new, unchanged evidence pair can proceed.
      await expect(device.scroll(evidence)).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
      await device.scroll({ ...evidence, sourceXml: live });
      expect(appium.calls.filter(call => call.path.endsWith('/actions') || call.body?.script === 'mobile: scrollGesture')).toHaveLength(1);
    }
    await device.close();
  });
  it('keeps wrong foreground fatal before considering a source-change recapture', async () => {
    const evidence = overlapEvidence();
    const options = { foreground: maps, source: () => evidence.sourceXml };
    const appium = await appiumFixture(options);
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start(); await device.search('hot pot near me');
    const before = appium.calls.length; options.foreground = 'com.example.other';
    await expect(device.scroll({ ...evidence, sourceXml: evidence.sourceXml + '\n' })).rejects.toMatchObject({ code: 'WRONG_FOREGROUND' });
    expect(appium.calls.slice(before).some(call => call.path.endsWith('/source') || call.path.endsWith('/actions') || call.body?.script === 'mobile: scrollGesture')).toBe(false);
    await device.close();
  });


  it.each(['timeout', 'http-error', 'non-null'] as const)('does not retry or fall back after an uncertain W3C %s outcome', async actionOutcome => {
    const evidence = overlapEvidence();
    const appium = await appiumFixture({ source: () => evidence.sourceXml, listRect: () => ({ x: 0, y: 274, width: 720, height: 958 }), actionOutcome });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb, commandTimeoutMs: 200 });
    await device.start(); await device.search('hot pot near me');
    await expect(device.scroll(evidence)).rejects.toMatchObject({ code: actionOutcome === 'timeout' ? 'COMMAND_TIMEOUT' : 'APPIUM_PROTOCOL_ERROR' });
    expect(appium.calls.filter(call => call.path.endsWith('/actions'))).toHaveLength(1);
    expect(appium.calls.some(call => call.body?.script === 'mobile: scrollGesture' || call.body?.script === 'mobile: dragGesture')).toBe(false);
    await device.close();
  });

  it('never retries touch actions when cancellation arrives after dispatch', async () => {
    const evidence = overlapEvidence(); const controller = new AbortController();
    const appium = await appiumFixture({ source: () => evidence.sourceXml, listRect: () => ({ x: 0, y: 274, width: 720, height: 958 }), onScroll: () => { controller.abort(); return false; } });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb, signal: controller.signal });
    await device.start(); await device.search('hot pot near me');
    await expect(device.scroll(evidence)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(appium.calls.filter(call => call.path.endsWith('/actions'))).toHaveLength(1);
    expect(appium.calls.some(call => call.body?.script === 'mobile: scrollGesture' || call.body?.script === 'mobile: dragGesture')).toBe(false);
    await device.close();
  });

  it('expands the observed sheet once, verifies list top and leaves fresh GPS evidence unchanged', async () => {
    let expanded = false;
    const appium = await appiumFixture({ source: (_read, keyword, following) => keyword ? rankingFixture(expanded ? '04-expanded-sheet' : '02-expanded-source') : homeXml(following),
      onDrag: () => { expanded = true; } });
    const adb = adbFixture();
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adb.adb });
    await device.start();
    const locationProof = await device.setLocation(location);
    const before = structuredClone(locationProof);
    const gpsCommands = adb.calls.filter(args => args.includes('geo')).length;
    await device.search('hot pot near me');
    await device.prepareResults();
    expect((await device.snapshot()).xml).toBe(rankingFixture('04-expanded-sheet'));
    await device.prepareResults();
    expect(appium.calls.filter(call => call.body?.script === 'mobile: dragGesture').map(call => call.body.args[0])).toEqual([
      { startX: 360, startY: 356, endX: 360, endY: 160, speed: 900 },
    ]);
    expect(appium.calls.some(call => call.path.endsWith('/actions') || call.body?.script === 'mobile: scrollGesture')).toBe(false);
    expect(locationProof).toEqual(before);
    expect(adb.calls.filter(args => args.includes('geo'))).toHaveLength(gpsCommands);
    expect(appium.calls.find(call => call.path.endsWith('/appium/settings'))?.body.settings).toMatchObject({
      ignoreUnimportantViews: false, includeExtrasInPageSource: true, includeA11yActionsInPageSource: true, allowInvisibleElements: false,
    });
    await device.close();
  });
  it('returns only an advisory continuation and requires fresh native evidence after touch scrolling', async () => {
    let moved = false;
    const appium = await appiumFixture({ source: () => rankingFixture(moved ? '05-scroll-1' : '04-expanded-sheet'),
      listRect: () => moved ? { x: 0, y: 274, width: 720, height: 958 } : { x: 0, y: 272, width: 720, height: 960 },
      onScroll: () => { moved = true; return false; } });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await device.search('hot pot near me');
    await device.prepareResults();
    expect(await device.scroll()).toBe(true);
    expect((await device.snapshot()).xml).toBe(rankingFixture('05-scroll-1'));
    expect(await device.scroll()).toBe(true);
    expect(appium.calls.filter(call => call.path.endsWith('/actions')).map(call => {
      const actions = call.body.actions[0].actions; return [actions[0].x, actions[0].y, actions[2].x, actions[2].y];
    })).toEqual([[360, 1136, 360, 1040], [360, 1136, 360, 1040]]);
    expect(appium.calls.some(call => call.body?.script === 'mobile: scrollGesture')).toBe(false);
    expect(appium.calls.filter(call => call.path.endsWith('/elements') && call.body?.value === `${maps}:id/search_list_layout`)).toHaveLength(2);
    expect(appium.calls.some(call => call.path.endsWith('/window/rect'))).toBe(false);
    await device.close();
  });
  it('refuses to establish ranked preparation from an already scrolled list', async () => {
    const appium = await appiumFixture({ source: () => rankingFixture('05-scroll-1') });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await device.search('hot pot near me');
    await expect(device.prepareResults()).rejects.toMatchObject({ code: 'LIST_TOP_UNVERIFIED' });
    expect(appium.calls.some(call => call.path.endsWith('/actions') || /Gesture$/.test(call.body?.script ?? ''))).toBe(false);
    await device.close();
  });
  it('rejects a changed query, ancestry, map-only screen or horizontal-filter element before scrolling', async () => {
    for (const source of [
      rankingFixture('04-expanded-sheet').replaceAll('hot pot near me', 'old query'),
      rankingFixture('04-expanded-sheet').replaceAll('id/content_container', 'id/other_container'),
      homeXml(),
    ]) {
      let replacement: string | undefined;
      const appium = await appiumFixture({ source: () => replacement ?? rankingFixture('04-expanded-sheet') });
      const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
      await device.start();
      await device.search('hot pot near me');
      replacement = source;
      await expect(device.scroll()).rejects.toMatchObject({ code: 'UNKNOWN_SCROLL_LAYOUT' });
      expect(appium.calls.some(call => call.path.endsWith('/actions') || call.body?.script === 'mobile: scrollGesture')).toBe(false);
      await device.close();
    }
    const appium = await appiumFixture({ source: () => rankingFixture('04-expanded-sheet'), listResourceId: `${maps}:id/recycler_view` });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await device.search('hot pot near me');
    await expect(device.scroll()).rejects.toMatchObject({ code: 'UNKNOWN_SCROLL_LAYOUT' });
    expect(appium.calls.some(call => call.path.endsWith('/actions') || call.body?.script === 'mobile: scrollGesture')).toBe(false);
    await device.close();
  });
  it('does not treat absent native scroll actions as proof of the list top', async () => {
    const xml = rankingFixture('04-expanded-sheet').replace(/ actions="[^"]*"/gu, '');
    const appium = await appiumFixture({ source: () => xml });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await device.search('hot pot near me');
    await expect(device.prepareResults()).rejects.toMatchObject({ code: 'LIST_TOP_UNVERIFIED' });
    expect(appium.calls.some(call => call.path.endsWith('/actions') || /Gesture$/.test(call.body?.script ?? ''))).toBe(false);
    expect((await device.snapshot()).xml).toBe(xml);
    await expect(device.snapshot()).rejects.toMatchObject({ code: 'DIAGNOSTIC_CAPTURE_EXHAUSTED' });
    await device.close();
  });
  it('stops after one ineffective expansion and preserves a bounded diagnostic capture', async () => {
    const xml = rankingFixture('02-expanded-source');
    const appium = await appiumFixture({ source: () => xml });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await device.search('hot pot near me');
    await expect(device.prepareResults()).rejects.toMatchObject({ code: 'RESULT_SHEET_NOT_EXPANDED' });
    expect(appium.calls.filter(call => call.body?.script === 'mobile: dragGesture')).toHaveLength(1);
    expect((await device.snapshot()).xml).toBe(xml);
    await expect(device.snapshot()).rejects.toMatchObject({ code: 'DIAGNOSTIC_CAPTURE_EXHAUSTED' });
    await device.close();
  });
  it('rechecks the exact query after resolving the fresh native list element', async () => {
    let changed = false;
    const appium = await appiumFixture({ source: () => rankingFixture('04-expanded-sheet').replaceAll('hot pot near me', changed ? 'different query' : 'hot pot near me'),
      listRect: () => { changed = true; return { x: 0, y: 272, width: 720, height: 960 }; } });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await device.search('hot pot near me');
    await expect(device.scroll()).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    expect(appium.calls.some(call => call.path.endsWith('/actions') || call.body?.script === 'mobile: scrollGesture')).toBe(false);
    await device.close();
  });
  it('settles an exact native tall Sponsored result before expanding its sheet', async () => {
    const tall = readFileSync(new URL('./fixtures/android/native-scroll-tall-sponsored.xml', import.meta.url), 'utf8');
    let expanded = false;
    const appium = await appiumFixture({ source: () => expanded ? rankingFixture('04-expanded-sheet') : tall,
      onDrag: () => { expanded = true; } });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await device.search('hot pot near me');
    await device.prepareResults();
    expect((await device.snapshot()).xml).toBe(rankingFixture('04-expanded-sheet'));
    expect(appium.calls.filter(call => call.body?.script === 'mobile: dragGesture')).toHaveLength(1);
    await device.close();
  });
  it('leaves photo discovery preparation untouched and refuses its scroll', async () => {
    const xml = readFileSync(new URL('./fixtures/android/maps-26.41-photo-discovery.xml', import.meta.url), 'utf8');
    const appium = await appiumFixture({ source: () => xml });
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: adbFixture().adb });
    await device.start();
    await device.search('spicy duck neck flushing');
    await device.prepareResults();
    await expect(device.scroll()).rejects.toMatchObject({ code: 'UNKNOWN_SCROLL_LAYOUT' });
    expect(appium.calls.some(call => call.path.endsWith('/actions') || /Gesture$/.test(call.body?.script ?? ''))).toBe(false);
    await device.close();
  });
});

describe('NativeMapsDevice evidence-bound result swipe', () => {
  it('uses the validated native list with a 10% overlap-preserving touch, never a screen-size ADB swipe', async () => {
    const source = rankingFixture('04-expanded-sheet');
    const appium = await appiumFixture({ source: () => source });
    const fixture = adbFixture();
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: fixture.adb });
    await device.start();
    await device.search('hot pot near me');
    await device.swipeResults({ sourceXml: source, listBounds: { left: 0, top: 272, right: 720, bottom: 1232 }, anchors: [] });
    const movements = appium.calls.filter(call => call.path.endsWith('/actions'));
    expect(movements).toHaveLength(1);
    const actions = movements[0]!.body.actions[0].actions;
    expect([actions[0].x, actions[0].y, actions[2].x, actions[2].y]).toEqual([360, 1136, 360, 1040]);
    expect(fixture.calls.some(args => args.includes('swipe') || args.includes('size'))).toBe(false);
    expect(appium.calls.some(call => call.body?.script === 'mobile: scrollGesture')).toBe(false);
    await device.close();
  });
  it('rejects changed persisted XML before sending any gesture', async () => {
    const source = rankingFixture('04-expanded-sheet');
    const appium = await appiumFixture({ source: () => source });
    const fixture = adbFixture();
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: fixture.adb });
    await device.start(); await device.search('hot pot near me');
    await expect(device.swipeResults({ sourceXml: source + '\n', listBounds: { left: 0, top: 272, right: 720, bottom: 1232 }, anchors: [] })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    expect(appium.calls.some(call => call.path.endsWith('/actions') || /Gesture$/.test(call.body?.script ?? ''))).toBe(false);
    expect(fixture.calls.some(args => args.includes('swipe'))).toBe(false);
    await device.close();
  });
  it('refuses unknown native result geometry with no fallback gesture', async () => {
    const appium = await appiumFixture({ source: () => resultsXml('hot pot near me') });
    const fixture = adbFixture();
    const device = new NativeMapsDevice({ ...config, appiumUrl: appium.url }, { adb: fixture.adb });
    await device.start();
    await expect(device.swipeResults()).rejects.toMatchObject({ code: 'UNKNOWN_SCROLL_LAYOUT' });
    await device.search('hot pot near me');
    await expect(device.swipeResults()).rejects.toMatchObject({ code: 'UNKNOWN_SCROLL_LAYOUT' });
    expect(appium.calls.some(call => call.path.endsWith('/actions') || /Gesture$/.test(call.body?.script ?? ''))).toBe(false);
    expect(fixture.calls.some(args => args.includes('swipe'))).toBe(false);
    await device.close();
  });
});
