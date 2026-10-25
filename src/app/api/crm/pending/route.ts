import { NextResponse } from 'next/server';
import { closeChat, mutedChats, muteChat, pendingChats, unmuteChat } from '@/lib/crm/pending';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status });

export async function GET() {
  try {
    return NextResponse.json({ chats: pendingChats(), muted: mutedChats() });
  } catch (e) {
    return fail(e, 500);
  }
}

// POST { contactId, kind: 'resolved' | 'ignored' } closes the chat until the customer writes again;
// kind 'muted' hides the customer for good, 'unmuted' shows them again.
export async function POST(request: Request) {
  try {
    const { contactId, kind } = (await request.json()) as { contactId: number; kind?: string };
    if (!Number.isInteger(contactId)) throw new Error('Falta el cliente');
    if (kind === 'muted') muteChat(contactId);
    else if (kind === 'unmuted') unmuteChat(contactId);
    else closeChat(contactId, kind === 'ignored' ? 'ignored' : 'resolved');
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
