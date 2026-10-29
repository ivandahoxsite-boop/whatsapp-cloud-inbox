import webpush from 'web-push';
import { getDb } from './db';
import { isRealPhone } from './customers';
import { daysLate, slotMs } from './receivables';
import { addDays, dayProblem, dueLabel, todayCo } from './tasks-info';

/**
 * Notifications on the user's phone (Chrome on Android) and computer, through Web Push: the browser keeps a
 * subscription and the CRM sends to it, even with the CRM closed. Every morning the CRM warns about the invoices that
 * fall due next, so the user can pick them and send the reminder.
 */

const SETTING_VAPID = 'push_vapid';
const SETTING_SLOT = 'due_notice_slot';
/** When the morning warning goes out (Colombian time), Monday to Saturday, not on holidays. */
export const DUE_NOTICE_TIME = '08:00';

type Vapid = { publicKey: string; privateKey: string };

/** The CRM's own push keys, made once and kept in the database (the browser needs the public one to subscribe). */
function vapid(): Vapid {
  const d = getDb();
  const row = d.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_VAPID) as { value: string } | undefined;
  if (row) return JSON.parse(row.value) as Vapid;
  const keys = webpush.generateVAPIDKeys();
  d.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(SETTING_VAPID, JSON.stringify(keys));
  return JSON.parse((d.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_VAPID) as { value: string }).value) as Vapid;
}

export const pushPublicKey = () => vapid().publicKey;

export type PushSubscriptionJson = { endpoint: string; keys: { p256dh: string; auth: string } };

export function savePushSubscription(sub: PushSubscriptionJson, device: string) {
  if (!/^https:\/\//.test(String(sub?.endpoint ?? '')) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('Suscripción inválida');
  getDb()
    .prepare("INSERT OR REPLACE INTO push_subscriptions (endpoint, keys, device, created_at) VALUES (?, ?, ?, datetime('now'))")
    .run(sub.endpoint, JSON.stringify(sub.keys), device.slice(0, 120));
}

export function deletePushSubscription(endpoint: string) {
  getDb().prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(String(endpoint ?? ''));
}

export const pushCount = () => (getDb().prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as { n: number }).n;

export type PushMessage = { title: string; body: string; url: string; tag?: string };

/** Sends to every subscribed device; forgets the ones the browser says no longer exist. */
export async function sendPush(msg: PushMessage): Promise<{ sent: number; failed: number }> {
  const v = vapid();
  const subs = getDb().prepare('SELECT endpoint, keys FROM push_subscriptions').all() as { endpoint: string; keys: string }[];
  let sent = 0;
  let failed = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, JSON.stringify(msg), {
        vapidDetails: { subject: process.env.PUSH_SUBJECT || 'mailto:crm@localhost', publicKey: v.publicKey, privateKey: v.privateKey },
        TTL: 12 * 3600,
        urgency: 'normal'
      });
      sent++;
    } catch (e) {
      failed++;
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) deletePushSubscription(s.endpoint);
      else console.error('[PUSH]', code ?? (e instanceof Error ? e.message : 'error'));
    }
  }
  return { sent, failed };
}

export type DueInvoice = { id: number; doc: string; dueAt: string; balance: number };
/** An older invoice of the same customer that is already overdue (days counted from the issue date, as the CRM does). */
export type OverdueInvoice = { doc: string; balance: number; daysLate: number };
export type DueCustomer = {
  contactId: number;
  name: string;
  phone: string;
  hasPhone: boolean;
  invoices: DueInvoice[];
  total: number;
  /** Older invoices of this customer already overdue (the user wants to see and charge them in the same message). */
  overdue: OverdueInvoice[];
  overdueTotal: number;
};

/** The days whose invoices the morning warning covers: today, tomorrow, and Sunday/holidays up to the next working day. */
export function noticeDays(today = todayCo()): string[] {
  const days = [today, addDays(today, 1)];
  while (dayProblem(days[days.length - 1])) days.push(addDays(days[days.length - 1], 1));
  return days;
}

/** Open invoices that fall due between `from` and `to` (inclusive), by customer, with each one's older overdue invoices. */
export function dueBetween(from: string, to: string, now = new Date()): DueCustomer[] {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT r.id, r.doc, substr(r.due_at, 1, 10) AS due, r.balance, r.contact_id, c.name, c.phone
       FROM receivables r JOIN contacts c ON c.id = r.contact_id
       WHERE r.status = 'open' AND r.balance > 0 AND substr(r.due_at, 1, 10) BETWEEN ? AND ?
       ORDER BY due, c.name`
    )
    .all(from, to) as { id: number; doc: string; due: string; balance: number; contact_id: number; name: string; phone: string }[];
  const older = d.prepare(
    `SELECT doc, balance, issued_at, due_at FROM receivables
     WHERE contact_id = ? AND status = 'open' AND balance > 0 AND substr(due_at, 1, 10) < ?`
  );
  const by = new Map<number, DueCustomer>();
  for (const r of rows) {
    let c = by.get(r.contact_id);
    if (!c) {
      const overdue = (older.all(r.contact_id, from) as { doc: string; balance: number; issued_at: string | null; due_at: string | null }[])
        .map((o) => ({ doc: o.doc, balance: o.balance, daysLate: daysLate(o, now) }))
        .filter((o) => o.daysLate > 0)
        .sort((a, b) => b.daysLate - a.daysLate);
      c = {
        contactId: r.contact_id, name: r.name, phone: r.phone, hasPhone: isRealPhone(r.phone), invoices: [], total: 0,
        overdue, overdueTotal: overdue.reduce((a, o) => a + o.balance, 0)
      };
      by.set(r.contact_id, c);
    }
    c.invoices.push({ id: r.id, doc: r.doc, dueAt: r.due, balance: r.balance });
    c.total += r.balance;
  }
  return [...by.values()].sort((a, b) => b.total + b.overdueTotal - (a.total + a.overdueTotal));
}

/** Lowercase without accents, so "garcia" finds "García". */
const plain = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * The "Buscar" box of "Por vencer": any customer whose name, phone or open invoice number matches every word, owing or
 * not and whatever the range chosen (user's request, 29-oct-2026). Invoices not yet due go in `invoices`, the overdue
 * ones in `overdue`; customers who owe go first.
 */
export function searchDue(q: string, today = todayCo(), now = new Date()): DueCustomer[] {
  const words = plain(q).split(/\s+/).filter(Boolean);
  if (!words.length || words.join('').length < 2) return [];
  const d = getDb();
  const open = d
    .prepare(
      `SELECT r.id, r.contact_id, r.doc, r.balance, r.issued_at, r.due_at FROM receivables r
       WHERE r.status = 'open' AND r.balance > 0`
    )
    .all() as { id: number; contact_id: number; doc: string; balance: number; issued_at: string | null; due_at: string | null }[];
  const byContact = new Map<number, typeof open>();
  for (const r of open) byContact.set(r.contact_id, [...(byContact.get(r.contact_id) ?? []), r]);
  const contacts = d.prepare('SELECT id, name, phone FROM contacts').all() as { id: number; name: string; phone: string }[];
  const found: DueCustomer[] = [];
  for (const c of contacts) {
    const inv = byContact.get(c.id) ?? [];
    const hay = plain([c.name, c.phone, ...inv.map((r) => r.doc)].join(' '));
    if (!words.every((w) => hay.includes(w))) continue;
    // Without debt, only real WhatsApp contacts (not the empty name holders the cartera sheet leaves behind).
    if (!inv.length && !isRealPhone(c.phone)) continue;
    const cust: DueCustomer = { contactId: c.id, name: c.name, phone: c.phone, hasPhone: isRealPhone(c.phone), invoices: [], total: 0, overdue: [], overdueTotal: 0 };
    for (const r of inv) {
      // Overdue as everywhere else in the CRM (past the due date, days counted from the issue date).
      const late = daysLate(r, now);
      if (!late) {
        cust.invoices.push({ id: r.id, doc: r.doc, dueAt: (r.due_at ?? '').slice(0, 10) || today, balance: r.balance });
        cust.total += r.balance;
      } else {
        cust.overdue.push({ doc: r.doc, balance: r.balance, daysLate: late });
        cust.overdueTotal += r.balance;
      }
    }
    cust.invoices.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    cust.overdue.sort((a, b) => b.daysLate - a.daysLate);
    found.push(cust);
  }
  return found
    .sort((a, b) => b.total + b.overdueTotal - (a.total + a.overdueTotal) || a.name.localeCompare(b.name))
    .slice(0, 20);
}

const money = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

/** The morning warning, or null when nothing falls due. */
export function dueNotice(today = todayCo()): PushMessage | null {
  const days = noticeDays(today);
  const list = dueBetween(days[0], days[days.length - 1]);
  if (!list.length) return null;
  const invoices = list.reduce((a, c) => a + c.invoices.length, 0);
  const total = list.reduce((a, c) => a + c.total, 0);
  const withOld = list.filter((c) => c.overdue.length);
  const first = list[0];
  return {
    title: `📅 Vencen hoy y mañana: ${invoices} factura${invoices === 1 ? '' : 's'} · ${money(total)}`,
    body:
      `${first.name || 'Un cliente'} ${money(first.total)}${list.length > 1 ? ` y ${list.length - 1} cliente${list.length > 2 ? 's' : ''} más` : ''}.` +
      (withOld.length
        ? ` ⚠️ ${withOld.length === 1 ? `${withOld[0].name || 'Uno'} además tiene` : `${withOld.length} de ellos además tienen`} facturas vencidas (${money(withOld.reduce((a, c) => a + c.overdueTotal, 0))}).`
        : '') +
      ' Toca para elegir a quién enviarle el recordatorio.',
    url: '/crm#por-vencer',
    tag: `vencen-${days[0]}`
  };
}

/**
 * To-do reminders (user's request, 29-oct-2026): every open to-do due today or overdue is notified every 30 minutes
 * until it is marked "Hecho". Today's start at their time (07:00 without a time); overdue ones from 07:00. They stop at
 * 16:00 ("hasta tipo 4pm"); one with a later time is notified once at its time. Overdue ones go on the next working
 * days (not Sundays or holidays). One notification per to-do; the same tag replaces the previous one.
 */
export const TASK_NOTICE_START = '07:00';
export const TASK_NOTICE_END = '16:00';
export const TASK_NOTICE_EVERY = 30 * 60_000;
const TASK_SETTING = 'task_notice_last';

type TaskDue = { id: number; text: string; due_date: string; due_time: string | null; name: string | null };

/** The to-dos to notify now (and the time each was last notified), given when each one was last notified. */
export function taskNoticesDue(now: number, last: Record<string, number>): TaskDue[] {
  const today = todayCo(now);
  if (dayProblem(today)) return [];
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.text, t.due_date, t.due_time, c.name FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
       WHERE t.status = 'open' AND t.due_date IS NOT NULL AND t.due_date <= ? ORDER BY t.due_date, t.due_time, t.id`
    )
    .all(today) as TaskDue[];
  return rows.filter((t) => {
    const start = slotMs(today, t.due_date === today && t.due_time ? t.due_time : TASK_NOTICE_START);
    // A to-do set after 16:00 still gets its notice (10 minutes of margin, in case the CRM was restarting).
    const end = Math.max(slotMs(today, TASK_NOTICE_END), start + 10 * 60_000);
    // A minute of margin: the clock ticks once a minute.
    if (now < start || now >= end + 60_000) return false;
    return !last[t.id] || now - last[t.id] >= TASK_NOTICE_EVERY - 30_000;
  });
}

export function taskNotice(t: TaskDue, today: string): PushMessage {
  const when = dueLabel(t.due_date, today, t.due_time);
  return {
    title: `⏰ Pendiente: ${t.text}`,
    body: `${t.name ? `${t.name} · ` : ''}${when}. Toca para abrir Pendientes; márcalo «Hecho» para que deje de avisar.`,
    url: '/crm#pendientes',
    tag: `tarea-${t.id}`
  };
}

async function tickTasks(now = Date.now()) {
  if (!pushCount()) return;
  const d = getDb();
  const row = d.prepare('SELECT value FROM settings WHERE key = ?').get(TASK_SETTING) as { value: string } | undefined;
  let last: Record<string, number> = {};
  try {
    last = JSON.parse(row?.value ?? '{}');
  } catch {
    /* start again */
  }
  const due = taskNoticesDue(now, last);
  if (!due.length) return;
  // Keep only to-dos still open, so the list does not grow forever.
  const open = new Set((d.prepare("SELECT id FROM tasks WHERE status = 'open'").all() as { id: number }[]).map((r) => String(r.id)));
  const next: Record<string, number> = Object.fromEntries(Object.entries(last).filter(([id]) => open.has(id)));
  for (const t of due) next[t.id] = now;
  d.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(TASK_SETTING, JSON.stringify(next));
  const today = todayCo(now);
  for (const t of due) console.log(`[PUSH] pendiente ${t.id}:`, await sendPush(taskNotice(t, today)));
}

let started = false;

/** Sends the morning warning once a day, Monday to Saturday at 8:00 (Colombian time), not on holidays; and the to-do reminders. */
export function startDueNotices() {
  if (started) return;
  started = true;
  const tick = async () => {
    const now = Date.now();
    const day = todayCo(now);
    if (dayProblem(day)) return;
    const at = slotMs(day, DUE_NOTICE_TIME);
    if (now < at || now - at > 2 * 3_600_000 || !pushCount()) return;
    const d = getDb();
    const done = d.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_SLOT) as { value: string } | undefined;
    if (done?.value === day) return;
    d.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SETTING_SLOT, day);
    const msg = dueNotice(day);
    if (msg) console.log(`[PUSH] aviso de vencimientos ${day}:`, await sendPush(msg));
  };
  const timer = setInterval(() => {
    void tick().catch((e) => console.error('[PUSH]', e instanceof Error ? e.message : 'error'));
    void tickTasks().catch((e) => console.error('[PUSH] pendientes', e instanceof Error ? e.message : 'error'));
  }, 60_000);
  timer.unref?.();
}
