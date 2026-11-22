import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'alifbo_session';
export const OAUTH_STATE_COOKIE_NAME = 'alifbo_oauth_state';

const SESSION_TTL_SEC = 30 * 24 * 60 * 60;
const OAUTH_STATE_TTL_SEC = 10 * 60;

function getSessionSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured) return configured;
  if (!process.env.VERCEL) {
    return 'dev-alifbo-local-session-secret';
  }
  throw new Error('SESSION_SECRET is not configured');
}

function signValue(encodedPayload: string): string {
  return createHmac('sha256', getSessionSecret())
    .update(encodedPayload)
    .digest('base64url');
}

function verifySignedPayload<T>(token: string | undefined): T | null {
  if (!token) return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!encoded || !sig) return null;

  try {
    const expectedSig = signValue(encoded);
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T & {
      exp?: number;
    };
    if (!decoded || typeof decoded.exp !== 'number' || decoded.exp <= Date.now()) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function isHttpsRequest(request: Request): boolean {
  const fwdProto = request.headers.get('x-forwarded-proto');
  if (fwdProto) return fwdProto.split(',')[0]?.trim().toLowerCase() === 'https';
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function getRequestOrigin(request: Request): string {
  const url = new URL(request.url);
  const fwdHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = isHttpsRequest(request) ? 'https' : url.protocol.replace(':', '');
  if (fwdHost) {
    return `${proto}://${fwdHost.split(',')[0]?.trim()}`;
  }
  return url.origin;
}

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('cookie');
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

function buildCookieString(
  name: string,
  value: string,
  maxAgeSec: number,
  request: Request,
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (isHttpsRequest(request)) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function createSessionCookie(userId: string, request: Request): string {
  const payload = {
    uid: userId,
    exp: Date.now() + SESSION_TTL_SEC * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const token = `${encoded}.${signValue(encoded)}`;
  return buildCookieString(SESSION_COOKIE_NAME, token, SESSION_TTL_SEC, request);
}

export function clearSessionCookie(request: Request): string {
  return buildCookieString(SESSION_COOKIE_NAME, '', 0, request);
}

export function getSessionUserId(request: Request): string | null {
  const cookies = parseCookies(request);
  const parsed = verifySignedPayload<{ uid?: string; exp?: number }>(
    cookies[SESSION_COOKIE_NAME],
  );
  return typeof parsed?.uid === 'string' && parsed.uid ? parsed.uid : null;
}

export interface OAuthStateCookieData {
  state: string;
  childName?: string;
  avatarId?: string;
}

export function createOAuthStateCookie(
  data: Omit<OAuthStateCookieData, 'state'>,
  request: Request,
): { state: string; cookie: string } {
  const state = randomBytes(24).toString('base64url');
  const payload = {
    state,
    childName: data.childName,
    avatarId: data.avatarId,
    exp: Date.now() + OAUTH_STATE_TTL_SEC * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const token = `${encoded}.${signValue(encoded)}`;
  return {
    state,
    cookie: buildCookieString(OAUTH_STATE_COOKIE_NAME, token, OAUTH_STATE_TTL_SEC, request),
  };
}

export function readOAuthStateCookie(request: Request): OAuthStateCookieData | null {
  const cookies = parseCookies(request);
  const parsed = verifySignedPayload<OAuthStateCookieData>(cookies[OAUTH_STATE_COOKIE_NAME]);
  return parsed && typeof parsed.state === 'string' ? parsed : null;
}

export function clearOAuthStateCookie(request: Request): string {
  return buildCookieString(OAUTH_STATE_COOKIE_NAME, '', 0, request);
}

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers });
}

export function dbUnavailableResponse(): Response {
  return jsonResponse(
    {
      ok: false,
      code: 'db_not_configured',
      errorUz:
        "Ma'lumotlar bazasi hali ulanmagan. Vercel loyihasiga Neon Postgres ulangandan so'ng bu amal ishlaydi.",
    },
    503,
  );
}
