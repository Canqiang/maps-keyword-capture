import { afterEach, describe, expect, it, vi } from 'vitest';

const launched = vi.hoisted(() => ({ options: undefined as Record<string, unknown> | undefined }));
vi.mock('playwright', () => ({
  chromium: { launch: async (options: Record<string, unknown>) => { launched.options = options; return {}; } },
}));

const { browserEnv, launchBrowser } = await import('../src/browser/launch.js');

afterEach(() => { vi.unstubAllEnvs(); launched.options = undefined; });

describe('browserEnv', () => {
  it('drops Azure storage settings and undefined values and keeps the rest', () => {
    const env = browserEnv({
      AZURE_STORAGE_CONTAINER_SAS_URL: 'https://acct.blob.core.windows.net/c?sv=1&sig=FAKESIGNATURE',
      AZURE_STORAGE_ACCOUNT_URL: 'https://acct.blob.core.windows.net',
      AZURE_STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=FAKEKEY;',
      PATH: '/usr/bin:/bin',
      HOME: '/home/capture',
      PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright',
      UNSET: undefined,
    });
    expect(env).toEqual({ PATH: '/usr/bin:/bin', HOME: '/home/capture', PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright' });
  });
});

describe('launchBrowser', () => {
  it('keeps the storage SAS out of the Chromium environment', async () => {
    vi.stubEnv('AZURE_STORAGE_CONTAINER_SAS_URL', 'https://acct.blob.core.windows.net/c?sv=1&sig=FAKESIGNATURE');
    vi.stubEnv('PLAYWRIGHT_BROWSERS_PATH', '/ms-playwright');
    await launchBrowser();
    const env = launched.options?.['env'] as Record<string, string> | undefined;
    expect(env).toBeDefined();
    expect(env).not.toHaveProperty('AZURE_STORAGE_CONTAINER_SAS_URL');
    expect(env).toMatchObject({ PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright' });
    expect(env?.['PATH']).toBe(process.env['PATH']);
    expect(launched.options).toMatchObject({ channel: 'chromium', headless: true, chromiumSandbox: true, handleSIGTERM: false });
  });
});
