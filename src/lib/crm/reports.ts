import { getDb } from './db';

export type SalesReportFilter = { from?: string; to?: string; seller?: string; zone?: string };

type Line = { contactId: number; name: string; soldAt: string; amount: number; product: string; seller: string; zone: string; qty: number };
type Bucket = { amount: number; qty: number; sales: number; customers: Set<number> };

export type SalesReport = {
  filter: SalesReportFilter;
  totals: { amount: number; qty: number; sales: number; customers: number };
  byMonth: { month: string; amount: number; qty: number }[];
  bySeller: { name: string; amount: number; qty: number; customers: number }[];
  byZone: { name: string; amount: number; qty: number; customers: number }[];
  topProducts: { product: string; amount: number; qty: number; customers: number }[];
  /** Products bought together by the same customer in the same month (billing data is monthly). */
  combos: { a: string; b: string; times: number }[];
  /** Customers still buying from you who stopped taking a product they used to buy regularly. */
  droppedProducts: { customerId: number; customer: string; product: string; lastAt: string; times: number; amount: number }[];
  sellers: string[];
  zones: string[];
};

const bucket = (): Bucket => ({ amount: 0, qty: 0, sales: 0, customers: new Set() });
const add = (b: Bucket, l: Line) => {
  b.amount += l.amount;
  b.qty += l.qty;
  b.sales++;
  b.customers.add(l.contactId);
};
const ranked = (m: Map<string, Bucket>, limit = 50) =>
  [...m]
    .map(([name, b]) => ({ name, amount: b.amount, qty: b.qty, customers: b.customers.size }))
    .sort((x, y) => y.amount - x.amount)
    .slice(0, limit);

const RECENT_DAYS = 180;
const MAX_BASKET = 40;

export function salesReport(filter: SalesReportFilter = {}, now = new Date()): SalesReport {
  const rows = getDb()
    .prepare(
      `SELECT s.contact_id AS contactId, c.name AS name, s.sold_at AS soldAt, s.amount AS amount, s.product AS product,
              COALESCE(json_extract(s.data, '$.seller'), '') AS seller,
              COALESCE(json_extract(s.data, '$.zone'), '') AS zone,
              COALESCE(json_extract(s.data, '$.qty'), 0) AS qty
       FROM sales s JOIN contacts c ON c.id = s.contact_id
       WHERE (? = '' OR s.sold_at >= ?) AND (? = '' OR s.sold_at <= ?)`
    )
    .all(filter.from ?? '', filter.from ?? '', filter.to ?? '', filter.to ?? '') as unknown as Line[];

  // A sale carries its own seller and zone when the loader sent them; when it did not, the customer's
  // "Zona X" / "Vendedor Y" tags say the same thing. Names are compared in upper case so "Costa" and "COSTA" are one zone.
  const fromTags = new Map<number, { zone?: string; seller?: string }>();
  const tagRows = getDb()
    .prepare("SELECT ct.contact_id AS id, t.name AS name FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE t.name LIKE 'Zona %' OR t.name LIKE 'Vendedor %'")
    .all() as unknown as { id: number; name: string }[];
  for (const t of tagRows) {
    const e = fromTags.get(t.id) ?? {};
    if (/^zona /i.test(t.name)) e.zone ??= t.name.slice(5);
    else e.seller ??= t.name.slice(9);
    fromTags.set(t.id, e);
  }
  const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toUpperCase();

  const sellers = new Set<string>();
  const zones = new Set<string>();
  const lines: Line[] = [];
  for (const r of rows) {
    const tag = fromTags.get(r.contactId);
    const l = {
      ...r,
      qty: Number(r.qty) || 0,
      product: r.product.trim(),
      seller: norm(r.seller || tag?.seller || ''),
      zone: norm(r.zone || tag?.zone || '')
    };
    if (l.seller) sellers.add(l.seller);
    if (l.zone) zones.add(l.zone);
    if (filter.seller && l.seller !== norm(filter.seller)) continue;
    if (filter.zone && l.zone !== norm(filter.zone)) continue;
    lines.push(l);
  }

  const total = bucket();
  const month = new Map<string, Bucket>();
  const seller = new Map<string, Bucket>();
  const zone = new Map<string, Bucket>();
  const product = new Map<string, Bucket>();
  const basket = new Map<string, Set<string>>();
  const perCustomerProduct = new Map<string, { customerId: number; customer: string; product: string; lastAt: string; times: number; amount: number }>();
  const lastBought = new Map<number, string>();

  const get = (m: Map<string, Bucket>, k: string) => m.get(k) ?? m.set(k, bucket()).get(k)!;
  for (const l of lines) {
    add(total, l);
    add(get(month, l.soldAt.slice(0, 7)), l);
    add(get(seller, l.seller || 'Sin vendedor'), l);
    add(get(zone, l.zone || 'Sin zona'), l);
    if (l.product) add(get(product, l.product), l);
    // Returns and free items say nothing about what people buy together or stopped buying.
    if (l.product && l.amount > 0) {
      const bk = `${l.contactId}|${l.soldAt.slice(0, 7)}`;
      (basket.get(bk) ?? basket.set(bk, new Set()).get(bk)!).add(l.product);
      const pk = `${l.contactId}|${l.product}`;
      const cp = perCustomerProduct.get(pk) ?? { customerId: l.contactId, customer: l.name, product: l.product, lastAt: '', times: 0, amount: 0 };
      cp.times++;
      cp.amount += l.amount;
      if (l.soldAt > cp.lastAt) cp.lastAt = l.soldAt;
      perCustomerProduct.set(pk, cp);
    }
    if (l.amount > 0 && l.soldAt > (lastBought.get(l.contactId) ?? '')) lastBought.set(l.contactId, l.soldAt);
  }

  const pairs = new Map<string, number>();
  for (const items of basket.values()) {
    if (items.size < 2 || items.size > MAX_BASKET) continue;
    const list = [...items].sort();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const k = `${list[i]}\u0000${list[j]}`;
      pairs.set(k, (pairs.get(k) ?? 0) + 1);
    }
  }

  const cutoff = new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const oldest = new Date(now.getTime() - 730 * 86_400_000).toISOString().slice(0, 10);
  const dropped = [...perCustomerProduct.values()]
    .filter((p) => p.times >= 2 && p.lastAt < cutoff && p.lastAt >= oldest && (lastBought.get(p.customerId) ?? '') >= cutoff)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 30);

  return {
    filter,
    totals: { amount: total.amount, qty: total.qty, sales: total.sales, customers: total.customers.size },
    byMonth: [...month].map(([m, b]) => ({ month: m, amount: b.amount, qty: b.qty })).sort((a, b) => a.month.localeCompare(b.month)),
    bySeller: ranked(seller),
    byZone: ranked(zone),
    topProducts: [...product]
      .map(([p, b]) => ({ product: p, amount: b.amount, qty: b.qty, customers: b.customers.size }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 30),
    combos: [...pairs]
      .filter(([, n]) => n >= 3)
      .map(([k, times]) => ({ a: k.split('\u0000')[0], b: k.split('\u0000')[1], times }))
      .sort((a, b) => b.times - a.times)
      .slice(0, 15),
    droppedProducts: dropped,
    sellers: [...sellers].sort(),
    zones: [...zones].sort()
  };
}

/** Reads ?from=&to=&seller=&zone= (dates as YYYY-MM-DD) from a request URL. */
export function reportFilterFrom(url: string): SalesReportFilter {
  const p = new URL(url).searchParams;
  const date = (k: string) => {
    const v = p.get(k) ?? '';
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  };
  return { from: date('from'), to: date('to'), seller: p.get('seller') || undefined, zone: p.get('zone') || undefined };
}
