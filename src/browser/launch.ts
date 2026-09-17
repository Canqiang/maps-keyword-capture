import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { CaptureConfig } from '../contracts.js';

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ channel: 'chromium', headless: true, chromiumSandbox: true });
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
