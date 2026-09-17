import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';

export const AZURITE_ACCOUNT_KEY = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
  });
}

/** Starts an in-memory Azurite blob service on a random port for one test file. */
export async function startAzurite(): Promise<{ connectionString: string; stop(): Promise<void> }> {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn('node_modules/.bin/azurite-blob', [
    '--blobHost', '127.0.0.1', '--blobPort', String(port),
    '--inMemoryPersistence', '--silent', '--skipApiVersionCheck', '--loose',
  ], { stdio: 'ignore' });
  const deadline = Date.now() + 20_000;
  while (!(await portOpen(port))) {
    if (Date.now() > deadline) { proc.kill(); throw new Error(`Azurite did not open port ${port}`); }
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    connectionString: `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=${AZURITE_ACCOUNT_KEY};BlobEndpoint=http://127.0.0.1:${port}/devstoreaccount1;`,
    stop: async () => { proc.kill(); },
  };
}
