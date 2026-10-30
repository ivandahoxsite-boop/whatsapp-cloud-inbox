import { getDb } from './db';
import { CREDITS_SETTING, caliStore, type CreditNote } from './cartera-sheet';
import { caliHolder } from './cartera-cali';
import { isRealPhone } from './customers';
import { daysLate } from './receivables';
import { todayCo } from './tasks-info';

/**
 * The cartera laid out like the billing system's "Reporte Extracto de Cartera" (the user's Excel): one row per invoice
 * grouped by customer, with a total per customer, and the sheet's credit notes subtracted (only in this view).
 * Days ("DiasVc") are the age of the debt: counted from the ISSUE date, and the balance goes to the aging range of that
 * age even before the due date ("cobrar desde ya", the user's correction of 27-oct-2026), so "Por_Venc" stays at 0.
 */

export type ExtractBuckets = { v91: number; v61_90: number; v31_60: number; v0_30: number; porVenc: number };
export type ExtractRow = {
  doc: string;
  issuedAt: string | null;
  dueAt: string | null;
  /** Age of the debt: days since the issue date. */
  diasVc: number | null;
  deuda: number;
  pagado: number;
  saldo: number;
  buckets: ExtractBuckets;
  credit: boolean;
};
export type ExtractGroup = {
  key: string;
  cliente: string;
  name: string;
  contactId: number | null;
  phone: string;
  hasPhone: boolean;
  rows: ExtractRow[];
  total: Omit<ExtractRow, 'doc' | 'issuedAt' | 'dueAt' | 'diasVc' | 'credit'>;
  /** For the collection message (CRM rule: days counted from the issue date). */
  oldestDoc: string;
  oldestBalance: number;
  oldestDays: number;
};
export type CarteraExtract = {
  date: string;
  groups: ExtractGroup[];
  grand: ExtractGroup['total'];
  sellers: string[];
  /** Only for the "Cartera Cali" tab: when the sheet was read, its cut-off date and the last reading problem. */
  sheet?: { at: string; corte: string | null; error?: string } | null;
};

/** One open invoice, wherever it comes from (the CRM's cartera or the "Cartera Cali" copy). */
type Source = {
  doc: string; issued_at: string | null; due_at: string | null; amount: number; balance: number; seller: string;
  key: string; raw: string; nombre: string; contactId: number | null; contactName: string; phone: string;
};
type Holder = { id: number; phone: string; name: string } | undefined;

const DAY = 86_400_000;
const zero = (): ExtractBuckets => ({ v91: 0, v61_90: 0, v31_60: 0, v0_30: 0, porVenc: 0 });

/** Aging range by the age of the debt; only an invoice without dates stays in "Por_Venc". */
function bucketOf(dias: number | null): keyof ExtractBuckets {
  if (dias === null) return 'porVenc';
  if (dias <= 30) return 'v0_30';
  if (dias <= 60) return 'v31_60';
  if (dias <= 90) return 'v61_90';
  return 'v91';
}

const addTotals = (t: ExtractGroup['total'], r: ExtractRow) => {
  t.deuda += r.deuda;
  t.pagado += r.pagado;
  t.saldo += r.saldo;
  for (const k of Object.keys(r.buckets) as (keyof ExtractBuckets)[]) t.buckets[k] += r.buckets[k];
};

export function carteraExtract(filter: { seller?: string } = {}, now = new Date()): CarteraExtract {
  const d = getDb();
  const rows = (
    d
      .prepare(
        `SELECT r.doc, r.issued_at, r.due_at, r.amount, r.balance, r.seller, r.contact_id, c.name AS contact_name, c.phone,
                json_extract(r.data, '$.cliente') AS key, json_extract(r.data, '$.clienteRaw') AS raw, json_extract(r.data, '$.nombre') AS nombre
         FROM receivables r JOIN contacts c ON c.id = r.contact_id WHERE r.status = 'open'`
      )
      .all() as {
      doc: string; issued_at: string | null; due_at: string | null; amount: number; balance: number; seller: string; contact_id: number;
      contact_name: string; phone: string; key: string | null; raw: string | null; nombre: string | null;
    }[]
  ).map(
    (r): Source => ({
      ...r, key: r.key ?? `c${r.contact_id}`, raw: r.raw ?? r.key ?? '', nombre: r.nombre || r.contact_name,
      contactId: r.contact_id, contactName: r.contact_name
    })
  );
  // The sheet's credit notes, subtracted only here (the user crosses them by hand elsewhere).
  const stored = d.prepare('SELECT value FROM settings WHERE key = ?').get(CREDITS_SETTING) as { value: string } | undefined;
  let credits: CreditNote[] = [];
  try {
    credits = stored ? (JSON.parse(stored.value) as CreditNote[]) : [];
  } catch {
    credits = [];
  }
  const holder = (key: string): Holder =>
    d
      .prepare("SELECT c.id, c.phone, c.name FROM receivables r JOIN contacts c ON c.id = r.contact_id WHERE json_extract(r.data, '$.cliente') = ? LIMIT 1")
      .get(key) as Holder;
  return buildExtract(rows, credits, holder, filter, now);
}

/** The "Cartera Cali" tab of the sheet, apart from the CRM's cartera (user's request, 30-oct-2026: "NO JUNTA"). */
export function caliExtract(filter: { seller?: string } = {}, now = new Date()): CarteraExtract {
  const store = caliStore();
  const known = new Map<string, Holder>();
  const holder = (key: string, cliente = '', name = ''): Holder => {
    if (!known.has(key)) known.set(key, caliHolder(key, cliente, name));
    return known.get(key);
  };
  const rows = (store?.invoices ?? []).map((i): Source => {
    const h = holder(i.key, i.cliente, i.name);
    return {
      doc: i.doc, issued_at: i.issuedAt, due_at: i.dueAt, amount: i.amount, balance: i.balance, seller: i.seller,
      key: i.key, raw: i.cliente, nombre: i.name, contactId: h?.id ?? null, contactName: h?.name ?? '', phone: h?.phone ?? ''
    };
  });
  const out = buildExtract(rows, store?.credits ?? [], (k) => holder(k), filter, now);
  return { ...out, sheet: store ? { at: store.at, corte: store.corte, error: store.error } : null };
}

function buildExtract(rows: Source[], credits: CreditNote[], holderOf: (key: string) => Holder, filter: { seller?: string }, now: Date): CarteraExtract {
  const today = todayCo(now.getTime());
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const terms = Number(process.env.CRM_DEFAULT_TERMS_DAYS || 30);
  /** Days since the invoice was issued (if the issue date is missing, the due date minus the usual terms). */
  const dias = (issued: string | null, due: string | null) => {
    const from = issued ? Date.parse(`${issued.slice(0, 10)}T00:00:00Z`) : due ? Date.parse(`${due.slice(0, 10)}T00:00:00Z`) - terms * DAY : NaN;
    return Number.isFinite(from) ? Math.max(0, Math.round((todayMs - from) / DAY)) : null;
  };

  const sellers = new Set<string>();
  const groups = new Map<string, ExtractGroup>();
  const group = (key: string, init: () => Omit<ExtractGroup, 'rows' | 'total' | 'oldestDoc' | 'oldestBalance' | 'oldestDays'>) => {
    let g = groups.get(key);
    if (!g) {
      g = { ...init(), rows: [], total: { deuda: 0, pagado: 0, saldo: 0, buckets: zero() }, oldestDoc: '', oldestBalance: 0, oldestDays: 0 };
      groups.set(key, g);
    }
    return g;
  };

  for (const r of rows) {
    if (r.seller) sellers.add(r.seller);
    if (filter.seller && r.seller !== filter.seller) continue;
    const g = group(r.key, () => ({
      key: r.key,
      cliente: r.raw,
      name: r.nombre,
      contactId: r.contactId,
      phone: r.phone,
      hasPhone: isRealPhone(r.phone)
    }));
    const dv = dias(r.issued_at, r.due_at);
    const buckets = zero();
    buckets[bucketOf(dv)] = r.balance;
    const row: ExtractRow = {
      doc: r.doc, issuedAt: r.issued_at, dueAt: r.due_at, diasVc: dv,
      deuda: r.amount, pagado: Math.max(0, r.amount - r.balance), saldo: r.balance, buckets, credit: false
    };
    g.rows.push(row);
    addTotals(g.total, row);
    const late = daysLate(r, now);
    if (late > 0 && late >= g.oldestDays) Object.assign(g, { oldestDoc: r.doc, oldestBalance: r.balance, oldestDays: late });
  }

  for (const n of credits) {
    if (n.seller) sellers.add(n.seller);
    if (filter.seller && n.seller !== filter.seller) continue;
    const g = group(n.key, () => {
      const holder = holderOf(n.key);
      return { key: n.key, cliente: n.cliente, name: n.name, contactId: holder?.id ?? null, phone: holder?.phone ?? '', hasPhone: !!holder && isRealPhone(holder.phone) };
    });
    const dv = dias(n.issuedAt, n.dueAt);
    const buckets = zero();
    buckets[bucketOf(dv)] = n.amount;
    const row: ExtractRow = { doc: n.doc, issuedAt: n.issuedAt, dueAt: n.dueAt, diasVc: dv, deuda: n.amount, pagado: 0, saldo: n.amount, buckets, credit: true };
    g.rows.push(row);
    addTotals(g.total, row);
  }

  const list = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const grand = { deuda: 0, pagado: 0, saldo: 0, buckets: zero() };
  for (const g of list) {
    g.rows.sort((a, b) => a.doc.localeCompare(b.doc, 'es', { numeric: true }));
    grand.deuda += g.total.deuda;
    grand.pagado += g.total.pagado;
    grand.saldo += g.total.saldo;
    for (const k of Object.keys(grand.buckets) as (keyof ExtractBuckets)[]) grand.buckets[k] += g.total.buckets[k];
  }
  return { date: today, groups: list, grand, sellers: [...sellers].sort() };
}
