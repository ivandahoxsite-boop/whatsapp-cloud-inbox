import { getDb } from './db';
import { computeMetrics, computeRecurrence, type CustomerMetrics, type RecurrenceMetrics } from './scoring';
import { addTags, ensureTag, tagsByContact } from './tags';
import { cityKey } from './filters';
import { AWAITING_WINDOW_DAYS, needsReply } from './reply';

export type Customer = {
  id: number;
  phone: string;
  name: string;
  city: string;
  tags: number[];
  stageId: number | null;
  data: Record<string, unknown>;
  createdAt: string;
  /** ISO timestamps of the last WhatsApp message from / to the customer. */
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastInboundText: string;
  /** Their last message is newer than your last reply and is more than a "thanks"/"ok"/sticker. */
  awaitingReply: boolean;
} & CustomerMetrics &
  RecurrenceMetrics;

const sqlToIso = (s: string | null) => (s ? `${s.replace(' ', 'T')}Z` : null);

type Row = {
  id: number;
  phone: string;
  name: string;
  city: string;
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

  const salesByContact = new Map<number, { soldAt: string; product: string; amount: number }[]>();
  const sales = getDb().prepare('SELECT contact_id, sold_at, product, amount FROM sales').all() as unknown as {
    contact_id: number; sold_at: string; product: string; amount: number;
  }[];
  for (const s of sales) {
    const list = salesByContact.get(s.contact_id) ?? [];
    list.push({ soldAt: s.sold_at, product: s.product, amount: s.amount });
    salesByContact.set(s.contact_id, list);
  }
  const tags = tagsByContact();
  const now = new Date();
  const chat = new Map<number, { lastIn: string | null; lastOut: string | null; lastInText: string }>();
  const chatRows = getDb()
    .prepare(
      `SELECT contact_id,
              MAX(CASE WHEN kind = 'whatsapp_in' THEN created_at END) AS last_in,
              MAX(CASE WHEN kind = 'whatsapp_out' THEN created_at END) AS last_out,
              (SELECT a2.text FROM activities a2 WHERE a2.contact_id = a.contact_id AND a2.kind = 'whatsapp_in'
               ORDER BY a2.created_at DESC, a2.id DESC LIMIT 1) AS last_in_text
       FROM activities a WHERE kind IN ('whatsapp_in', 'whatsapp_out') GROUP BY contact_id`
    )
    .all() as unknown as { contact_id: number; last_in: string | null; last_out: string | null; last_in_text: string | null }[];
  for (const r of chatRows) chat.set(r.contact_id, { lastIn: r.last_in, lastOut: r.last_out, lastInText: r.last_in_text ?? '' });

  // "Bogota" and "Bogotá" are the same city: show every variant with its most common spelling.
  const spellings = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.city) continue;
    const k = cityKey(r.city);
    const m = spellings.get(k) ?? new Map<string, number>();
    m.set(r.city, (m.get(r.city) ?? 0) + 1);
    spellings.set(k, m);
  }
  const canonical = new Map([...spellings].map(([k, m]) => [k, [...m].sort((a, b) => b[1] - a[1])[0][0]]));

  return rows.map((r, i) => ({
    id: r.id,
    phone: r.phone,
    name: r.name,
    city: r.city ? canonical.get(cityKey(r.city)) ?? r.city : '',
    tags: tags.get(r.id) ?? [],
    stageId: r.stage_id,
    data: JSON.parse(r.data) as Record<string, unknown>,
    createdAt: r.created_at,
    ...chatState(chat.get(r.id)),
    ...metrics[i],
    ...computeRecurrence(salesByContact.get(r.id) ?? [], now)
  }));
}

function chatState(c?: { lastIn: string | null; lastOut: string | null; lastInText: string }) {
  if (!c) return { lastInboundAt: null, lastOutboundAt: null, lastInboundText: '', awaitingReply: false };
  const recent = !!c.lastIn && Date.now() - Date.parse(`${c.lastIn.replace(' ', 'T')}Z`) <= AWAITING_WINDOW_DAYS * 86_400_000;
  const awaitingReply = recent && (!c.lastOut || c.lastIn! > c.lastOut) && needsReply(c.lastInText);
  return { lastInboundAt: sqlToIso(c.lastIn), lastOutboundAt: sqlToIso(c.lastOut), lastInboundText: c.lastInText, awaitingReply };
}

/** Trims and title-cases a city so "bogotá" and "Bogotá " are stored the same way. */
export function normalizeCity(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 60)
    .toLocaleLowerCase('es')
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('es'));
}

export function getCustomerSales(id: number) {
  return getDb()
    .prepare('SELECT id, sold_at AS soldAt, amount, product, data FROM sales WHERE contact_id = ? ORDER BY sold_at DESC, id DESC')
    .all(id)
    .map((r) => {
      const row = r as { id: number; soldAt: string; amount: number; product: string; data: string };
      return { ...row, data: JSON.parse(row.data) as Record<string, unknown> };
    });
}

// Billing systems store Colombian mobiles without the country code (3001234567) while WhatsApp
// uses 573001234567; add it so both land on the same customer. Override with CRM_DEFAULT_COUNTRY_CODE.
const DEFAULT_CC = (process.env.CRM_DEFAULT_COUNTRY_CODE ?? '57').replace(/\D/g, '');

export function normalizePhone(value: string): string {
  let d = value.replace(/\D/g, '').replace(/^00/, '');
  if (DEFAULT_CC === '57' && d.length === 10 && d.startsWith('3')) d = `57${d}`;
  return d;
}

export function createCustomer(input: {
  phone: string;
  name?: string;
  city?: string;
  stageId?: number | null;
  data?: Record<string, unknown>;
}) {
  const phone = normalizePhone(input.phone);
  if (phone.length < 7) throw new Error('Teléfono inválido');
  const d = getDb();
  if (d.prepare('SELECT 1 FROM contacts WHERE phone = ?').get(phone)) throw new Error('Ya existe un cliente con ese teléfono');
  const res = d
    .prepare('INSERT INTO contacts (phone, name, city, stage_id, data) VALUES (?,?,?,?,?)')
    .run(phone, (input.name ?? '').trim(), normalizeCity(input.city ?? ''), input.stageId ?? null, JSON.stringify(input.data ?? {}));
  return Number(res.lastInsertRowid);
}

export function updateCustomer(
  id: number,
  patch: { name?: string; city?: string; stageId?: number | null; data?: Record<string, unknown> }
) {
  const d = getDb();
  if (patch.name !== undefined) d.prepare('UPDATE contacts SET name = ? WHERE id = ?').run(patch.name.trim(), id);
  if (patch.city !== undefined) d.prepare('UPDATE contacts SET city = ? WHERE id = ?').run(normalizeCity(patch.city), id);
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

export type ImportTarget =
  | 'ignore'
  | 'phone'
  | 'name'
  | 'city'
  | 'tags'
  | 'sold_at'
  | 'amount'
  | 'product'
  | `contact:${string}`
  | `sale:${string}`;

export function parseAmount(raw: string): number {
  let s = raw.trim().replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  // Only thousands separators: "1.200.000" (Colombia) or "1,200,000".
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
  if (/^-?\d{1,3}(,\d{3})+$/.test(s)) return Number(s.replace(/,/g, ''));
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
  const cityIdx = idx('city');
  const tagsIdx = idx('tags');
  const amountIdx = idx('amount');
  const productIdx = idx('product');

  const extra = columns
    .map((c, i) => ({ i, target: mapping[c] }))
    .filter((x) => x.target?.startsWith('contact:') || x.target?.startsWith('sale:'));

  const result: ImportResult = { rows: rows.length, salesCreated: 0, contactsCreated: 0, contactsUpdated: 0, skipped: [] };

  const findContact = d.prepare('SELECT id, name, city, data FROM contacts WHERE phone = ?');
  const insertContact = d.prepare('INSERT INTO contacts (phone, name, city, stage_id, data) VALUES (?,?,?,?,?)');
  const updateContact = d.prepare('UPDATE contacts SET name = ?, city = ?, data = ? WHERE id = ?');
  const tagCache = new Map<string, number>();
  const tagId = (name: string) => {
    const key = name.trim().toLowerCase();
    if (!tagCache.has(key)) tagCache.set(key, ensureTag(name));
    return tagCache.get(key)!;
  };
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
      const city = cityIdx >= 0 ? normalizeCity(row[cityIdx] ?? '') : '';

      const existing = findContact.get(phone) as { id: number; name: string; city: string; data: string } | undefined;
      let contactId: number;
      if (existing) {
        contactId = existing.id;
        if (!touched.has(contactId)) {
          result.contactsUpdated++;
          touched.add(contactId);
        }
        updateContact.run(
          existing.name || name,
          city || existing.city,
          JSON.stringify({ ...JSON.parse(existing.data), ...contactData }),
          contactId
        );
      } else {
        contactId = Number(
          insertContact.run(phone, name, city, clientStage?.id ?? null, JSON.stringify(contactData)).lastInsertRowid
        );
        touched.add(contactId);
        result.contactsCreated++;
      }

      if (tagsIdx >= 0) {
        const names = (row[tagsIdx] ?? '').split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
        if (names.length) addTags([contactId], names.map(tagId));
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

// ---- Bulk upserts for the agent (e.g. OpenClaw copying from the billing system) -------------

export type CustomerUpsert = { phone: string; name?: string; city?: string; tags?: string[]; data?: Record<string, unknown> };
export type SaleUpsert = {
  phone: string;
  soldAt: string;
  amount: number | string;
  product?: string;
  /** Invoice or order number; the same id is stored only once. */
  externalId?: string;
  name?: string;
  city?: string;
  /** Extra details kept with the sale, e.g. { seller, zone, qty }. */
  data?: Record<string, unknown>;
  /** Tags added to the customer, e.g. ["Zona Antioquia"]. */
  tags?: string[];
};

type Skip = { index: number; reason: string };

/** Creates or completes customers by phone. Existing values are only overwritten when a new one is given. */
export function upsertCustomers(items: CustomerUpsert[]) {
  const d = getDb();
  const res = { created: 0, updated: 0, skipped: [] as Skip[] };
  const find = d.prepare('SELECT id, name, city, data FROM contacts WHERE phone = ?');
  d.exec('BEGIN');
  try {
    items.forEach((it, index) => {
      const phone = normalizePhone(String(it?.phone ?? ''));
      if (phone.length < 7) return res.skipped.push({ index, reason: 'Teléfono inválido' });
      const name = String(it.name ?? '').trim().slice(0, 80);
      const city = normalizeCity(String(it.city ?? ''));
      const existing = find.get(phone) as { id: number; name: string; city: string; data: string } | undefined;
      let id: number;
      if (existing) {
        id = existing.id;
        d.prepare('UPDATE contacts SET name = ?, city = ?, data = ? WHERE id = ?').run(
          name || existing.name,
          city || existing.city,
          JSON.stringify({ ...JSON.parse(existing.data), ...(it.data ?? {}) }),
          id
        );
        res.updated++;
      } else {
        id = Number(
          d.prepare('INSERT INTO contacts (phone, name, city, data) VALUES (?,?,?,?)').run(phone, name, city, JSON.stringify(it.data ?? {}))
            .lastInsertRowid
        );
        res.created++;
      }
      const tags = (Array.isArray(it.tags) ? it.tags : []).map(String).filter((t) => t.trim());
      if (tags.length) addTags([id], tags.map(ensureTag));
    });
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return res;
}

/** Adds sales, creating the customer if needed; sales with an already stored externalId are skipped. */
export function upsertSales(items: SaleUpsert[]) {
  const d = getDb();
  const res = { created: 0, duplicates: 0, contactsCreated: 0, skipped: [] as Skip[] };
  const find = d.prepare('SELECT id, name, city FROM contacts WHERE phone = ?');
  const dup = d.prepare('SELECT 1 FROM sales WHERE external_id = ?');
  const clientStage = d.prepare("SELECT id FROM stages WHERE name = 'Cliente'").get() as { id: number } | undefined;
  d.exec('BEGIN');
  try {
    items.forEach((it, index) => {
      const phone = normalizePhone(String(it?.phone ?? ''));
      if (phone.length < 7) return res.skipped.push({ index, reason: 'Teléfono inválido' });
      const soldAt = parseDate(String(it.soldAt ?? ''));
      if (!soldAt) return res.skipped.push({ index, reason: 'Fecha inválida' });
      const amount = typeof it.amount === 'number' ? it.amount : parseAmount(String(it.amount ?? ''));
      if (!Number.isFinite(amount)) return res.skipped.push({ index, reason: 'Monto inválido' });
      const externalId = it.externalId ? String(it.externalId).trim().slice(0, 80) : null;
      if (externalId && dup.get(externalId)) return void res.duplicates++;

      const name = String(it.name ?? '').trim().slice(0, 80);
      const city = normalizeCity(String(it.city ?? ''));
      const existing = find.get(phone) as { id: number; name: string; city: string } | undefined;
      let contactId: number;
      if (existing) {
        contactId = existing.id;
        if ((name && !existing.name) || (city && !existing.city)) {
          d.prepare('UPDATE contacts SET name = ?, city = ? WHERE id = ?').run(existing.name || name, existing.city || city, contactId);
        }
        // Someone who buys is a customer, whatever stage the chat left them in.
        if (clientStage) d.prepare("UPDATE contacts SET stage_id = ? WHERE id = ? AND (stage_id IS NULL OR stage_id IN (SELECT id FROM stages WHERE name = 'Nuevo'))").run(clientStage.id, contactId);
      } else {
        contactId = Number(
          d.prepare("INSERT INTO contacts (phone, name, city, stage_id, data) VALUES (?,?,?,?, '{}')").run(phone, name, city, clientStage?.id ?? null)
            .lastInsertRowid
        );
        res.contactsCreated++;
      }
      d.prepare('INSERT INTO sales (contact_id, sold_at, amount, product, external_id, data) VALUES (?,?,?,?,?,?)').run(
        contactId,
        soldAt,
        amount,
        String(it.product ?? '').trim().slice(0, 120),
        externalId,
        JSON.stringify(it.data && typeof it.data === 'object' ? it.data : {})
      );
      const tags = (Array.isArray(it.tags) ? it.tags : []).map(String).filter((t) => t.trim());
      if (tags.length) addTags([contactId], tags.map(ensureTag));
      res.created++;
    });
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return res;
}
