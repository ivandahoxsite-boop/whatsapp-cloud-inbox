import { NextResponse, type NextRequest } from 'next/server';
import { TWOFA_COOKIE, tokenValid, twofaKey } from '@/lib/twofa-token';

const REALM = 'WhatsApp Inbox';
const ACCESS_COOKIE = 'inbox_key';

function safeEqual(a: string, b: string): boolean {
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

function unauthorized(): NextResponse {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"` }
  });
}

/**
 * A change (POST, PATCH, DELETE...) sent by another website from this browser. Browsers attach the saved Basic Auth
 * password to those requests, so without this check a malicious page could send WhatsApp messages or change data.
 * Scripts on the server (curl) send no Origin and no Sec-Fetch-Site, so they are not affected.
 */
function crossSiteWrite(request: NextRequest): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return false;
  const origin = request.headers.get('origin');
  if (origin) {
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host;
    try {
      return new URL(origin).host !== host;
    } catch {
      return true;
    }
  }
  return request.headers.get('sec-fetch-site') === 'cross-site';
}

// Protects every page and API route with HTTP Basic Auth.
// Fails closed: without INBOX_PASSWORD the inbox is not served at all.
export async function middleware(request: NextRequest) {
  const password = process.env.INBOX_PASSWORD?.trim();
  if (!password) {
    return new NextResponse('INBOX_PASSWORD environment variable is not set', { status: 503 });
  }
  if (crossSiteWrite(request)) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  }

  // Optional private access link: open /?key=<INBOX_ACCESS_KEY> once and this browser stays signed in
  // through an HttpOnly cookie, so nothing has to be typed (handy on phones).
  const accessKey = process.env.INBOX_ACCESS_KEY?.trim();
  if (accessKey && accessKey.length >= 24) {
    const queryKey = request.nextUrl.searchParams.get('key');
    if (queryKey && safeEqual(queryKey, accessKey)) {
      const clean = request.nextUrl.clone();
      clean.searchParams.delete('key');
      // Public origin as seen by the browser (the app itself listens on 127.0.0.1 behind Caddy).
      const proto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() || request.nextUrl.protocol.replace(':', '');
      const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host;
      const maxAge = 60 * 60 * 24 * 180;
      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${proto}://${host}${clean.pathname}${clean.search}`,
          'Set-Cookie': `${ACCESS_COOKIE}=${accessKey}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`
        }
      });
    }
    const cookie = request.cookies.get(ACCESS_COOKIE)?.value;
    if (cookie && safeEqual(cookie, accessKey)) return secondStep(request, password);
  }

  const username = process.env.INBOX_USERNAME?.trim() || 'admin';
  const header = request.headers.get('authorization');

  if (!header?.startsWith('Basic ')) {
    return unauthorized();
  }

  let decoded: string;
  try {
    decoded = atob(header.slice('Basic '.length));
  } catch {
    return unauthorized();
  }

  const separator = decoded.indexOf(':');
  const providedUser = separator === -1 ? '' : decoded.slice(0, separator);
  const providedPassword = separator === -1 ? '' : decoded.slice(separator + 1);

  const userOk = safeEqual(providedUser, username);
  const passwordOk = safeEqual(providedPassword, password);
  if (!userOk || !passwordOk) {
    return unauthorized();
  }

  return secondStep(request, password);
}

/**
 * A request made by a script on this server straight to 127.0.0.1 (crm-update, set-password.sh), not through Caddy.
 * Two independent tests must both pass. Through Caddy the Host is the public domain, and X-Forwarded-For is the
 * visitor's address; a visitor cannot make either of them look local. Next.js itself fills X-Forwarded-For with the
 * socket address on direct calls, which is why "header missing" cannot be the test.
 */
function isLocalDirect(request: NextRequest): boolean {
  const h = request.headers;
  const loopback = (v: string | null) => v === null || /^(127\.0\.0\.1|\[?::1\]?|::ffff:127\.0\.0\.1|localhost)(:\d+)?$/.test(v.trim());
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h.get('host') ?? '')) return false;
  return loopback(h.get('x-forwarded-for')) && loopback(h.get('x-forwarded-host')) && !h.get('forwarded');
}

// Password (or private link) is the first step. With CRM_TOTP_SECRET set, the browser also needs the cookie that
// the 6-digit code from the authenticator app earns at /verify.
async function secondStep(request: NextRequest, password: string): Promise<NextResponse> {
  const secret = process.env.CRM_TOTP_SECRET?.trim();
  if (!secret || isLocalDirect(request)) return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (path === '/verify' || path === '/api/auth/verify') return NextResponse.next();
  if (await tokenValid(twofaKey(password, secret), request.cookies.get(TWOFA_COOKIE)?.value)) return NextResponse.next();

  if (path.startsWith('/api/')) {
    return NextResponse.json({ error: 'Verificación en dos pasos requerida', need2fa: true }, { status: 401 });
  }
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() || request.nextUrl.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host;
  const next = path.startsWith('/') && !path.startsWith('//') ? path : '/crm';
  return NextResponse.redirect(`${proto}://${host}/verify?next=${encodeURIComponent(next)}`);
}

export const config = {
  // /api/webhooks (HMAC signature) and /api/agent (bearer token) authenticate themselves.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/webhooks/|api/agent/).*)']
};
