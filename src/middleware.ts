import { NextResponse, type NextRequest } from 'next/server';

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

// Protects every page and API route with HTTP Basic Auth.
// Fails closed: without INBOX_PASSWORD the inbox is not served at all.
export function middleware(request: NextRequest) {
  const password = process.env.INBOX_PASSWORD?.trim();
  if (!password) {
    return new NextResponse('INBOX_PASSWORD environment variable is not set', { status: 503 });
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
    if (cookie && safeEqual(cookie, accessKey)) return NextResponse.next();
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

  return NextResponse.next();
}

export const config = {
  // /api/webhooks (HMAC signature) and /api/agent (bearer token) authenticate themselves.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/webhooks/|api/agent/).*)']
};
