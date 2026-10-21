import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBasicAuth } from '../src/web/auth.js';
import { startServer } from '../src/web/server.js';
import { parseTrackingConfig } from '../src/domain/tracking-config.js';
import { MemoryTrackingRepository } from '../src/domain/repository.js';
import type { Server } from 'node:http';

vi.mock('../src/web/ui.js', () => ({ UI_HTML: '<html>private UI</html>' }));
const header = (text: string) => 'Basic ' + Buffer.from(text).toString('base64');
const raw = JSON.parse(await readFile(new URL('../docs/tracking-config.example.json', import.meta.url), 'utf8'));
describe('tracking authentication', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()));
  it('allows opt-out only when both settings are absent and rejects incomplete setup', () => {
    expect(createBasicAuth(undefined, undefined)).toBeUndefined();
    for (const [user,password] of [['seo',undefined],[undefined,'secret'],['',''],['bad:user','secret'],['seo','secret\n']]) {
      expect(() => createBasicAuth(user,password)).toThrow(/authentication/);
    }
    const auth=createBasicAuth('seo','pass:with:colons')!;
    expect(auth.accepts(header('seo:pass:with:colons'))).toBe(true);
    for (const h of [undefined,'Bearer x','Basic !!!',header('bad:pass:with:colons'),header('seo:wrong')]) expect(auth.accepts(h)).toBe(false);
  });
  it('protects UI, reads, writes, evidence and unknown paths; only healthz is public', async () => {
    const repo=new MemoryTrackingRepository();
    const save=vi.spyOn(repo,'saveStore');
    server=startServer({config:parseTrackingConfig(raw),repo,auth:createBasicAuth('seo','test-password')!},0);
    await new Promise(resolve=>server!.once('listening',resolve));
    const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
    for (const path of ['/','/index.html','/api/settings','/api/stores','/api/evidence?key=tracking/test.png','/unknown']) {
      const response=await fetch(base+path);
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('Basic');
      expect(await response.text()).not.toContain('test-password');
    }
    expect((await fetch(base+'/api/stores',{method:'POST',body:'{}'})).status).toBe(401);
    expect(save).not.toHaveBeenCalled();
    expect((await fetch(base+'/healthz')).status).toBe(200);
    expect((await fetch(base+'/healthz',{method:'POST'})).status).toBe(401);
    const response=await fetch(base+'/api/settings',{headers:{authorization:header('seo:test-password')}});
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('test-password');
  });
});
