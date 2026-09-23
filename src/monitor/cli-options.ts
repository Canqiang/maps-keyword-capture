import { ConfigError } from '../config.js';
import { browserEnv } from '../browser/launch.js';
import { SHUTDOWN_GRACE_MS } from './daily.js';
import { validateRunKey } from './config.js';

export interface MonitorArgs { configPath: string; storage: 'azure' | 'local'; runKey?: string }
export function parseMonitorArgs(args: string[]): MonitorArgs {
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!; const value = args[i + 1];
    if (!['--config', '--storage', '--run-key'].includes(key)) throw new ConfigError(`unknown argument: ${key}`);
    if (options.has(key)) throw new ConfigError(`duplicate argument: ${key}`);
    if (!value || value.startsWith('-')) throw new ConfigError(`${key} requires a value`);
    options.set(key, value);
  }
  const configPath = options.get('--config');
  if (!configPath) throw new ConfigError('usage: monitor --config <monitor.json> --storage azure [--run-key <manual-cycle>]');
  const storage = options.get('--storage') ?? 'local';
  if (storage !== 'azure' && storage !== 'local') throw new ConfigError('--storage must be azure or local');
  const runKey = options.get('--run-key');
  return { configPath, storage, ...(runKey === undefined ? {} : { runKey: validateRunKey(runKey) }) };
}
export function monitorBrowserEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out = browserEnv(env); delete out.KEYWORD_API_TOKEN; delete out.KEYWORD_MONGO_URI; return out;
}
/** SIGTERM owns one fixed grace window; repeated signals cannot truncate artifact finalization. */
export function createMonitorShutdown(controller: AbortController, forceExit: () => void, schedule: (fn: () => void, ms: number) => unknown = setTimeout): (signal: string) => void {
  let stopping = false;
  return () => { if (stopping) return; stopping = true; controller.abort(); schedule(forceExit, SHUTDOWN_GRACE_MS); };
}
