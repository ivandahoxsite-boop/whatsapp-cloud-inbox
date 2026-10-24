import { listCustomers, type Customer } from './customers';
import { buildActions } from './actions';
import { listOutbox } from './agent-store';
import { getDb } from './db';

const money = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
const label = (c: Customer) => `${c.name || `+${c.phone}`}${c.city ? ` (${c.city})` : ''}`;

function ago(iso: string | null): string {
  if (!iso) return '';
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return `hace ${min} min`;
  if (min < 48 * 60) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} d`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The morning brief: who is waiting for an answer, who is due to buy, who to win back, and how sales are going. */
export function buildDigest(limit = 5) {
  const customers = listCustomers().filter((c) => c.hasPhone);
  const awaiting = customers
    .filter((c) => c.awaitingReply)
    .sort((a, b) => (a.lastInboundAt ?? '').localeCompare(b.lastInboundAt ?? ''));
  const due = customers
    .filter((c) => c.recurrence === 'por_recomprar')
    .sort((a, b) => (b.overdueDays ?? 0) * b.avgTicket - (a.overdueDays ?? 0) * a.avgTicket);
  const winBack = buildActions(customers).filter((a) => a.title !== 'Le toca recomprar');
  const pending = listOutbox('pending').length;
  const noPhone = listCustomers().filter((c) => !c.hasPhone && c.salesCount > 0).length;

  const sales = getDb()
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN sold_at >= date('now','-30 day') THEN amount END), 0) AS last30,
              COALESCE(SUM(CASE WHEN sold_at < date('now','-30 day') AND sold_at >= date('now','-60 day') THEN amount END), 0) AS prev30
       FROM sales`
    )
    .get() as { last30: number; prev30: number };
  const delta = sales.prev30 > 0 ? Math.round(((sales.last30 - sales.prev30) / sales.prev30) * 100) : null;

  const lines: string[] = ['☀️ Resumen del día'];
  lines.push(`Ventas últimos 30 días: ${money(sales.last30)}${delta == null ? '' : ` (${delta >= 0 ? '+' : ''}${delta}% vs los 30 anteriores)`}`);

  if (awaiting.length) {
    lines.push('', `⏳ Esperan tu respuesta (${awaiting.length})`);
    for (const c of awaiting.slice(0, limit)) lines.push(`• ${label(c)} — ${ago(c.lastInboundAt)}: “${clip(c.lastInboundText, 80)}”`);
  }
  if (due.length) {
    lines.push('', `🔁 Les toca recomprar (${due.length})`);
    for (const c of due.slice(0, limit))
      lines.push(`• ${label(c)} — ${c.overdueDays} días de retraso${c.favoriteProduct ? ` · suele llevar ${clip(c.favoriteProduct, 50)}` : ''}`);
  }
  if (winBack.length) {
    lines.push('', '💤 Para reactivar');
    for (const a of winBack.slice(0, 3)) lines.push(`• ${label(a.customer)} — ${a.reason}`);
  }
  if (pending) lines.push('', `📝 ${pending} mensaje${pending === 1 ? '' : 's'} por aprobar en el CRM (pestaña Aprobaciones).`);
  if (noPhone) lines.push('', `📵 ${noPhone} cliente${noPhone === 1 ? '' : 's'} con ventas sin teléfono: no se les puede escribir todavía.`);
  if (lines.length === 2 && !awaiting.length && !due.length) lines.push('', 'Nada urgente hoy.');

  return {
    text: lines.join('\n'),
    counts: { awaiting: awaiting.length, due: due.length, pendingApprovals: pending, noPhoneWithSales: noPhone },
    sales30: sales.last30,
    salesPrev30: sales.prev30
  };
}
