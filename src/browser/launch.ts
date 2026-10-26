import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { CaptureConfig } from '../contracts.js';

/** The environment Chromium gets: everything with a value except storage settings, so the SAS never reaches the browser. */
export function browserEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !key.startsWith('AZURE_STORAGE_')) out[key] = value;
  }
  return out;
}

export async function launchBrowser(): Promise<Browser> {
  // Playwright installs its own SIGINT/SIGTERM/SIGHUP handlers by default: they close the browser
  // and can call process.exit, which would cut the run short before the manifest is published.
  // The CLI owns those signals and stops the batch itself.
  return chromium.launch({
    channel: 'chromium', headless: true, chromiumSandbox: true,
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    env: browserEnv(process.env),
  });
}

export async function newSearchContext(browser: Browser, config: CaptureConfig): Promise<BrowserContext> {
  const located = config.mapSearchMode === 'located_ui';
  if (located && !config.mapView) throw new Error('located_ui requires a configured mapView');
  const context = await browser.newContext({
    viewport: config.viewport,
    deviceScaleFactor: 1,
    locale: config.locale,
    timezoneId: config.browserTimezoneId,
    permissions: [],
    ...(located ? { geolocation: { latitude: config.mapView!.latitude, longitude: config.mapView!.longitude, accuracy: 10 } } : {}),
    javaScriptEnabled: true,
  });
  try {
    if (located) await context.grantPermissions(['geolocation'], { origin: 'https://www.google.com' });
    return context;
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}
