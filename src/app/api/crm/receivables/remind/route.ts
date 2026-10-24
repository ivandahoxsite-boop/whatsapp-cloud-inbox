import { NextResponse } from 'next/server';
import { customerReceivables } from '@/lib/crm/receivables';
import { listCustomers } from '@/lib/crm/customers';
import { proposeMessage } from '@/lib/crm/agent-store';

export const runtime = 'nodejs';

const money = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

// POST { contactId } queues a payment reminder in "Aprobaciones". It is NOT sent until a person approves it there.
export async function POST(request: Request) {
  try {
    const { contactId } = (await request.json()) as { contactId: number };
    const c = listCustomers().find((x) => x.id === Number(contactId));
    if (!c) throw new Error('Cliente no encontrado');
    const open = customerReceivables(c.id);
    if (!open.length) throw new Error('Este cliente no tiene saldo pendiente');
    const total = open.reduce((a, r) => a + r.balance, 0);
    const late = open.filter((r) => r.daysLate > 0);
    const first = c.name.trim().split(/\s+/)[0];
    const docs = open.slice(0, 3).map((r) => r.doc).join(', ');
    const body =
      `Hola${first ? ` ${first}` : ''}, te escribimos para recordarte que tienes un saldo pendiente de ${money(total)}` +
      `${docs ? ` (${docs}${open.length > 3 ? '…' : ''})` : ''}` +
      `${late.length ? `, con facturas vencidas hace hasta ${Math.max(...late.map((r) => r.daysLate))} días` : ''}. ` +
      '¿Nos confirmas cuándo podrías realizar el pago? Gracias.';
    const id = proposeMessage(c.id, body, 'user');
    return NextResponse.json({ id, body });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 400 });
  }
}
