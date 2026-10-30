import { NextResponse } from 'next/server';
import { customerReceivables } from '@/lib/crm/receivables';
import { listCustomers } from '@/lib/crm/customers';
import { proposeMessage } from '@/lib/crm/agent-store';
import { CALI_COMPANY, collectionMessage } from '@/lib/crm/collection-messages';
import { caliSummary } from '@/lib/crm/cartera-cali';

export const runtime = 'nodejs';

const money = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

// POST { contactId } queues a payment reminder in "Aprobaciones". It is NOT sent until a person approves it there.
// { contactId, cali: true } does it with the customer's invoices of the "Cartera Cali" tab, signed "Xsite Group · sede Cali".
export async function POST(request: Request) {
  try {
    const { contactId, cali } = (await request.json()) as { contactId: number; cali?: boolean };
    const c = listCustomers().find((x) => x.id === Number(contactId));
    if (!c) throw new Error('Cliente no encontrado');
    const open = cali
      ? caliSummary()
          .debtors.filter((d) => d.contactId === c.id)
          .flatMap((d) => d.invoices.map((i) => ({ doc: i.doc, balance: i.balance, daysLate: i.late })))
          .sort((a, b) => b.daysLate - a.daysLate)
      : customerReceivables(c.id);
    if (!open.length) throw new Error('Este cliente no tiene saldo pendiente');
    const total = open.reduce((a, r) => a + r.balance, 0);
    const late = open.filter((r) => r.daysLate > 0);
    const first = c.name.trim().split(/\s+/)[0];
    const docs = open.slice(0, 3).map((r) => r.doc).join(', ');
    // 30+ days overdue: the same tiered text as "Escribir por WhatsApp" in the customer file.
    const tiered = collectionMessage(c.name, open, cali ? CALI_COMPANY : undefined);
    const body = tiered?.text ??
      `Hola${first ? ` ${first}` : ''}, te escribimos${cali ? ` de ${CALI_COMPANY}` : ''} para recordarte que tienes un saldo pendiente de ${money(total)}` +
      `${docs ? ` (${docs}${open.length > 3 ? '…' : ''})` : ''}` +
      `${late.length ? `, con facturas vencidas hace hasta ${Math.max(...late.map((r) => r.daysLate))} días` : ''}. ` +
      '¿Nos confirmas cuándo podrías realizar el pago? Gracias.';
    const id = proposeMessage(c.id, body, 'cobranza');
    return NextResponse.json({ id, body });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 400 });
  }
}
