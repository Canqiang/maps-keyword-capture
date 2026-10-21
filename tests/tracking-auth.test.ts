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
    for (const path of ['/','/index.html']) {
      const response=await fetch(base+path,{redirect:'manual'});
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/login');
    }
    for (const path of ['/api/settings','/api/stores','/api/evidence?key=tracking/test.png','/unknown','/api/scans']) {
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
  it('signs in through the form, keeps a signed session cookie, and signs out', async () => {
    const repo=new MemoryTrackingRepository();
    server=startServer({config:parseTrackingConfig(raw),repo,auth:createBasicAuth('seo','test-password')!},0);
    await new Promise(resolve=>server!.once('listening',resolve));
    const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
    const page=await fetch(base+'/login');
    expect(page.status).toBe(200);
    const html=await page.text();
    expect(html).toContain('<form method="post" action="/login"');
    expect(html).not.toContain('test-password');
    expect(html).not.toContain('private UI');
    expect(html).toContain('<input type="hidden" name="next" value="/">');
    expect(html).toMatch(/n\.value='\/'\+location\.hash/);
    const form=(body:string,extra:Record<string,string>={})=>fetch(base+'/login',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded',...extra},body});
    const bad=await form('username=seo&password=wrong');
    expect(bad.status).toBe(303); expect(bad.headers.get('location')).toBe('/login?error=1'); expect(bad.headers.get('set-cookie')).toBeNull();
    expect((await fetch(base+'/login?error=1')).status).toBe(200);
    expect(await (await fetch(base+'/login?error=1')).text()).toContain('用户名或密码不正确');
    expect((await form('username=seo&password=test-password',{origin:'http://evil.example'})).status).toBe(403);
    expect((await fetch(base+'/login',{method:'POST',redirect:'manual',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(415);
    const ok=await form('username=seo&password=test-password&next=%2F%23store%2Fkeke');
    expect(ok.status).toBe(303); expect(ok.headers.get('location')).toBe('/#store/keke');
    const cookie=ok.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^maps_session=\d+\.[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200$/);
    const session=cookie.split(';')[0]!;
    expect((await fetch(base+'/api/settings',{headers:{cookie:session}})).status).toBe(200);
    expect(await (await fetch(base+'/api/settings',{headers:{cookie:session}})).json()).toMatchObject({signedIn:true,scans:false});
    expect(await (await fetch(base+'/',{headers:{cookie:session}})).text()).toContain('private UI');
    expect((await fetch(base+'/login',{headers:{cookie:session},redirect:'manual'})).headers.get('location')).toBe('/');
    const tampered=session.slice(0,-1)+(session.endsWith('a')?'b':'a');
    expect((await fetch(base+'/api/settings',{headers:{cookie:tampered}})).status).toBe(401);
    expect((await fetch(base+'/api/settings',{headers:{cookie:'maps_session=1.abc'}})).status).toBe(401);
    const out=await fetch(base+'/logout',{method:'POST',redirect:'manual',headers:{cookie:session}});
    expect(out.status).toBe(303); expect(out.headers.get('location')).toBe('/login'); expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
    const secure=await form('username=seo&password=test-password',{'x-forwarded-proto':'https'});
    expect(secure.headers.get('set-cookie')).toContain('; Secure');
  });
  it('expires sessions and rejects tokens signed by another process', () => {
    const a=createBasicAuth('seo','pw')!, b=createBasicAuth('seo','pw')!;
    const token=a.issueSession(Date.now()-13*60*60*1000);
    expect(a.acceptsSession('maps_session='+token)).toBe(false);
    expect(a.acceptsSession('other=1; maps_session='+a.issueSession())).toBe(true);
    expect(b.acceptsSession('maps_session='+a.issueSession())).toBe(false);
    expect(a.login('seo','pw')).toBe(true); expect(a.login('seo','pw ')).toBe(false); expect(a.login('se:o','pw')).toBe(false);
  });
});
