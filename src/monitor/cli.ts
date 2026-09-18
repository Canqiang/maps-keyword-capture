import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { ConfigError } from '../config.js';
import { runBatch } from '../runner/batch-runner.js';
import { AzureBlobGateway, containerClientFromEnv } from '../storage/azure-gateway.js';
import { LocalArtifactStore } from '../storage/local.js';
import { RemoteArtifactStore } from '../storage/remote.js';
import { redactSecrets } from '../storage/redact.js';
import { parseMonitorConfig } from './config.js';
import { createMonitorShutdown, monitorBrowserEnv, parseMonitorArgs } from './cli-options.js';
import { runDailyMonitor } from './daily.js';
import { KeywordApiSource } from './source.js';
import { createAtomicClaim, createLocalAtomicClaim } from './storage.js';

const log = (event: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
async function main() {
  const args = parseMonitorArgs(process.argv.slice(2));
  let raw: unknown;
  try { raw = JSON.parse(await readFile(args.configPath, 'utf8')); }
  catch { throw new ConfigError('cannot read monitor config as JSON'); }
  const config = parseMonitorConfig(raw);
  const local = new LocalArtifactStore(config.outputDirectory);
  const gateway = args.storage === 'azure' ? new AzureBlobGateway(containerClientFromEnv(process.env)) : null;
  const store = gateway ? new RemoteArtifactStore({ gateway, local }) : local;
  const token = process.env.KEYWORD_API_TOKEN;
  const source = new KeywordApiSource({ baseUrl: config.sourceBaseUrl, timeoutMs: config.sourceTimeoutMs, ...(token ? { token } : {}) });
  const controller = new AbortController();
  const shutdown = createMonitorShutdown(controller, () => {
    process.stdout.write(`${JSON.stringify({ summary: true, status: 'shutdown_grace_exceeded', counts: {}, manifestReceipt: null, exitCode: 1 })}\n`, () => process.exit(1));
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => shutdown(signal));
  const out = await runDailyMonitor({ config, source, store, claim: gateway ? createAtomicClaim(gateway) : createLocalAtomicClaim(local), signal: controller.signal, log, ...(args.runKey ? { runKey: args.runKey } : {}), batchRunner: deps => runBatch({ ...deps, launch: () => chromium.launch({ channel: 'chromium', headless: true, chromiumSandbox: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false, env: monitorBrowserEnv(process.env) }) }) });
  return { code: out.exitCode, summary: { summary: true, status: out.status, executionStatus: out.manifest?.executionStatus ?? null, dailyRunId: out.manifest?.dailyRunId ?? out.claim?.claim.dailyRunId ?? null, runKey: out.manifest?.runKey ?? out.claim?.claim.runKey ?? args.runKey ?? null, counts: out.manifest?.counts ?? {}, manifest: out.manifestPath, manifestReceipt: out.manifestReceipt, claim: out.claim, deliveryMode: store.mode, exitCode: out.exitCode } };
}
main().then(({ code, summary }) => process.stdout.write(`${JSON.stringify(summary)}\n`, () => process.exit(code)), (err: unknown) => {
  const code = err instanceof ConfigError ? 64 : 1;
  const message = err instanceof ConfigError ? err.message : 'monitor_operational_failure';
  process.stderr.write(`${redactSecrets(message)}\n`);
  process.stdout.write(`${JSON.stringify({ summary: true, status: code === 64 ? 'invalid_input' : 'failed', counts: {}, manifestReceipt: null, exitCode: code })}\n`, () => process.exit(code));
});
