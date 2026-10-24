import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getDb } from './db';

// A separate key (PIN) protects the money screens (Ventas, Cartera) on top of the CRM login, so a phone left
// open or a shoulder-surfer does not see the figures. The server checks it: hiding them only in the browser would not be enough.

export const UNLOCK_COOKIE = 'crm_unlock';
const TTL_SECONDS = 30 * 60;

const getSetting = (key: string) => (getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
const setSetting = (key: string, value: string) =>
  getDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);

export const hasPin = () => !!getSetting('pin');

export function setPin(pin: string) {
  if (pin.length < 4 || pin.length > 64) throw new Error('La clave debe tener entre 4 y 64 caracteres');
  const salt = randomBytes(16);
  setSetting('pin', `${salt.toString('hex')}:${scryptSync(pin, salt, 32).toString('hex')}`);
}

// Five wrong tries lock the attempts for a minute. There is one owner, so one global counter is enough.
const attempts = { fails: 0, until: 0 };

export function verifyPin(pin: string): boolean {
  if (Date.now() < attempts.until) throw new Error('Demasiados intentos. Espera un minuto.');
  const stored = getSetting('pin');
  let ok = false;
  if (stored) {
    const [salt, hash] = stored.split(':');
    const given = scryptSync(pin, Buffer.from(salt, 'hex'), 32);
    ok = timingSafeEqual(given, Buffer.from(hash, 'hex'));
  }
  if (ok) attempts.fails = 0;
  else if (++attempts.fails >= 5) Object.assign(attempts, { fails: 0, until: Date.now() + 60_000 });
  return ok;
}

// The signing key includes the stored PIN hash: changing the PIN signs everybody out.
const sign = (exp: string) => createHmac('sha256', `${process.env.INBOX_PASSWORD ?? ''}|${getSetting('pin') ?? ''}`).update(exp).digest('hex');

export function unlockCookie(): string {
  const exp = String(Date.now() + TTL_SECONDS * 1000);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${UNLOCK_COOKIE}=${exp}.${sign(exp)}; Path=/; Max-Age=${TTL_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

export const lockCookie = () => `${UNLOCK_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;

export function isUnlocked(request: Request): boolean {
  if (!hasPin()) return false;
  const raw = /(?:^|;\s*)crm_unlock=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
  if (!raw) return false;
  const [exp, sig] = raw.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign(exp);
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/** Returns a 423 response when the money screens are locked, or null when the caller may continue. */
export function lockedResponse(request: Request): NextResponse | null {
  if (isUnlocked(request)) return null;
  return NextResponse.json({ locked: true, hasPin: hasPin(), error: 'Ingresa tu clave para ver estos valores' }, { status: 423 });
}
