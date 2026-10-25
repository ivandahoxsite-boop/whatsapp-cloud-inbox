import { NextResponse } from 'next/server';
import { closeChat, pendingChats } from '@/lib/crm/pending';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status });

export async function GET() {
  try {
    return NextResponse.json({ chats: pendingChats() });
  } catch (e) {
    return fail(e, 500);
  }
}

// POST { contactId, kind: 'resolved' | 'ignored' } closes the chat until the customer writes again.
export async function POST(request: Request) {
  try {
    const { contactId, kind } = (await request.json()) as { contactId: number; kind?: string };
    if (!Number.isInteger(contactId)) throw new Error('Falta el cliente');
    closeChat(contactId, kind === 'ignored' ? 'ignored' : 'resolved');
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
