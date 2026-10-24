import { getDb } from './db';
import { computeMetrics, type CustomerMetrics } from './scoring';

export type Customer = {
  id: number;
  phone: string;
  name: string;
  stageId: number | null;
  data: Record<string, unknown>;
  createdAt: string;
} & CustomerMetrics;

type Row = {
  id: number;
  phone: string;
  name: string;
  stage_id: number | null;
  data: string;
  created_at: string;
  sales_count: number;
  total_spent: number;
  last_sale_at: string | null;
};

export function listCustomers(): Customer[] {
  const rows = getDb()
    .prepare(
      `SELECT c.*, COUNT(s.id) AS sales_count, COALESCE(SUM(s.amount), 0) AS total_spent, MAX(s.sold_at) AS last_sale_at
       FROM contacts c LEFT JOIN sales s ON s.contact_id = c.id
       GROUP BY c.id ORDER BY c.id`
    )
    .all() as unknown as Row[];

  const metrics = computeMetrics(
    rows.map((r) => ({ salesCount: r.sales_count, totalSpent: r.total_spent, lastSaleAt: r.last_sale_at }))
  );

  return rows.map((r, i) => ({
    id: r.id,
    phone: r.phone,
    name: r.name,
    stageId: r.stage_id,
    data: JSON.parse(r.data) as Record<string, unknown>,
    createdAt: r.created_at,
    ...metrics[i]
  }));
}

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

export function createCustomer(input: { phone: string; name?: string; stageId?: number | null; data?: Record<string, unknown> }) {
  const phone = normalizePhone(input.phone);
  if (phone.length < 7) throw new Error('Teléfono inválido');
  const res = getDb()
    .prepare('INSERT INTO contacts (phone, name, stage_id, data) VALUES (?,?,?,?)')
    .run(phone, input.name ?? '', input.stageId ?? null, JSON.stringify(input.data ?? {}));
  return Number(res.lastInsertRowid);
}

export function updateCustomer(
  id: number,
  patch: { name?: string; stageId?: number | null; data?: Record<string, unknown> }
) {
  const d = getDb();
  if (patch.name !== undefined) d.prepare('UPDATE contacts SET name = ? WHERE id = ?').run(patch.name, id);
  if (patch.stageId !== undefined) d.prepare('UPDATE contacts SET stage_id = ? WHERE id = ?').run(patch.stageId, id);
  if (patch.data !== undefined) {
    const cur = d.prepare('SELECT data FROM contacts WHERE id = ?').get(id) as { data: string } | undefined;
    if (!cur) return;
    d.prepare('UPDATE contacts SET data = ? WHERE id = ?').run(
      JSON.stringify({ ...JSON.parse(cur.data), ...patch.data }),
      id
    );
  }
}

export function deleteCustomer(id: number) {
  getDb().prepare('DELETE FROM contacts WHERE id = ?').run(id);
}

// ---- Import of historical sales -------------------------------------------

export type ImportTarget = 'ignore' | 'phone' | 'name' | 'sold_at' | 'amount' | 'product' | `contact:${string}` | `sale:${string}`;

export function parseAmount(raw: string): number {
  let s = raw.trim().replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // The later separator is the decimal one.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // "1,234" (thousands) vs "12,5" (decimal)
    s = /,\d{3}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot > -1 && /\.\d{3}$/.test(s) && s.indexOf('.') === lastDot) {
    s = s.replace('.', '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Accepts ISO (2024-03-15), dd/mm/yyyy and dd-mm-yyyy (Latin American order).
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  let y: number, m: number, d: number;
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) {
    [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
    if (y < 100) y += 2000;
  } else {
    const t = new Date(s);
    return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

export type ImportResult = {
  rows: number;
  salesCreated: number;
  contactsCreated: number;
  contactsUpdated: number;
  skipped: { row: number; reason: string }[];
};

export function importSales(columns: string[], mapping: Record<string, ImportTarget>, rows: string[][]): ImportResult {
  const d = getDb();
  const idx = (target: ImportTarget) => columns.findIndex((c) => mapping[c] === target);
  const phoneIdx = idx('phone');
  const dateIdx = idx('sold_at');
  if (phoneIdx < 0) throw new Error('Debes asignar una columna al teléfono');
  if (dateIdx < 0) throw new Error('Debes asignar una columna a la fecha de venta');
  const nameIdx = idx('name');
  const amountIdx = idx('amount');
  const productIdx = idx('product');

  const extra = columns
    .map((c, i) => ({ i, target: mapping[c] }))
    .filter((x) => x.target?.startsWith('contact:') || x.target?.startsWith('sale:'));

  const result: ImportResult = { rows: rows.length, salesCreated: 0, contactsCreated: 0, contactsUpdated: 0, skipped: [] };

  const findContact = d.prepare('SELECT id, name, data FROM contacts WHERE phone = ?');
  const insertContact = d.prepare('INSERT INTO contacts (phone, name, stage_id, data) VALUES (?,?,?,?)');
  const updateContact = d.prepare('UPDATE contacts SET name = ?, data = ? WHERE id = ?');
  const insertSale = d.prepare('INSERT INTO sales (contact_id, sold_at, amount, product, data) VALUES (?,?,?,?,?)');
  const clientStage = d.prepare("SELECT id FROM stages WHERE name = 'Cliente'").get() as { id: number } | undefined;

  const touched = new Set<number>();
  d.exec('BEGIN');
  try {
    rows.forEach((row, n) => {
      const line = n + 2; // header is line 1
      const phone = normalizePhone(row[phoneIdx] ?? '');
      if (phone.length < 7) return result.skipped.push({ row: line, reason: 'Teléfono vacío o inválido' });
      const soldAt = parseDate(row[dateIdx] ?? '');
      if (!soldAt) return result.skipped.push({ row: line, reason: 'Fecha inválida' });

      const contactData: Record<string, string> = {};
      const saleData: Record<string, string> = {};
      for (const { i, target } of extra) {
        const value = (row[i] ?? '').trim();
        if (!value) continue;
        if (target.startsWith('contact:')) contactData[target.slice(8)] = value;
        else saleData[target.slice(5)] = value;
      }
      const name = nameIdx >= 0 ? (row[nameIdx] ?? '').trim() : '';

      const existing = findContact.get(phone) as { id: number; name: string; data: string } | undefined;
      let contactId: number;
      if (existing) {
        contactId = existing.id;
        if (!touched.has(contactId)) {
          result.contactsUpdated++;
          touched.add(contactId);
        }
        updateContact.run(
          existing.name || name,
          JSON.stringify({ ...JSON.parse(existing.data), ...contactData }),
          contactId
        );
      } else {
        contactId = Number(insertContact.run(phone, name, clientStage?.id ?? null, JSON.stringify(contactData)).lastInsertRowid);
        touched.add(contactId);
        result.contactsCreated++;
      }

      insertSale.run(
        contactId,
        soldAt,
        amountIdx >= 0 ? parseAmount(row[amountIdx] ?? '') : 0,
        productIdx >= 0 ? (row[productIdx] ?? '').trim() : '',
        JSON.stringify(saleData)
      );
      result.salesCreated++;
    });
    d.exec('COMMIT');
  } catch (error) {
    d.exec('ROLLBACK');
    throw error;
  }
  return result;
}
