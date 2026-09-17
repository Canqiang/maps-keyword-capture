import { ConfigError, loadConfigFile } from './config.js';
import { runBatch } from './runner/batch-runner.js';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main(): Promise<number> {
  const configPath = argValue('--config');
  if (!configPath) {
    process.stderr.write('usage: npm run capture -- --config <keywords.json>\n');
    return 64;
  }
  const { config, duplicateKeywordCount } = await loadConfigFile(configPath);
  if (duplicateKeywordCount > 0) {
    process.stderr.write(`note: ${duplicateKeywordCount} duplicate keyword row(s); each row is collected separately\n`);
  }
  const controller = new AbortController();
  const onSignal = (sig: string) => { process.stderr.write(`${sig} received: finishing the current keyword, skipping the rest\n`); controller.abort(); };
  process.once('SIGTERM', () => onSignal('SIGTERM'));
  process.once('SIGINT', () => onSignal('SIGINT'));

  const out = await runBatch({
    config,
    signal: controller.signal,
    log: (event) => process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`),
  });
  const counts: Record<string, number> = {};
  for (const q of out.manifest.queries) counts[q.status] = (counts[q.status] ?? 0) + 1;
  process.stdout.write(`${JSON.stringify({
    summary: true, runId: out.manifest.runId, attemptId: out.manifest.attemptId, status: out.manifest.status,
    counts, manifest: out.manifestPath, remotePersistence: 'not_requested',
  })}\n`);
  return out.exitCode;
}

main().then(
  (code) => { process.exitCode = code; },
  (err) => {
    if (err instanceof ConfigError) { process.stderr.write(`${err.message}\n`); process.exitCode = err.exitCode; return; }
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
