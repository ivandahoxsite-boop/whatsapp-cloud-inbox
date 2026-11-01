import { NextResponse } from 'next/server';
import { cancelCallRequest, requestCall, scheduleCall, scheduledCalls } from '@/lib/crm/collections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status });

export async function GET() {
  try {
    const requests = scheduledCalls();
    return NextResponse.json({ ids: requests.map((r) => r.contactId), requests });
  } catch (e) {
    return fail(e, 500);
  }
}

// POST { contactId, scheduledFor? }
//   scheduledFor "2026-10-26T10:30" (Colombian time) schedules the call; it must be in the future and inside the allowed
//   hours, otherwise 409 with the reasons and, when the hours are the problem, `suggest` (the next allowed slot).
//   Without scheduledFor it only marks the customer. 409 also when the customer cannot be called (no phone, asked not to...).
export async function POST(request: Request) {
  try {
    const { contactId, scheduledFor } = (await request.json()) as { contactId: number; scheduledFor?: string };
    if (scheduledFor) {
      const r = scheduleCall(Number(contactId), scheduledFor);
      if (!r.ok) return NextResponse.json({ error: r.reasons.join('. '), reasons: r.reasons, suggest: r.suggest, suggestLabel: r.suggestLabel }, { status: 409 });
      return NextResponse.json({ ok: true, scheduledAt: r.scheduledAt, label: r.label });
    }
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
