import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { CaptureConfig } from '../contracts.js';

export async function launchBrowser(): Promise<Browser> {
  // Playwright installs its own SIGINT/SIGTERM/SIGHUP handlers by default: they close the browser
  // and can call process.exit, which would cut the run short before the manifest is published.
  // The CLI owns those signals and stops the batch itself.
  return chromium.launch({
    channel: 'chromium', headless: true, chromiumSandbox: true,
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
  });
}

export async function newSearchContext(browser: Browser, config: CaptureConfig): Promise<BrowserContext> {
  return browser.newContext({
    viewport: config.viewport,
    deviceScaleFactor: 1,
    locale: config.locale,
    timezoneId: config.browserTimezoneId,
    permissions: [],
    javaScriptEnabled: true,
  });
}
