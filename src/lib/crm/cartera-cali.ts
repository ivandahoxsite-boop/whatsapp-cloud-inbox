import { getDb } from './db';
import { caliStore, linkOf, type SheetInvoice } from './cartera-sheet';
import { isRealPhone, placeholderKey } from './customers';
import type { DueCustomer } from './push';
import { daysLate } from './receivables';
export { CALI_COMPANY } from './collection-messages';

/**
 * The "Cartera Cali" tab, apart from the CRM's cartera (user's request, 30-oct-2026: "NO JUNTA"): its summary, its
 * "Por vencer" traffic light and the customers still to link to a WhatsApp contact. Nothing here writes to
 * `receivables`; the invoices come from the last good copy of the tab (`settings.cartera_cali`).
 * Messages for these customers name the company as CALI_COMPANY (the user's choice).
 */

export type CaliHolder = { id: number; phone: string; name: string };

/**
 * The CRM contact of a Cali customer, only to write to them and open their file: the link the user made for that NIT,
 * else the customer that holds its invoices in the main cartera, else its customer without phone. Never by name.
 */
export function caliHolder(key: string, cliente = '', name = ''): CaliHolder | undefined {
  const d = getDb();
  const link = linkOf(key);
  if (link?.status === 'linked') {
    const c = d.prepare('SELECT id, phone, name FROM contacts WHERE id = ?').get(link.contact_id) as CaliHolder | undefined;
    if (c) return c;
  }
  const main = d
    .prepare("SELECT c.id, c.phone, c.name FROM receivables r JOIN contacts c ON c.id = r.contact_id WHERE json_extract(r.data, '$.cliente') = ? LIMIT 1")
    .get(key) as CaliHolder | undefined;
  if (main) return main;
  const ph = placeholderKey(cliente, name);
  return ph ? (d.prepare('SELECT id, phone, name FROM contacts WHERE phone = ?').get(ph) as CaliHolder | undefined) : undefined;
}

type CaliInvoice = SheetInvoice & { late: number; holder: CaliHolder | undefined };

/** The tab's invoices with their days late (CRM rule) and their contact, each customer looked up once. */
function caliInvoices(now: Date): CaliInvoice[] {
  const known = new Map<string, CaliHolder | undefined>();
  return (caliStore()?.invoices ?? [])
    .filter((i) => i.balance > 0)
    .map((i) => {
      if (!known.has(i.key)) known.set(i.key, caliHolder(i.key, i.cliente, i.name));
      return { ...i, late: daysLate({ issued_at: i.issuedAt, due_at: i.dueAt }, now), holder: known.get(i.key) };
    });
}

export type CaliClient = { key: string; cliente: string; name: string; balance: number; invoices: number; contactId: number | null };

/** Totals and aging like the main cartera's summary, and the customers without WhatsApp to link. */
export function caliSummary(now = new Date()) {
  const list = caliInvoices(now);
  const aging = [
    { label: 'Al día', amount: 0, invoices: 0 },
    { label: '1-30 días', amount: 0, invoices: 0 },
    { label: '31-60 días', amount: 0, invoices: 0 },
    { label: '61-90 días', amount: 0, invoices: 0 },
    { label: 'Más de 90', amount: 0, invoices: 0 }
  ];
  let total = 0;
  let overdue = 0;
  const customers = new Map<string, CaliClient & { hasPhone: boolean }>();
  for (const i of list) {
    total += i.balance;
    if (i.late > 0) overdue += i.balance;
    const b = i.late <= 0 ? 0 : i.late <= 30 ? 1 : i.late <= 60 ? 2 : i.late <= 90 ? 3 : 4;
    aging[b].amount += i.balance;
    aging[b].invoices++;
    let c = customers.get(i.key);
    if (!c) {
      c = { key: i.key, cliente: i.cliente, name: i.name, balance: 0, invoices: 0, contactId: i.holder?.id ?? null, hasPhone: !!i.holder && isRealPhone(i.holder.phone) };
      customers.set(i.key, c);
    }
    c.balance += i.balance;
    c.invoices++;
  }
  const unlinked = [...customers.values()].filter((c) => !c.hasPhone).sort((a, b) => b.balance - a.balance);
  return { total, overdue, invoices: list.length, customers: customers.size, aging, unlinked };
}

export type CaliSummary = ReturnType<typeof caliSummary>;

/**
 * Cali customers as the "Por vencer" list expects them. Without a CRM contact a customer gets a negative id (it can be
 * shown, not written to). `pick` says which invoices are the ones of the range; the rest overdue go apart.
 */
function asDue(list: CaliInvoice[], pick: (i: CaliInvoice) => boolean, today: string): DueCustomer[] {
  const by = new Map<string, DueCustomer>();
  const fake = new Map<string, number>();
  for (const i of list) {
    let c = by.get(i.key);
    if (!c) {
      if (!fake.has(i.key)) fake.set(i.key, -(fake.size + 1));
      c = {
        contactId: i.holder?.id ?? fake.get(i.key)!, name: i.name, phone: i.holder?.phone ?? '', hasPhone: !!i.holder && isRealPhone(i.holder.phone),
        invoices: [], total: 0, overdue: [], overdueTotal: 0
      };
      by.set(i.key, c);
    }
    if (pick(i)) {
      c.invoices.push({ id: 0, doc: i.doc, dueAt: i.dueAt || today, balance: i.balance });
      c.total += i.balance;
    } else if (i.late > 0) {
      c.overdue.push({ doc: i.doc, balance: i.balance, daysLate: i.late });
      c.overdueTotal += i.balance;
    }
  }
  return [...by.values()]
    .map((c) => ({ ...c, invoices: c.invoices.sort((a, b) => a.dueAt.localeCompare(b.dueAt)), overdue: c.overdue.sort((a, b) => b.daysLate - a.daysLate) }))
    .sort((a, b) => b.total + b.overdueTotal - (a.total + a.overdueTotal));
}

/** Like `dueBetween` of the main cartera: customers with an invoice falling due between `from` and `to`. */
export function caliDueBetween(from: string, to: string, today: string, now = new Date()): DueCustomer[] {
  const list = caliInvoices(now);
  const inRange = (i: CaliInvoice) => i.dueAt >= from && i.dueAt <= to;
  const keys = new Set(list.filter(inRange).map((i) => i.key));
  // Older overdue invoices of the same customer go with them, as in the main list.
  return asDue(
    list.filter((i) => keys.has(i.key) && (inRange(i) || i.dueAt < from)),
    inRange,
    today
  );
}

/** The search box: any Cali customer whose name, NIT or invoice matches every word. */
export function caliSearch(q: string, today: string, now = new Date()): DueCustomer[] {
  const plain = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = plain(q).split(/\s+/).filter(Boolean);
  if (!words.length || words.join('').length < 2) return [];
  const list = caliInvoices(now);
  const hay = new Map<string, string>();
  for (const i of list) hay.set(i.key, `${hay.get(i.key) ?? `${i.name} ${i.cliente} ${i.holder?.phone ?? ''}`} ${i.doc}`);
  const keys = new Set([...hay].filter(([, h]) => words.every((w) => plain(h).includes(w))).map(([k]) => k));
  return asDue(
    list.filter((i) => keys.has(i.key)),
    (i) => i.late <= 0,
    today
  ).slice(0, 20);
}
