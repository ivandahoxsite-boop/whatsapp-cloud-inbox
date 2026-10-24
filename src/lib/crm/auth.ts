import { createHmac, timingSafeEqual } from 'node:crypto';

const eq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Bearer token check. Fails closed when the env var is not configured. */
export function bearerOk(request: Request, envName: string): boolean {
  const expected = process.env[envName]?.trim();
  if (!expected) return false;
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') && eq(header.slice(7).trim(), expected);
}

/** Kapso signs the raw body: hex HMAC-SHA256 in X-Webhook-Signature. */
export function kapsoSignatureOk(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return eq(signature.toLowerCase(), expected);
}
