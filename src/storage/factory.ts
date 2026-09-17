import { ConfigError } from '../config.js';
import { AzureBlobGateway, containerClientFromEnv } from './azure-gateway.js';
import { LocalArtifactStore } from './local.js';
import { RemoteArtifactStore } from './remote.js';
import type { ArtifactStore } from './types.js';

export function parseStorageFlag(value: string | null): 'local' | 'azure' {
  if (value === null || value === 'local') return 'local';
  if (value === 'azure') return 'azure';
  throw new ConfigError(`--storage must be "local" or "azure", got "${value}"`);
}

/** Reads --storage from argv strictly: `--storage=azure`, a missing value, or a flag-looking value is an error, never a silent local run. */
export function parseStorageArg(argv: string[]): 'local' | 'azure' {
  const malformed = argv.find((a) => a.startsWith('--storage') && a !== '--storage');
  if (malformed) throw new ConfigError(`use "--storage azure" or "--storage local", not "${malformed}"`);
  const i = argv.indexOf('--storage');
  if (i < 0) return 'local';
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) throw new ConfigError('--storage needs a value: local or azure');
  return parseStorageFlag(value);
}

export function createStore(mode: 'local' | 'azure', outputDirectory: string, env: NodeJS.ProcessEnv): { store: ArtifactStore; description: string | null } {
  const local = new LocalArtifactStore(outputDirectory);
  if (mode === 'local') return { store: local, description: null };
  const gateway = new AzureBlobGateway(containerClientFromEnv(env));
  return { store: new RemoteArtifactStore({ gateway, local }), description: gateway.description };
}
