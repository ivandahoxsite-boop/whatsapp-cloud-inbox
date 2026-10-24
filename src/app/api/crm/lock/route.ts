import { NextResponse } from 'next/server';
import { hasPin, isUnlocked, lockCookie, setPin, unlockCookie, verifyPin } from '@/lib/crm/lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return NextResponse.json({ hasPin: hasPin(), unlocked: isUnlocked(request) });
}

// POST { action: "setup", pin }            first time only
//      { action: "unlock", pin }
//      { action: "lock" }
//      { action: "change", pin, newPin }   needs the current PIN
export async function POST(request: Request) {
  try {
    const { action, pin = '', newPin = '' } = (await request.json()) as { action: string; pin?: string; newPin?: string };
    const reply = (cookie: string, body: object = { ok: true }) => {
      const res = NextResponse.json(body);
      res.headers.append('Set-Cookie', cookie);
      return res;
    };
    if (action === 'lock') return reply(lockCookie());
    if (action === 'setup') {
      if (hasPin()) throw new Error('Ya hay una clave. Para cambiarla usa "Cambiar clave".');
      setPin(String(pin));
      return reply(unlockCookie());
    }
    if (action === 'unlock') {
      if (!hasPin()) throw new Error('Primero crea una clave');
      if (!verifyPin(String(pin))) return NextResponse.json({ error: 'Clave incorrecta' }, { status: 401 });
      return reply(unlockCookie());
    }
    if (action === 'change') {
      if (!verifyPin(String(pin))) return NextResponse.json({ error: 'La clave actual no es correcta' }, { status: 401 });
      setPin(String(newPin));
      return reply(unlockCookie());
    }
    return NextResponse.json({ error: 'Acción inválida' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 400 });
  }
}
