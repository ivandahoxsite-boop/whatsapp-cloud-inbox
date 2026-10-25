import { getDb } from './db';
import { addDays, coDateTime, dayProblem, todayCo } from './tasks-info';
import { findContactByNit, normalizeCity, normalizePhone, parseAmount, parseDate, placeholderKey, normalizeNit } from './customers';

export type ReceivableUpsert = {
  /** Invoice number, or whatever is unique per open item in the aging report. Re-sending the same one updates it. */
  externalId: string;
  phone?: string;
  nit?: string;
  name?: string;
  city?: string;
  /** Invoice number to show; defaults to externalId. */
  doc?: string;
  /** Original invoice value. */
  amount?: number | string;
  /** What is still owed. Defaults to `amount`; 0 or less means paid. */
  balance?: number | string;
  issuedAt?: string;
  dueAt?: string;
  seller?: string;
  data?: Record<string, unknown>;
};

export type ReceivablesOptions = {
  dryRun?: boolean;
  /** Create customers that do not exist yet, identified by NIT or name when there is no phone. */
  allowNoPhone?: boolean;
  /** The request is the COMPLETE current aging report for `source`: open items of that source that are not in it are marked paid. */
  closeMissing?: boolean;
  /** Label for where the items come from (e.g. "cartera"); only items with the same source are ever closed. */
  source?: string;
};

type Skip = { index: number; reason: string };

const TERMS_DAYS = () => Number(process.env.CRM_DEFAULT_TERMS_DAYS || 30);
const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Finds the customer for a receivable by phone, then NIT, then (if allowed) creates one without phone. */
function resolveContact(it: ReceivableUpsert, allowCreate: boolean): { id: number; created: boolean } | null {
  const d = getDb();
  const phone = normalizePhone(String(it.phone ?? ''));
  const stage = d.prepare("SELECT id FROM stages WHERE name = 'Cliente'").get() as { id: number } | undefined;
  const nit = normalizeNit(it.nit);
  const data = JSON.stringify(nit ? { nit } : {});
  const create = (key: string) => ({
    id: Number(
      d.prepare('INSERT INTO contacts (phone, name, city, stage_id, data) VALUES (?,?,?,?,?)').run(key, String(it.name ?? '').trim().slice(0, 80), normalizeCity(String(it.city ?? '')), stage?.id ?? null, data).lastInsertRowid
    ),
    created: true
  });
  if (phone.length >= 7) {
    const row = d.prepare('SELECT id FROM contacts WHERE phone = ?').get(phone) as { id: number } | undefined;
    if (row) return { id: row.id, created: false };
    return allowCreate ? create(phone) : null;
  }
  const byNit = findContactByNit(it.nit);
  if (byNit) return { id: byNit, created: false };
  const key = placeholderKey(it.nit, it.name);
  if (!key || !allowCreate) return null;
  const row = d.prepare('SELECT id FROM contacts WHERE phone = ?').get(key) as { id: number } | undefined;
  return row ? { id: row.id, created: false } : create(key);
}

export function upsertReceivables(items: ReceivableUpsert[], options: ReceivablesOptions = {}) {
  const d = getDb();
  const source = String(options.source ?? '').slice(0, 40);
  const res = { dryRun: !!options.dryRun, created: 0, updated: 0, paid: 0, closed: 0, contactsCreated: 0, skipped: [] as Skip[] };
  const find = d.prepare('SELECT id FROM receivables WHERE external_id = ?');
  const seen = new Set<string>();
  d.exec('BEGIN');
  try {
    items.forEach((it, index) => {
      const externalId = String(it?.externalId ?? '').trim().slice(0, 120);
      if (!externalId) return res.skipped.push({ index, reason: 'Falta externalId' });
      const amount = it.amount === undefined ? NaN : typeof it.amount === 'number' ? it.amount : parseAmount(String(it.amount));
      const balanceRaw = it.balance === undefined ? amount : typeof it.balance === 'number' ? it.balance : parseAmount(String(it.balance));
      if (!Number.isFinite(balanceRaw)) return res.skipped.push({ index, reason: 'Falta el saldo (balance o amount)' });
      const issuedAt = it.issuedAt ? parseDate(String(it.issuedAt)) : null;
      const dueAt = it.dueAt ? parseDate(String(it.dueAt)) : null;
      if (it.issuedAt && !issuedAt) return res.skipped.push({ index, reason: 'Fecha de emisión inválida' });
      if (it.dueAt && !dueAt) return res.skipped.push({ index, reason: 'Fecha de vencimiento inválida' });

      const contact = resolveContact(it, !!options.allowNoPhone);
      if (!contact) return res.skipped.push({ index, reason: 'No encuentro al cliente: manda phone o nit de un cliente existente, o allowNoPhone para crearlo' });
      if (contact.created) res.contactsCreated++;

      seen.add(externalId);
      const balance = Math.max(0, balanceRaw);
      const status = balance > 0 ? 'open' : 'paid';
      const row = [
        contact.id, String(it.doc ?? externalId).slice(0, 60), issuedAt, dueAt, Number.isFinite(amount) ? amount : balance, balance,
        String(it.seller ?? '').trim().slice(0, 80), source, status, JSON.stringify(it.data && typeof it.data === 'object' ? it.data : {})
      ];
      if (find.get(externalId)) {
        d.prepare(
          `UPDATE receivables SET contact_id=?, doc=?, issued_at=?, due_at=?, amount=?, balance=?, seller=?, source=?, status=?, data=?,
             paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, date('now')) ELSE NULL END, updated_at = datetime('now') WHERE external_id = ?`
        ).run(...(row as [number, string, string | null, string | null, number, number, string, string, string, string]), status, externalId);
        res.updated++;
      } else {
        d.prepare(
          `INSERT INTO receivables (contact_id, doc, issued_at, due_at, amount, balance, seller, source, status, data, external_id, paid_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?, CASE WHEN ? = 'paid' THEN date('now') END)`
        ).run(...(row as [number, string, string | null, string | null, number, number, string, string, string, string]), externalId, status);
        res.created++;
      }
      if (status === 'paid') res.paid++;
    });

    if (options.closeMissing) {
      if (!source) throw new Error('closeMissing necesita "source" (ej: "cartera") para saber qué reporte se está reemplazando');
      const open = d.prepare("SELECT id, external_id FROM receivables WHERE status = 'open' AND source = ?").all(source) as unknown as { id: number; external_id: string }[];
      for (const r of open) {
        if (seen.has(r.external_id)) continue;
        d.prepare("UPDATE receivables SET status = 'paid', balance = 0, paid_at = date('now'), updated_at = datetime('now') WHERE id = ?").run(r.id);
        res.closed++;
      }
    }
    // When the last real load happened: the debt warnings are only as fresh as this.
    if (!options.dryRun && seen.size) d.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('receivables_loaded_at', datetime('now'))").run();
    d.exec(options.dryRun ? 'ROLLBACK' : 'COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return res;
}

export type Debtor = {
  contactId: number;
  name: string;
  phone: string;
  hasPhone: boolean;
  seller: string;
  balance: number;
  overdue: number;
  /** Days the oldest unpaid invoice is past due (0 if nothing is overdue). */
  oldestDays: number;
  invoices: number;
};

export type AgingKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90';
export type Aging = { key: AgingKey; label: string; amount: number; invoices: number };
const AGING_KEYS: AgingKey[] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90'];
export const isAgingKey = (v: unknown): v is AgingKey => AGING_KEYS.includes(v as AgingKey);

type OpenRow = { id: number; contact_id: number; doc: string; issued_at: string | null; due_at: string | null; balance: number; seller: string; name: string; phone: string };

function daysLate(r: { issued_at: string | null; due_at: string | null }, today: Date): number {
  const due = r.due_at ?? (r.issued_at ? isoDay(new Date(Date.parse(r.issued_at) + TERMS_DAYS() * DAY)) : null);
  if (!due) return 0;
  return Math.floor((Date.parse(isoDay(today)) - Date.parse(due)) / DAY);
}

/**
 * `bucket` narrows only the list of debtors (and what each one owes) to invoices in that age range; the totals and the
 * aging bars always show everything so the ranges can be compared and switched.
 */
export function receivablesSummary(filter: { seller?: string; bucket?: AgingKey } = {}, now = new Date()) {
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.contact_id, r.doc, r.issued_at, r.due_at, r.balance, r.seller, c.name, c.phone
       FROM receivables r JOIN contacts c ON c.id = r.contact_id WHERE r.status = 'open'`
    )
    .all() as unknown as OpenRow[];

  const aging: Aging[] = [
    { key: 'current', label: 'Al día', amount: 0, invoices: 0 },
    { key: 'd1_30', label: '1-30 días', amount: 0, invoices: 0 },
    { key: 'd31_60', label: '31-60 días', amount: 0, invoices: 0 },
    { key: 'd61_90', label: '61-90 días', amount: 0, invoices: 0 },
    { key: 'd90', label: 'Más de 90', amount: 0, invoices: 0 }
  ];
  const bySeller = new Map<string, { balance: number; overdue: number }>();
  const debtors = new Map<number, Debtor>();
  const allDebtors = new Set<number>();
  const sellers = new Set<string>();
  let balance = 0;
  let overdue = 0;
  let invoices = 0;

  for (const r of rows) {
    if (r.seller) sellers.add(r.seller);
    if (filter.seller && r.seller !== filter.seller) continue;
    const late = daysLate(r, now);
    const bucket = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
    aging[bucket].amount += r.balance;
    aging[bucket].invoices++;
    balance += r.balance;
    invoices++;
    if (late > 0) overdue += r.balance;

    const s = bySeller.get(r.seller || 'Sin vendedor') ?? { balance: 0, overdue: 0 };
    s.balance += r.balance;
    if (late > 0) s.overdue += r.balance;
    bySeller.set(r.seller || 'Sin vendedor', s);

    allDebtors.add(r.contact_id);
    if (filter.bucket && AGING_KEYS[bucket] !== filter.bucket) continue;
    const dbt = debtors.get(r.contact_id) ?? {
      contactId: r.contact_id, name: r.name, phone: r.phone, hasPhone: /^\d{7,}$/.test(r.phone), seller: r.seller, balance: 0, overdue: 0, oldestDays: 0, invoices: 0
    };
    dbt.balance += r.balance;
    if (late > 0) dbt.overdue += r.balance;
    dbt.oldestDays = Math.max(dbt.oldestDays, late);
    dbt.invoices++;
    debtors.set(r.contact_id, dbt);
  }

  return {
    totals: { balance, overdue, invoices, debtors: allDebtors.size },
    /** What the (possibly bucket-filtered) debtor list adds up to. */
    listed: { customers: debtors.size, amount: [...debtors.values()].reduce((a, d) => a + d.balance, 0) },
    aging,
    bucket: filter.bucket ?? null,
    bySeller: [...bySeller].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.overdue - a.overdue || b.balance - a.balance),
    debtors: [...debtors.values()].sort((a, b) => b.overdue - a.overdue || b.balance - a.balance).slice(0, 100),
    sellers: [...sellers].sort(),
    freshness: receivablesFreshness(now.getTime())
  };
}
export type ReceivablesSummary = ReturnType<typeof receivablesSummary>;

export type CustomerReceivable = { id: number; doc: string; issuedAt: string | null; dueAt: string | null; balance: number; daysLate: number; seller: string };

export function customerReceivables(contactId: number, now = new Date()): CustomerReceivable[] {
  const rows = getDb()
    .prepare("SELECT id, doc, issued_at, due_at, balance, seller FROM receivables WHERE contact_id = ? AND status = 'open' ORDER BY COALESCE(due_at, issued_at)")
    .all(contactId) as unknown as { id: number; doc: string; issued_at: string | null; due_at: string | null; balance: number; seller: string }[];
  return rows.map((r) => ({ id: r.id, doc: r.doc, issuedAt: r.issued_at, dueAt: r.due_at, balance: r.balance, daysLate: daysLate(r, now), seller: r.seller }));
}

export function markReceivablePaid(id: number) {
  getDb().prepare("UPDATE receivables SET status = 'paid', balance = 0, paid_at = date('now'), updated_at = datetime('now') WHERE id = ?").run(id);
}

export type DebtFlag = { contactId: number; balance: number; overdue: number; days: number };

/**
 * What each customer owes, keyed by WhatsApp number (digits), for the warning in the inbox and the customer file.
 * Only customers with an open balance appear.
 */
export function debtsByPhone(now = new Date()): Record<string, DebtFlag> {
  const rows = getDb()
    .prepare(
      `SELECT r.contact_id, r.issued_at, r.due_at, r.balance, c.phone FROM receivables r JOIN contacts c ON c.id = r.contact_id
       WHERE r.status = 'open' AND r.balance > 0`
    )
    .all() as unknown as { contact_id: number; issued_at: string | null; due_at: string | null; balance: number; phone: string }[];
  const out: Record<string, DebtFlag> = {};
  for (const r of rows) {
    if (!/^\d{7,}$/.test(r.phone)) continue;
    const f = (out[r.phone] ??= { contactId: r.contact_id, balance: 0, overdue: 0, days: 0 });
    const late = daysLate(r, now);
    f.balance += r.balance;
    if (late > 0) f.overdue += r.balance;
    f.days = Math.max(f.days, late);
  }
  return out;
}

/** When OpenClaw loads the aging report from AnaliX: Monday to Saturday (not holidays), Colombian time. */
export const LOAD_TIMES = ['09:00', '13:00', '17:40'];
/** A load counts as missed this long after its time (it takes a few minutes). */
const GRACE_MS = 20 * 60_000;

export type ReceivablesFreshness = {
  loadedAt: string;
  /** Scheduled loads that should have happened since `loadedAt` and did not. */
  missed: number;
  stale: boolean;
  /** Next scheduled load (ISO). */
  nextAt: string;
};

/** Instant of a "HH:MM" Colombian time on a "YYYY-MM-DD" day (Colombia is UTC-5 all year). */
const slotMs = (day: string, time: string) => Date.parse(`${day}T${time}:00Z`) + 5 * 3_600_000;

/** How fresh the loaded aging report is compared with the load schedule. Null when nothing was ever loaded. */
export function receivablesFreshness(now = Date.now()): ReceivablesFreshness | null {
  const d = getDb();
  const set = d.prepare("SELECT value FROM settings WHERE key = 'receivables_loaded_at'").get() as { value: string } | undefined;
  // Loads made before this was recorded: the newest change to any invoice.
  const last = set?.value ?? (d.prepare('SELECT MAX(updated_at) AS t FROM receivables').get() as { t: string | null }).t;
  if (!last) return null;
  const loadedAt = `${last.replace(' ', 'T')}Z`;
  const loadedMs = Date.parse(loadedAt);
  const today = todayCo(now);
  let missed = 0;
  for (let day = todayCo(loadedMs); day <= today; day = addDays(day, 1)) {
    if (dayProblem(day)) continue;
    for (const t of LOAD_TIMES) {
      const at = slotMs(day, t);
      if (at > loadedMs && at + GRACE_MS <= now) missed++;
    }
  }
  let nextAt = '';
  for (let day = today; !nextAt; day = addDays(day, 1)) {
    if (dayProblem(day)) continue;
    const t = LOAD_TIMES.find((x) => slotMs(day, x) > now);
    if (t) nextAt = new Date(slotMs(day, t)).toISOString();
  }
  return { loadedAt, missed, stale: missed > 0, nextAt };
}

/** One line for the morning brief, or null when the report is up to date. */
export function receivablesStaleWarning(now = Date.now()): string | null {
  const f = receivablesFreshness(now);
  if (!f?.stale) return null;
  return `⚠️ La cartera no se actualiza desde el ${coDateTime(f.loadedAt)}: faltaron ${f.missed} actualizaci${f.missed === 1 ? 'ón' : 'ones'} programada${f.missed === 1 ? '' : 's'} (lun-sáb 9:00 a. m., 1:00 p. m. y 5:40 p. m.). Los avisos de deuda pueden estar viejos: revisa las cargas de OpenClaw.`;
}
