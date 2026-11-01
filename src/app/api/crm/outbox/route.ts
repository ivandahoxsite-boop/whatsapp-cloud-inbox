import { NextResponse } from 'next/server';
import { getOutbox, listOutbox, markOutbox } from '@/lib/crm/agent-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status });

// GET: the reminders waiting in "Aprobaciones" (pending) and the last ones already decided.
export async function GET() {
  try {
    const all = listOutbox();
    return NextResponse.json({
      pending: all.filter((o) => o.status === 'pending'),
      recent: all.filter((o) => o.status !== 'pending').slice(0, 20)
    });
  } catch (e) {
    return fail(e, 500);
  }
}

// PATCH { id, action: 'sent' | 'rejected' }
//   'sent' only after the person confirms the message really went out from WhatsApp (the CRM never sends it itself);
//   it counts as "cobrado esta semana" for the collection rules. 'rejected' discards it.
export async function PATCH(request: Request) {
  try {
    const { id, action } = (await request.json()) as { id: number; action: 'sent' | 'rejected' };
    if (action !== 'sent' && action !== 'rejected') throw new Error('Acción no válida');
    const item = getOutbox(Number(id));
    if (!item) throw new Error('Mensaje no encontrado');
    if (item.status !== 'pending') throw new Error('Este mensaje ya se decidió');
    markOutbox(item.id, action);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
