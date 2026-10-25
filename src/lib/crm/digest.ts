import { listCustomers, type Customer } from './customers';
import { buildActions } from './actions';
import { listOutbox } from './agent-store';
import { getDb } from './db';
import { receivablesSummary } from './receivables';
import { callWindow, scheduledCalls } from './collections';
import { offsiteWarning } from './offsite';
import { listTasks } from './tasks';
import { pendingChats } from './pending';
import { addDays, dayProblem, dueLabel, todayCo } from './tasks-info';

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
export function buildDigest(limit = 5, now = Date.now()) {
  // Sundays and Colombian holidays: nothing is sent (the caller posts nothing when `quiet` is true).
  const day = todayCo(now);
  const closed = dayProblem(day);
  if (closed) {
    return {
      quiet: true as const,
      reason: closed,
      text: '',
      counts: { overdueReceivables: 0, awaiting: 0, due: 0, pendingApprovals: 0, noPhoneWithSales: 0, tasksToday: 0, tasksOverdue: 0 },
      sales30: 0,
      salesPrev30: 0
    };
  }
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

  const owed = receivablesSummary();
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

  // The user's own to-dos (written in the CRM's Pendientes tab): overdue and today, then the next 3 days.
  const tasks = listTasks();
  const overdueTasks = tasks.filter((t) => t.dueDate && t.dueDate < day);
  const todayTasks = tasks.filter((t) => t.dueDate === day);
  const soon = tasks.filter((t) => t.dueDate && t.dueDate > day && t.dueDate <= addDays(day, 3));
  const taskLine = (t: (typeof tasks)[number]) => {
    const when = dueLabel(t.dueDate, day, t.dueTime);
    return `• ${t.dueTime || t.dueDate !== day ? `${when} · ` : ''}${clip(t.text, 90)}${t.name ? ` — ${t.name}` : ''}`;
  };
  if (overdueTasks.length + todayTasks.length) {
    lines.push('', `📌 Tus pendientes (${overdueTasks.length + todayTasks.length})`);
    const shown = [...overdueTasks, ...todayTasks];
    for (const t of shown.slice(0, limit * 2)) lines.push(taskLine(t));
    if (shown.length > limit * 2) lines.push(`… y ${shown.length - limit * 2} más en la pestaña Pendientes`);
  }
  if (soon.length) {
    lines.push('', `🗓 Próximos 3 días (${soon.length})`);
    for (const t of soon.slice(0, limit)) lines.push(taskLine(t));
  }
  const loose = pendingChats().filter((c) => c.reason !== 'sin_respuesta').length;
  if (loose) lines.push('', `🗂 ${loose} chat${loose === 1 ? '' : 's'} quedaron en el aire o sin cotización cerrada (pestaña Pendientes).`);

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
  if (owed.totals.overdue > 0) {
    lines.push('', `💰 Cartera vencida: ${money(owed.totals.overdue)} de ${money(owed.totals.balance)} por cobrar`);
    for (const d of owed.debtors.filter((x) => x.overdue > 0).slice(0, 3)) lines.push(`• ${d.name || d.phone} — ${money(d.overdue)} · ${d.oldestDays} días de mora`);
  }
  // Promises of payment taken in collection calls: due today, and broken ones (promised date passed, still owing).
  const today = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
  const promises = getDb()
    .prepare(
      `SELECT c.id, c.name, json_extract(a.meta,'$.promiseDate') AS due, json_extract(a.meta,'$.promiseAmount') AS amount
       FROM activities a JOIN contacts c ON c.id = a.contact_id
       WHERE a.kind = 'call' AND json_extract(a.meta,'$.outcome') = 'promesa_pago'
         AND a.id = (SELECT MAX(a2.id) FROM activities a2 WHERE a2.contact_id = a.contact_id AND a2.kind = 'call')
         AND json_extract(a.meta,'$.promiseDate') <= ? AND json_extract(a.meta,'$.promiseDate') >= date(?, '-7 day')`
    )
    .all(today, today) as unknown as { id: number; name: string; due: string; amount: number | null }[];
  const owing = new Set(owed.debtors.map((x) => x.contactId));
  const dueToday = promises.filter((p) => p.due === today);
  const broken = promises.filter((p) => p.due < today && owing.has(p.id));
  if (dueToday.length) {
    lines.push('', `📞 Prometieron pagar hoy (${dueToday.length})`);
    for (const p of dueToday.slice(0, limit)) lines.push(`• ${p.name || 'Cliente'}${p.amount ? ` — ${money(p.amount)}` : ''}`);
  }
  if (broken.length) {
    lines.push('', `⚠️ Prometieron pagar y no lo han hecho (${broken.length})`);
    for (const p of broken.slice(0, limit)) lines.push(`• ${p.name || 'Cliente'} — prometió el ${p.due}`);
  }
  // Calls the user scheduled for today (Colombian calendar), with the time.
  const todays = scheduledCalls().filter((c) => c.scheduledAt && new Date(new Date(c.scheduledAt).getTime() - 5 * 3_600_000).toISOString().slice(0, 10) === today);
  if (todays.length) {
    const byId = new Map(listCustomers().map((c) => [c.id, c]));
    lines.push('', `📅 Llamadas que programaste para hoy (${todays.length})`);
    for (const t of todays.slice(0, limit)) {
      const hh = new Date(new Date(t.scheduledAt!).getTime() - 5 * 3_600_000).toISOString().slice(11, 16);
      lines.push(`• ${hh} — ${byId.get(t.contactId)?.name || 'Cliente'}`);
    }
  }
  const backupWarning = offsiteWarning();
  if (backupWarning) lines.push('', backupWarning);
  if (!callWindow().allowed) lines.push('', `🕒 Ahora no se puede llamar para cobrar: ${callWindow().reason}.`);
  if (pending) lines.push('', `📝 ${pending} mensaje${pending === 1 ? '' : 's'} por aprobar en el CRM (pestaña Aprobaciones).`);
  if (noPhone) lines.push('', `📵 ${noPhone} cliente${noPhone === 1 ? '' : 's'} con ventas sin teléfono: no se les puede escribir todavía.`);
  if (lines.length === 2 && !awaiting.length && !due.length) lines.push('', 'Nada urgente hoy.');

  return {
    quiet: false as const,
    reason: '',
    text: lines.join('\n'),
    counts: {
      overdueReceivables: owed.totals.overdue,
      awaiting: awaiting.length,
      due: due.length,
      pendingApprovals: pending,
      noPhoneWithSales: noPhone,
      tasksToday: todayTasks.length,
      tasksOverdue: overdueTasks.length
    },
    sales30: sales.last30,
    salesPrev30: sales.prev30
  };
}
