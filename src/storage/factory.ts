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

export function createStore(mode: 'local' | 'azure', outputDirectory: string, env: NodeJS.ProcessEnv): { store: ArtifactStore; description: string | null } {
  const local = new LocalArtifactStore(outputDirectory);
  if (mode === 'local') return { store: local, description: null };
  const gateway = new AzureBlobGateway(containerClientFromEnv(env));
  return { store: new RemoteArtifactStore({ gateway, local }), description: gateway.description };
}
