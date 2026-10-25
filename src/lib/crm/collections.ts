import { getDb } from './db';
import { addActivity } from './agent-store';
import { addTags, ensureTag } from './tags';
import { isColombianHoliday } from './holidays';
import { receivablesSummary } from './receivables';

// Rules for contacting a customer about a debt (Ley 2300 de 2023, as read from public summaries; have a lawyer confirm):
// Monday-Friday 7:00-19:00 and Saturday 8:00-15:00 Colombian time, never Sundays or holidays, at most one contact a day,
// and once a customer has been reached, no other collection contact that week. These are enforced here, in the CRM,
// so the calling agent cannot skip them.

const BOGOTA_OFFSET_MS = -5 * 3_600_000; // Colombia has no daylight saving time
const SAFETY_MIN = 15; // stop a little before closing time: a call started at 18:59 would run past 19:00

export type CallWindow = { allowed: boolean; reason: string; bogotaTime: string };

function bogota(now: Date) {
  const d = new Date(now.getTime() + BOGOTA_OFFSET_MS);
  return { date: d.toISOString().slice(0, 10), dow: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), stamp: d.toISOString().slice(0, 16).replace('T', ' ') };
}

export function callWindow(now = new Date()): CallWindow {
  const b = bogota(now);
  const out = (allowed: boolean, reason: string) => ({ allowed, reason, bogotaTime: b.stamp });
  if (b.dow === 0) return out(false, 'Domingo: no se puede contactar para cobrar');
  if (isColombianHoliday(b.date)) return out(false, 'Festivo: no se puede contactar para cobrar');
  const [open, close] = b.dow === 6 ? [8 * 60, 15 * 60] : [7 * 60, 19 * 60];
  if (b.minutes < open) return out(false, `Todavía no abre el horario (${b.dow === 6 ? '8:00' : '7:00'} a. m.)`);
  if (b.minutes >= close - SAFETY_MIN) return out(false, `Ya cerró el horario (${b.dow === 6 ? '3:00' : '7:00'} p. m.)`);
  return out(true, 'Dentro del horario permitido');
}

export const CALL_OUTCOMES = ['promesa_pago', 'ya_pago', 'sin_respuesta', 'buzon', 'rechaza', 'pide_humano', 'numero_equivocado', 'no_llamar', 'otro'] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
/** Outcomes where a person was actually reached. */
const REACHED: CallOutcome[] = ['promesa_pago', 'ya_pago', 'rechaza', 'pide_humano', 'no_llamar', 'otro'];

export type CallInput = {
  outcome: CallOutcome;
  /** What was said, in a few lines: who answered, what they said, what was agreed. */
  summary: string;
  /** YYYY-MM-DD the customer promised to pay. */
  promiseDate?: string;
  promiseAmount?: number;
  durationSec?: number;
};

/** Stores a finished call on the customer's timeline. Returns a warning when it was made outside the allowed window. */
export function recordCall(contactId: number, input: CallInput, now = new Date()): { ok: true; warning?: string } {
  if (!getDb().prepare('SELECT 1 FROM contacts WHERE id = ?').get(contactId)) throw new Error('Cliente no encontrado');
  if (!CALL_OUTCOMES.includes(input.outcome)) throw new Error(`outcome inválido. Opciones: ${CALL_OUTCOMES.join(', ')}`);
  const summary = String(input.summary ?? '').trim().slice(0, 1500);
  if (!summary) throw new Error('Falta el resumen de la llamada');
  const promiseDate = input.promiseDate && /^\d{4}-\d{2}-\d{2}$/.test(input.promiseDate) ? input.promiseDate : undefined;
  if (input.outcome === 'promesa_pago' && !promiseDate) throw new Error('Una promesa de pago necesita promiseDate (AAAA-MM-DD)');
  const amount = Number(input.promiseAmount);
  const window = callWindow(now);

  addActivity(contactId, 'call', summary, {
    outcome: input.outcome,
    reached: REACHED.includes(input.outcome),
    promiseDate,
    promiseAmount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
    durationSec: Number.isFinite(Number(input.durationSec)) ? Number(input.durationSec) : undefined,
    outsideWindow: !window.allowed,
    by: 'agent'
  }, now.toISOString().slice(0, 19).replace('T', ' '));
  if (input.outcome === 'no_llamar') addTags([contactId], [ensureTag('No llamar')]);
  if (promiseDate) {
    getDb()
      .prepare("UPDATE contacts SET data = json_set(data, '$.promesa_pago', ?) WHERE id = ?")
      .run(JSON.stringify({ date: promiseDate, amount: Number.isFinite(amount) && amount > 0 ? amount : null }), contactId);
  }
  return window.allowed ? { ok: true } : { ok: true, warning: `La llamada quedó registrada, pero fue fuera del horario permitido: ${window.reason}` };
}

export type QueueOptions = { minDays?: number; minAmount?: number; limit?: number };

/**
 * Who may be called right now about a debt. Empty outside the allowed hours. Leaves out people who: have no phone, asked
 * not to be called, were called today, were reached by a call or by a payment reminder in the last 7 days, or promised
 * to pay on a date that has not passed.
 */
export function collectionQueue(options: QueueOptions = {}, now = new Date()) {
  const window = callWindow(now);
  const minDays = options.minDays ?? 30;
  const minAmount = options.minAmount ?? 0;
  const limit = Math.min(50, Math.max(1, options.limit ?? 10));
  if (!window.allowed) return { window, queue: [] as unknown[], skipped: {} as Record<string, number> };

  const d = getDb();
  const today = bogota(now).date;
  const skipped: Record<string, number> = { sinTelefono: 0, noLlamar: 0, llamadoHoy: 0, contactoReciente: 0, promesaVigente: 0 };
  const calls = d
    .prepare("SELECT contact_id AS id, created_at, json_extract(meta,'$.outcome') AS outcome, json_extract(meta,'$.reached') AS reached, json_extract(meta,'$.promiseDate') AS promise FROM activities WHERE kind = 'call' ORDER BY id")
    .all() as unknown as { id: number; created_at: string; outcome: string; reached: number | null; promise: string | null }[];
  const reminders = new Set(
    (d.prepare("SELECT DISTINCT contact_id AS id FROM outbox WHERE proposed_by = 'cobranza' AND status = 'sent' AND decided_at > datetime('now','-7 day')").all() as unknown as { id: number }[]).map((r) => r.id)
  );
  const sinceWeek = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  const sinceDay = new Date(now.getTime() - 24 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
  // Why each customer is left out, strongest reason first.
  const flags = new Map<number, { optedOut: boolean; calledToday: boolean; promise: boolean; reachedWeek: boolean }>();
  const flag = (id: number) => flags.get(id) ?? flags.set(id, { optedOut: false, calledToday: false, promise: false, reachedWeek: false }).get(id)!;
  for (const c of calls) {
    const f = flag(c.id);
    if (c.outcome === 'no_llamar') f.optedOut = true;
    if (c.created_at > sinceDay) f.calledToday = true;
    if (c.reached && c.created_at > sinceWeek) f.reachedWeek = true;
    if (c.promise && c.promise >= today) f.promise = true;
  }
  for (const id of reminders) flag(id).reachedWeek = true;
  const block = new Map<number, string>();
  for (const [id, f] of flags) {
    const why = f.optedOut ? 'noLlamar' : f.calledToday ? 'llamadoHoy' : f.promise ? 'promesaVigente' : f.reachedWeek ? 'contactoReciente' : '';
    if (why) block.set(id, why);
  }

  const queue: unknown[] = [];
  for (const debtor of receivablesSummary({}, now).debtors) {
    if (debtor.overdue <= 0 || debtor.oldestDays < minDays || debtor.overdue < minAmount) continue;
    if (!debtor.hasPhone) { skipped.sinTelefono++; continue; }
    const why = block.get(debtor.contactId);
    if (why) { skipped[why]++; continue; }
    if (queue.length >= limit) continue;
    const docs = d.prepare("SELECT doc FROM receivables WHERE contact_id = ? AND status = 'open' ORDER BY COALESCE(due_at, issued_at) LIMIT 3").all(debtor.contactId) as unknown as { doc: string }[];
    queue.push({
      customerId: debtor.contactId, name: debtor.name, phone: debtor.phone, seller: debtor.seller,
      overdue: Math.round(debtor.overdue), balance: Math.round(debtor.balance), oldestDays: debtor.oldestDays, invoices: debtor.invoices, docs: docs.map((r) => r.doc)
    });
    if (queue.length >= limit) break;
  }
  return { window, queue, skipped };
}
