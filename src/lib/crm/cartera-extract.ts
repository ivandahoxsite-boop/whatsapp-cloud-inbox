import { getDb } from './db';
import { CREDITS_SETTING, type CreditNote } from './cartera-sheet';
import { isRealPhone } from './customers';
import { daysLate } from './receivables';
import { todayCo } from './tasks-info';

/**
 * The cartera laid out like the billing system's "Reporte Extracto de Cartera" (the user's Excel): one row per invoice
 * grouped by customer, with a total per customer. On the user's request (27-oct-2026) this view counts days and aging
 * ranges like the Excel, from the DUE date (DiasVc), and shows the sheet's credit notes subtracted. Everywhere else the
 * CRM keeps counting arrears from the issue date and never applies credit notes.
 */

export type ExtractBuckets = { v91: number; v61_90: number; v31_60: number; v0_30: number; porVenc: number };
export type ExtractRow = {
  doc: string;
  issuedAt: string | null;
  dueAt: string | null;
  /** Days since the due date (negative: days left), like the Excel's DiasVc. */
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
export type CarteraExtract = { date: string; groups: ExtractGroup[]; grand: ExtractGroup['total']; sellers: string[] };

const DAY = 86_400_000;
const zero = (): ExtractBuckets => ({ v91: 0, v61_90: 0, v31_60: 0, v0_30: 0, porVenc: 0 });

function bucketOf(dias: number | null): keyof ExtractBuckets {
  if (dias === null || dias <= 0) return 'porVenc';
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
  const today = todayCo(now.getTime());
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const dias = (due: string | null) => (due ? Math.round((todayMs - Date.parse(`${due.slice(0, 10)}T00:00:00Z`)) / DAY) : null);

  const rows = d
    .prepare(
      `SELECT r.doc, r.issued_at, r.due_at, r.amount, r.balance, r.seller, r.contact_id, c.name AS contact_name, c.phone,
              json_extract(r.data, '$.cliente') AS key, json_extract(r.data, '$.clienteRaw') AS raw, json_extract(r.data, '$.nombre') AS nombre
       FROM receivables r JOIN contacts c ON c.id = r.contact_id WHERE r.status = 'open'`
    )
    .all() as {
    doc: string; issued_at: string | null; due_at: string | null; amount: number; balance: number; seller: string; contact_id: number;
    contact_name: string; phone: string; key: string | null; raw: string | null; nombre: string | null;
  }[];

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
    const key = r.key ?? `c${r.contact_id}`;
    const g = group(key, () => ({
      key,
      cliente: r.raw ?? r.key ?? '',
      name: r.nombre || r.contact_name,
      contactId: r.contact_id,
      phone: r.phone,
      hasPhone: isRealPhone(r.phone)
    }));
    const dv = dias(r.due_at);
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

  // The sheet's credit notes, subtracted only here (the user crosses them by hand elsewhere).
  const stored = d.prepare('SELECT value FROM settings WHERE key = ?').get(CREDITS_SETTING) as { value: string } | undefined;
  let credits: CreditNote[] = [];
  try {
    credits = stored ? (JSON.parse(stored.value) as CreditNote[]) : [];
  } catch {
    credits = [];
  }
  for (const n of credits) {
    if (n.seller) sellers.add(n.seller);
    if (filter.seller && n.seller !== filter.seller) continue;
    const g = group(n.key, () => {
      const holder = d
        .prepare("SELECT c.id, c.phone FROM receivables r JOIN contacts c ON c.id = r.contact_id WHERE json_extract(r.data, '$.cliente') = ? LIMIT 1")
        .get(n.key) as { id: number; phone: string } | undefined;
      return { key: n.key, cliente: n.cliente, name: n.name, contactId: holder?.id ?? null, phone: holder?.phone ?? '', hasPhone: !!holder && isRealPhone(holder.phone) };
    });
    const dv = dias(n.dueAt);
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
