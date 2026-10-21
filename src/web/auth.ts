import { createHash, timingSafeEqual } from 'node:crypto';

export interface BasicAuth { accepts(header: string | undefined): boolean }

/** Disabled only when both settings are absent. Never retain or log plain credentials. */
export function createBasicAuth(user: string | undefined, password: string | undefined): BasicAuth | undefined {
  if (user === undefined && password === undefined) return undefined;
  if (!user || !password || user.includes(':') || /[\r\n]/u.test(user + password)) throw new Error('Tracking authentication requires a valid user and password');
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const expected = digest(user + ':' + password);
  return { accepts(header) {
    const encoded = /^Basic ([A-Za-z0-9+/]+={0,2})$/iu.exec(header ?? '')?.[1];
    const actual = digest(encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '');
    const matches = timingSafeEqual(expected, actual);
    return Boolean(encoded) && matches;
  } };
}
