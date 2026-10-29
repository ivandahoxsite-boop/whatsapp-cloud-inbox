import webpush from 'web-push';
import { getDb } from './db';
import { isRealPhone } from './customers';
import { daysLate, slotMs } from './receivables';
import { addDays, dayProblem, todayCo } from './tasks-info';

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

let started = false;

/** Sends the morning warning once a day, Monday to Saturday at 8:00 (Colombian time), not on holidays. */
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
  const timer = setInterval(() => void tick().catch((e) => console.error('[PUSH]', e instanceof Error ? e.message : 'error')), 60_000);
  timer.unref?.();
}
