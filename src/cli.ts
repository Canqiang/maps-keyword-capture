import { ConfigError, loadConfigFile } from './config.js';
import { runBatch } from './runner/batch-runner.js';
import { deliveryStatus } from './runner/manifest.js';
import { createSignalHandler } from './runner/signals.js';
import { createStore, parseStorageArg } from './storage/factory.js';
import { redactSecrets } from './storage/redact.js';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

/** Runs the batch and resolves with the summary line to print and the exit code. */
async function main(): Promise<{ line: string; code: number }> {
  const configPath = argValue('--config');
  if (!configPath) throw new ConfigError('usage: npm run capture -- --config <keywords.json> [--storage local|azure]');
  const storageMode = parseStorageArg(process.argv.slice(2));
  const { config, duplicateKeywordCount } = await loadConfigFile(configPath);
  if (duplicateKeywordCount > 0) {
    process.stderr.write(`note: ${duplicateKeywordCount} duplicate keyword row(s); each row is collected separately\n`);
  }
  const { store, description } = createStore(storageMode, config.outputDirectory, process.env);

  const controller = new AbortController();
  const onSignal = createSignalHandler(controller, (m) => process.stderr.write(m));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => onSignal(sig));

  const out = await runBatch({
    config,
    store,
    signal: controller.signal,
    log: (event) => process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`),
  });
  const counts: Record<string, number> = {};
  for (const q of out.manifest.queries) counts[q.status] = (counts[q.status] ?? 0) + 1;
  const line = `${JSON.stringify({
    summary: true, runId: out.manifest.runId, attemptId: out.manifest.attemptId, status: out.manifest.status,
    counts, manifest: out.manifestPath,
    remotePersistence: deliveryStatus(out.manifest, out.manifestReceipt),
    storage: description,
    manifestReceipt: out.manifestReceipt,
  })}\n`;
  return { line, code: out.exitCode };
}

// Exit explicitly once the last line is flushed: a browser that failed to close must not keep the
// process (and the Pod) alive after the manifest has been published.
main().then(
  ({ line, code }) => { process.stdout.write(line, () => process.exit(code)); },
  (err: unknown) => {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`, () => process.exit(err.exitCode));
      return;
    }
    const text = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(`${redactSecrets(text)}\n`, () => process.exit(1));
  },
);
