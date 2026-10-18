import { NextResponse, type NextRequest } from 'next/server';

const REALM = 'WhatsApp Inbox';

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
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
