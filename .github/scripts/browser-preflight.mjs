import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

/** Exact executable only: no broad user-directory or global userns exception. */
export function chromiumUsernsProfile(executable) {
  if (!/^\/[A-Za-z0-9_./-]+\/chrome$/u.test(executable) || executable.split('/').includes('..')) {
    throw new Error('Chromium executable must be an absolute literal chrome path');
  }
  return `abi <abi/4.0>,\ninclude <tunables/global>\nprofile maps-capture-ci-chromium ${executable} flags=(unconfined) {\n  userns,\n}\n`;
}

async function checkSandbox() {
  const { launchBrowser } = await import('../../src/browser/launch.ts');
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto('data:text/html,<title>sandbox preflight</title>');
    if (await page.title() !== 'sandbox preflight') throw new Error('sandbox preflight page did not load');
    console.log(JSON.stringify({ stage: 'sandbox_browser_ready', browserVersion: browser.version(), chromiumSandbox: true }));
  } finally { await browser.close(); }
}

export async function main() {
  if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('This setup is restricted to disposable Linux GitHub runners');
  try { await checkSandbox(); return; }
  catch (error) {
    // Preserve the actual browser stderr before applying any runner-only fix.
    console.error('Sandboxed browser preflight failed before AppArmor setup:', error);
  }
  const restriction = (await readFile('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8')).trim();
  if (restriction !== '1') throw new Error('Browser launch failed without the expected Ubuntu AppArmor userns restriction; no workaround applied');
  const executable = chromium.executablePath();
  const profile = chromiumUsernsProfile(executable);
  const directory = await mkdtemp(join(tmpdir(), 'maps-ci-apparmor-'));
  try {
    const file = join(directory, 'chromium.profile');
    await writeFile(file, profile, { mode: 0o600 });
    const result = spawnSync('sudo', ['apparmor_parser', '-r', file], { stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error('Could not load the exact Chromium CI AppArmor profile', { cause: result.error });
    console.log(JSON.stringify({ stage: 'ci_chromium_userns_profile_loaded', executable, globalRestriction: restriction }));
  } finally { await rm(directory, { recursive: true, force: true }); }
  // A successful profile load alone is not a browser-success claim.
  await checkSandbox();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
