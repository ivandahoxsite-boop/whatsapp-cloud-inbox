// Signed "this browser passed the second step" cookie. Uses only Web Crypto so the middleware (Edge runtime)
// and the API route can both use it.

export const TWOFA_COOKIE = 'crm_2fa';

const enc = new TextEncoder();

async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const same = (a: string, b: string) => {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
};

export async function makeToken(key: string, ttlSeconds: number): Promise<string> {
  const exp = String(Date.now() + ttlSeconds * 1000);
  return `${exp}.${await hmacHex(key, exp)}`;
}

export async function tokenValid(key: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return same(sig, await hmacHex(key, exp));
}

/** The signing key: changing the password or the authenticator secret signs every browser out. */
export const twofaKey = (password: string, secret: string) => `${password}|${secret}`;
