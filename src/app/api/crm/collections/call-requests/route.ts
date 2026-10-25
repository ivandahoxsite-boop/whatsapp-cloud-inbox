import { NextResponse } from 'next/server';
import { cancelCallRequest, pendingCallIds, requestCall } from '@/lib/crm/collections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status });

export async function GET() {
  try {
    return NextResponse.json({ ids: pendingCallIds() });
  } catch (e) {
    return fail(e, 500);
  }
}

// POST { contactId } marks a customer "to call". 409 with the reasons when the customer cannot be called.
export async function POST(request: Request) {
  try {
    const { contactId } = (await request.json()) as { contactId: number };
    const r = requestCall(Number(contactId));
    if (!r.ok) return NextResponse.json({ error: r.reasons.join('. '), reasons: r.reasons }, { status: 409 });
    return NextResponse.json({ ok: true, callableNow: r.window.allowed, window: r.window.reason });
  } catch (e) {
    return fail(e);
  }
}

// DELETE { contactId } takes the mark off.
export async function DELETE(request: Request) {
  try {
    const { contactId } = (await request.json()) as { contactId: number };
    cancelCallRequest(Number(contactId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
