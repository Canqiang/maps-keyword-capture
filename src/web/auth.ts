import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface BasicAuth {
  /** HTTP Basic header check for API clients and scripts. */
  accepts(header: string | undefined): boolean;
  /** Login form check; never retains the plain credentials. */
  login(user: string, password: string): boolean;
  /** Issues a signed, expiring session token for the browser cookie. */
  issueSession(now?: number): string;
  /** Session cookie check. */
  acceptsSession(cookieHeader: string | undefined): boolean;
  readonly cookieName: string;
  readonly sessionSeconds: number;
}

const COOKIE = 'maps_session';
const SESSION_SECONDS = 12 * 60 * 60;

/** Disabled only when both settings are absent. Never retain or log plain credentials. */
export function createBasicAuth(user: string | undefined, password: string | undefined): BasicAuth | undefined {
  if (user === undefined && password === undefined) return undefined;
  if (!user || !password || user.includes(':') || /[\r\n]/u.test(user + password)) throw new Error('Tracking authentication requires a valid user and password');
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const expected = digest(user + ':' + password);
  // Sessions are signed with a per-process secret: a restart or redeploy signs everyone out.
  const secret = randomBytes(32);
  const sign = (expires: string) => createHmac('sha256', secret).update(expires).digest('base64url');
  const matches = (plain: string): boolean => timingSafeEqual(expected, digest(plain));
  return {
    cookieName: COOKIE, sessionSeconds: SESSION_SECONDS,
    accepts(header) {
      const encoded = /^Basic ([A-Za-z0-9+/]+={0,2})$/iu.exec(header ?? '')?.[1];
      const ok = matches(encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '');
      return Boolean(encoded) && ok;
    },
    login(candidateUser, candidatePassword) {
      if (typeof candidateUser !== 'string' || typeof candidatePassword !== 'string' || candidateUser.includes(':')) return false;
      return matches(candidateUser + ':' + candidatePassword);
    },
    issueSession(now = Date.now()) {
      const expires = String(now + SESSION_SECONDS * 1000);
      return `${expires}.${sign(expires)}`;
    },
    acceptsSession(cookieHeader) {
      const token = (cookieHeader ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
      const match = /^(\d{1,16})\.([A-Za-z0-9_-]{43})$/u.exec(token ?? '');
      if (!match) return false;
      const [, expires, signature] = match;
      const expectedSignature = Buffer.from(sign(expires!)), actual = Buffer.from(signature!);
      return expectedSignature.length === actual.length && timingSafeEqual(expectedSignature, actual) && Number(expires) > Date.now();
    },
  };
}
