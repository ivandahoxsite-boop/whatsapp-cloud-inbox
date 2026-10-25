import { NextResponse } from 'next/server';
import { kapsoSignatureOk } from '@/lib/crm/auth';
import { handleKapsoEvent } from '@/lib/crm/kapso-events';
import { scheduleTranscriptFill } from '@/lib/crm/transcripts';

export const runtime = 'nodejs';

// Public endpoint (excluded from Basic Auth in middleware): authenticity comes from the HMAC signature.
export async function POST(request: Request) {
  const secret = process.env.KAPSO_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: 'KAPSO_WEBHOOK_SECRET is not set' }, { status: 503 });

  const raw = await request.text(); // the exact bytes Kapso signed
  if (!kapsoSignatureOk(raw, request.headers.get('x-webhook-signature'), secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: { batch?: boolean; data?: unknown[] } & Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const event = request.headers.get('x-webhook-event') ?? '';
  const key = request.headers.get('x-idempotency-key') ?? undefined;
  const items = body.batch === true && Array.isArray(body.data) ? body.data : [body];

  let processed = 0;
  items.forEach((item, i) => {
    const r = handleKapsoEvent(event, item as never, key ? `${key}:${i}` : undefined);
    if (r.handled && !r.duplicate) processed++;
    const phoneNumberId = (item as { phone_number_id?: string }).phone_number_id || process.env.PHONE_NUMBER_ID;
    if (r.needsTranscript && phoneNumberId) scheduleTranscriptFill(phoneNumberId);
  });
  return NextResponse.json({ ok: true, processed });
}
