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

/** The first minute a collection call is allowed, from `from` on (looks up to 10 days ahead). */
export function nextCallWindow(from = new Date()): Date | null {
  const start = Math.floor(from.getTime() / 60_000) * 60_000;
  for (let i = 1; i <= 10 * 24 * 60; i++) {
    const t = new Date(start + i * 60_000);
    if (callWindow(t).allowed) return t;
  }
  return null;
}

/** "2026-10-26T10:30" typed in Colombian time -> the instant it means. */
export function parseBogotaLocal(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const t = new Date(`${value}:00-05:00`);
  return Number.isNaN(t.getTime()) ? null : t;
}

const toSql = (t: Date) => t.toISOString().slice(0, 19).replace('T', ' ');
const fromSql = (v: string) => new Date(`${v.replace(' ', 'T')}Z`);
/** For people: "sáb 25 oct, 10:30 a. m." in Colombian time. */
export function formatBogota(t: Date): string {
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(t);
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
  /** Who made the call: the agent (default) or the user from the CRM. */
  by?: 'agent' | 'user';
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
    by: input.by === 'user' ? 'user' : 'agent'
  }, now.toISOString().slice(0, 19).replace('T', ' '));
  if (input.outcome === 'no_llamar') addTags([contactId], [ensureTag('No llamar')]);
  getDb().prepare("UPDATE call_requests SET status = 'done', closed_at = datetime('now') WHERE contact_id = ? AND status = 'pending'").run(contactId);
  if (promiseDate) {
    getDb()
      .prepare("UPDATE contacts SET data = json_set(data, '$.promesa_pago', ?) WHERE id = ?")
      .run(JSON.stringify({ date: promiseDate, amount: Number.isFinite(amount) && amount > 0 ? amount : null }), contactId);
  }
  return window.allowed ? { ok: true } : { ok: true, warning: `La llamada quedó registrada, pero fue fuera del horario permitido: ${window.reason}` };
}

export type QueueOptions = { minDays?: number; minAmount?: number; limit?: number };

const BLOCK_TEXT: Record<string, string> = {
  noLlamar: 'Pidió que no lo llamen',
  llamadoHoy: 'Ya se le llamó hoy',
  promesaVigente: 'Tiene una promesa de pago vigente',
  contactoReciente: 'Se le contactó por cobro en los últimos 7 días'
};

/**
 * Why each customer must be left out right now, strongest reason first. A customer who asked not to be called, was
 * called today, has a promise of payment that has not passed, or was reached (by a call or a payment reminder) in
 * the last 7 days.
 */
function blocks(now: Date): Map<number, string> {
  const d = getDb();
  const today = bogota(now).date;
  const calls = d
    .prepare("SELECT contact_id AS id, created_at, json_extract(meta,'$.outcome') AS outcome, json_extract(meta,'$.reached') AS reached, json_extract(meta,'$.promiseDate') AS promise FROM activities WHERE kind = 'call' ORDER BY id")
    .all() as unknown as { id: number; created_at: string; outcome: string; reached: number | null; promise: string | null }[];
  const reminders = (d.prepare("SELECT DISTINCT contact_id AS id FROM outbox WHERE proposed_by = 'cobranza' AND status = 'sent' AND decided_at > datetime('now','-7 day')").all() as unknown as { id: number }[]).map((r) => r.id);
  const sinceWeek = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  const sinceDay = new Date(now.getTime() - 24 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');

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
  const out = new Map<number, string>();
  for (const [id, f] of flags) {
    const why = f.optedOut ? 'noLlamar' : f.calledToday ? 'llamadoHoy' : f.promise ? 'promesaVigente' : f.reachedWeek ? 'contactoReciente' : '';
    if (why) out.set(id, why);
  }
  return out;
}

/** Who may be called right now about a debt, biggest overdue first. Empty outside the allowed hours. */
export function collectionQueue(options: QueueOptions = {}, now = new Date()) {
  const window = callWindow(now);
  const minDays = options.minDays ?? 30;
  const minAmount = options.minAmount ?? 0;
  const limit = Math.min(50, Math.max(1, options.limit ?? 10));
  if (!window.allowed) return { window, queue: [] as unknown[], skipped: {} as Record<string, number> };

  const d = getDb();
  const block = blocks(now);
  const skipped: Record<string, number> = { sinTelefono: 0, noLlamar: 0, llamadoHoy: 0, contactoReciente: 0, promesaVigente: 0 };
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
  }
  return { window, queue, skipped };
}

export type CallCheck = {
  customerId: number;
  name: string;
  phone: string;
  /** True only if everything allows calling this customer about a debt right now. */
  allowed: boolean;
  /** Why not (empty when allowed). */
  reasons: string[];
  overdue: number;
  oldestDays: number;
  docs: string[];
};

/**
 * For customers the user picked by hand: can each one be called right now, and if not, why. `q` finds customers by name
 * (up to 5), `customerId` checks one.
 */
/**
 * Test switch for the WhatsApp buttons only: until this instant the collection hours do not block them (the user asked
 * to try the buttons at night and put the rule back right away). Calls and the agent never look at it.
 */
export const HOURS_OFF_SETTING = 'collection_hours_off_until';
export function hoursOffUntil(now = new Date()): string | null {
  const r = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(HOURS_OFF_SETTING) as { value: string } | undefined;
  return r && Date.parse(r.value) > now.getTime() ? r.value : null;
}

export function checkCustomers(
  by: { customerId?: number; q?: string },
  now = new Date(),
  options: { ignoreWindow?: boolean; reminder?: boolean } = {}
) {
  const window = callWindow(now);
  const d = getDb();
  const block = blocks(now);
  const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const debtors = new Map(receivablesSummary({}, now).debtors.map((x) => [x.contactId, x]));

  let rows: { id: number; name: string; phone: string }[];
  if (by.customerId) rows = d.prepare('SELECT id, name, phone FROM contacts WHERE id = ?').all(by.customerId) as unknown as typeof rows;
  else if (by.q?.trim()) {
    const q = norm(by.q.trim());
    rows = (d.prepare('SELECT id, name, phone FROM contacts').all() as unknown as typeof rows)
      .filter((r) => norm(r.name).includes(q))
      .sort((a, b) => (debtors.get(b.id)?.overdue ?? 0) - (debtors.get(a.id)?.overdue ?? 0))
      .slice(0, 5);
  } else throw new Error('Manda customerId o q (nombre)');

  const checks: CallCheck[] = rows.map((r) => {
    const debt = debtors.get(r.id);
    const reasons: string[] = [];
    if (!window.allowed && !options.ignoreWindow) reasons.push(window.reason);
    if (!/^\d{7,}$/.test(r.phone)) reasons.push('No tiene teléfono');
    // A reminder before the due date ("Por vencer") is fine without overdue debt.
    if (!options.reminder && (!debt || debt.overdue <= 0)) reasons.push('No tiene deuda vencida');
    const why = block.get(r.id);
    if (why) reasons.push(BLOCK_TEXT[why]);
    const docs = debt ? (d.prepare("SELECT doc FROM receivables WHERE contact_id = ? AND status = 'open' ORDER BY COALESCE(due_at, issued_at) LIMIT 3").all(r.id) as unknown as { doc: string }[]).map((x) => x.doc) : [];
    return { customerId: r.id, name: r.name, phone: r.phone, allowed: reasons.length === 0, reasons, overdue: Math.round(debt?.overdue ?? 0), oldestDays: debt?.oldestDays ?? 0, docs };
  });
  return { window, checks };
}

// ---- Customers marked "to call" in the CRM --------------------------------------------------------------------

/**
 * Marks a customer to be called. Refuses when something about the customer makes a call impossible (no phone, no
 * overdue debt, asked not to be called, promise pending, reached this week). The hours are NOT checked here, so
 * calls can be lined up for tomorrow; they are checked again when the agent is about to dial.
 */
export function requestCall(contactId: number, now = new Date()): { ok: true; window: CallWindow } | { ok: false; reasons: string[] } {
  const { checks, window } = checkCustomers({ customerId: contactId }, now, { ignoreWindow: true });
  const c = checks[0];
  if (!c) throw new Error('Cliente no encontrado');
  if (!c.allowed) return { ok: false, reasons: c.reasons };
  const d = getDb();
  if (!d.prepare("SELECT 1 FROM call_requests WHERE contact_id = ? AND status = 'pending'").get(contactId)) {
    d.prepare('INSERT INTO call_requests (contact_id) VALUES (?)').run(contactId);
  }
  return { ok: true, window };
}

export function cancelCallRequest(contactId: number) {
  getDb().prepare("UPDATE call_requests SET status = 'cancelled', closed_at = datetime('now') WHERE contact_id = ? AND status = 'pending'").run(contactId);
}

/** Ids of the customers currently marked to call. */
export function pendingCallIds(): number[] {
  return (getDb().prepare("SELECT contact_id AS id FROM call_requests WHERE status = 'pending' ORDER BY id").all() as unknown as { id: number }[]).map((r) => r.id);
}

/**
 * What the agent reads: each marked or scheduled customer with a fresh check (hours included). `due` is true when the
 * scheduled time has come (or there is none). It dials only those with `due` and `allowed`.
 */
export function requestedCalls(now = new Date()) {
  const window = callWindow(now);
  const requested = scheduledCalls().flatMap((r) =>
    checkCustomers({ customerId: r.contactId }, now).checks.map((c) => ({
      ...c,
      scheduledAt: r.scheduledAt,
      scheduledLabel: r.label,
      due: !r.scheduledAt || new Date(r.scheduledAt).getTime() <= now.getTime()
    }))
  );
  return { window, requested };
}

/**
 * Schedules a call for a date and time (typed in Colombian time). The moment must be in the future and inside the
 * allowed hours, and nothing about the customer may rule a call out. Scheduling again replaces the previous time.
 * Whoever makes the call (you with your phone today, the agent with Twilio later) checks the rules again at that moment.
 */
export function scheduleCall(
  contactId: number,
  whenLocal: string,
  now = new Date()
): { ok: true; scheduledAt: string; label: string } | { ok: false; reasons: string[]; suggest?: string; suggestLabel?: string } {
  const when = parseBogotaLocal(whenLocal);
  if (!when) throw new Error('Fecha y hora inválidas');
  if (when.getTime() <= now.getTime()) return { ok: false, reasons: ['Esa hora ya pasó'] };

  const { checks } = checkCustomers({ customerId: contactId }, now, { ignoreWindow: true });
  const c = checks[0];
  if (!c) throw new Error('Cliente no encontrado');
  // "Called today" and "reached this week" describe the present, not the day it is scheduled for: those are re-checked when it is time.
  const hard = c.reasons.filter((r) => r !== BLOCK_TEXT.llamadoHoy && r !== BLOCK_TEXT.contactoReciente);
  if (hard.length) return { ok: false, reasons: hard };

  const window = callWindow(when);
  if (!window.allowed) {
    const next = nextCallWindow(when);
    const suggest = next ? new Date(next.getTime() + BOGOTA_OFFSET_MS).toISOString().slice(0, 16) : undefined;
    return { ok: false, reasons: [`A esa hora no se puede cobrar: ${window.reason}`], suggest, suggestLabel: next ? formatBogota(next) : undefined };
  }
  const d = getDb();
  d.prepare("UPDATE call_requests SET status = 'cancelled', closed_at = datetime('now') WHERE contact_id = ? AND status = 'pending'").run(contactId);
  d.prepare('INSERT INTO call_requests (contact_id, scheduled_at) VALUES (?, ?)').run(contactId, toSql(when));
  return { ok: true, scheduledAt: when.toISOString(), label: formatBogota(when) };
}

/** Pending calls with their scheduled time (ISO, or null for "whenever"). */
export function scheduledCalls(): { contactId: number; scheduledAt: string | null; label: string | null }[] {
  const rows = getDb().prepare("SELECT contact_id AS id, scheduled_at AS at FROM call_requests WHERE status = 'pending' ORDER BY COALESCE(scheduled_at, requested_at)").all() as unknown as { id: number; at: string | null }[];
  return rows.map((r) => ({ contactId: r.id, scheduledAt: r.at ? fromSql(r.at).toISOString() : null, label: r.at ? formatBogota(fromSql(r.at)) : null }));
}
