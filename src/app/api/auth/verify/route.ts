import { NextResponse } from 'next/server';
import { verifyTotp } from '@/lib/crm/totp';
import { hasPin, unlockCookie, verifyPin } from '@/lib/crm/lock';
import { TWOFA_COOKIE, makeToken, twofaKey } from '@/lib/twofa-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Second step of the login. The middleware has already checked the password (or private link); this checks the
// 6-digit code from the authenticator app and, when a 4-digit key has been created for Ventas, that key too.
// Only when everything is right does it set the cookie that lets this browser in (and unlocks Ventas for 30 min).
const attempts = { fails: 0, until: 0 };
let lastStep = 0; // a code can be used once

// Tells the page whether to ask for the 4-digit key after the code.
export async function GET() {
  return NextResponse.json({ needPin: hasPin() });
}

export async function POST(request: Request) {
  const secret = process.env.CRM_TOTP_SECRET?.trim();
  const password = process.env.INBOX_PASSWORD?.trim() ?? '';
  if (!secret) return NextResponse.json({ error: 'La verificación en dos pasos no está activada' }, { status: 400 });
  if (Date.now() < attempts.until) return NextResponse.json({ error: 'Demasiados intentos. Espera un minuto.' }, { status: 429 });

  const { code = '', pin = '' } = (await request.json().catch(() => ({}))) as { code?: string; pin?: string };
  const needPin = hasPin();
  const step = verifyTotp(secret, String(code));
  const codeOk = step !== null && step > lastStep;
  let pinOk = true;
  if (needPin && codeOk) {
    try {
      pinOk = verifyPin(String(pin));
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 429 });
    }
  }
  if (!codeOk || !pinOk) {
    if (++attempts.fails >= 5) Object.assign(attempts, { fails: 0, until: Date.now() + 60_000 });
    // With a key set, do not say which of the two was wrong.
    const msg = needPin ? 'Código o clave incorrectos' : step === null ? 'Código incorrecto' : 'Ese código ya se usó. Espera el siguiente.';
    return NextResponse.json({ error: msg }, { status: 401 });
  }
  lastStep = step as number;
  attempts.fails = 0;

  const days = Math.max(1, Number(process.env.CRM_2FA_DAYS) || 30);
  const token = await makeToken(twofaKey(password, secret), days * 86_400);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const res = NextResponse.json({ ok: true });
  if (needPin) res.headers.append('Set-Cookie', unlockCookie());
  res.headers.append('Set-Cookie', `${TWOFA_COOKIE}=${token}; Path=/; Max-Age=${days * 86_400}; HttpOnly; SameSite=Lax${secure}`);
  return res;
}
