import { NextResponse } from 'next/server';
import { verifyTotp } from '@/lib/crm/totp';
import { TWOFA_COOKIE, makeToken, twofaKey } from '@/lib/twofa-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Second step of the login. The middleware has already checked the password (or private link); this checks the
// 6-digit code from the authenticator app and, if right, sets the cookie that lets this browser in.
const attempts = { fails: 0, until: 0 };
let lastStep = 0; // a code can be used once

export async function POST(request: Request) {
  const secret = process.env.CRM_TOTP_SECRET?.trim();
  const password = process.env.INBOX_PASSWORD?.trim() ?? '';
  if (!secret) return NextResponse.json({ error: 'La verificación en dos pasos no está activada' }, { status: 400 });
  if (Date.now() < attempts.until) return NextResponse.json({ error: 'Demasiados intentos. Espera un minuto.' }, { status: 429 });

  const { code = '' } = (await request.json().catch(() => ({}))) as { code?: string };
  const step = verifyTotp(secret, String(code));
  if (step === null || step <= lastStep) {
    if (++attempts.fails >= 5) Object.assign(attempts, { fails: 0, until: Date.now() + 60_000 });
    return NextResponse.json({ error: step === null ? 'Código incorrecto' : 'Ese código ya se usó. Espera el siguiente.' }, { status: 401 });
  }
  lastStep = step;
  attempts.fails = 0;

  const days = Math.max(1, Number(process.env.CRM_2FA_DAYS) || 30);
  const token = await makeToken(twofaKey(password, secret), days * 86_400);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const res = NextResponse.json({ ok: true });
  res.headers.append('Set-Cookie', `${TWOFA_COOKIE}=${token}; Path=/; Max-Age=${days * 86_400}; HttpOnly; SameSite=Lax${secure}`);
  return res;
}
