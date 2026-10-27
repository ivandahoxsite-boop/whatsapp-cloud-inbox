import { createHash } from 'node:crypto';
import { getDb } from './db';
import { isRealPhone } from './customers';
import { SOURCE, contactById, dropEmptyPlaceholders, ensurePlaceholder, placeholderFor } from './cartera-sheet';
import { slotMs } from './receivables';
import { dayProblem, todayCo } from './tasks-info';

/**
 * The CRM brings the sales straight from AnaliX (the billing analytics API), without OpenClaw. AnaliX only has monthly
 * totals per customer and product, and the customer comes by NAME (no NIT, no phone). So a sale goes to:
 *  1. the cartera sheet customer with exactly the same name (same billing system) and the WhatsApp contact the user
 *     linked to that NIT;
 *  2. else the WhatsApp contact the user linked to that name;
 *  3. else a customer without phone, listed for the user to link once.
 * Never by a look-alike name. Each month present in AnaliX replaces that month in the CRM entirely, so corrections
 * made in AnaliX reach the CRM.
 */

const SETTING_LAST = 'analix_last';
const SETTING_SLOT = 'analix_slot';
export const ANALIX_TIME = '23:00';
/** A month whose total falls below this share of what the CRM had is suspicious: an automatic load stops. */
const MIN_MONTH_SHARE = 0.5;

export const analixConfigured = () => !!(process.env.ANALIX_USER?.trim() && process.env.ANALIX_PASSWORD?.trim());
const apiUrl = () => process.env.ANALIX_URL?.trim() || 'https://analix.xsitegroup.com.co/api/proxy';
/** AnaliX only accepts this fixed timestamp (the date the system was created). */
const stamp = () => process.env.ANALIX_TIMESTAMP?.trim() || '1738622291798';
/** Sales before this month are not kept in the CRM (the user asked to start in 2024). */
const fromMonth = () => process.env.ANALIX_FROM?.trim() || '2024-01';

/** One call to the AnaliX API. The password travels in the query string (that is how AnaliX works): never log the URL. */
async function call(type: string): Promise<unknown> {
  const url = new URL(apiUrl());
  url.searchParams.set('type', type);
  const [user, pass] = [process.env.ANALIX_USER!.trim(), process.env.ANALIX_PASSWORD!.trim()];
  // How AnaliX wants the pair: ["user","pass"] (json) or [user,pass] (plain). setup-analix.sh finds out and saves it.
  url.searchParams.set('values', process.env.ANALIX_VALUES_STYLE === 'plain' ? `[${user},${pass}]` : JSON.stringify([user, pass]));
  url.searchParams.set('timestamp', stamp());
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(180_000) });
  } catch {
    throw new Error('No pude conectar con AnaliX (sin respuesta o demoró demasiado)');
  }
  if (!res.ok) throw new Error(`AnaliX respondió ${res.status}`);
  const body = await res.json().catch(() => undefined);
  if (body === undefined) throw new Error('AnaliX no respondió con datos');
  return body;
}

export type AnalixLine = { month: string; seller: string; zone: string; product: string; description: string; client: string; total: number; qty: number };

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const number = (v: unknown) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, '')));

/** The sales lines (monthly totals per customer and product) from a getAllData answer. */
export function parseAnalix(body: unknown): { lines: AnalixLine[]; skipped: number } {
  const b = body as { productsData?: unknown; data?: { productsData?: unknown } } | null;
  const rows = Array.isArray(b?.productsData) ? b!.productsData : Array.isArray(b?.data?.productsData) ? b!.data!.productsData : null;
  if (!rows) throw new Error('AnaliX no devolvió las ventas (productsData): ¿usuario o clave equivocados?');
  const lines: AnalixLine[] = [];
  let skipped = 0;
  for (const r of rows as Record<string, unknown>[]) {
    const year = number(r?.year);
    const month = number(r?.month);
    const total = number(r?.total);
    const client = text(r?.client);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isFinite(total) || !client) {
      skipped++;
      continue;
    }
    const qty = number(r?.qty);
    lines.push({
      month: `${year}-${String(month).padStart(2, '0')}`,
      seller: text(r.seller),
      zone: text(r.zone),
      product: text(r.product),
      description: text(r.description),
      client: client.slice(0, 120),
      total,
      qty: Number.isFinite(qty) ? qty : 0
    });
  }
  return { lines, skipped };
}

/** "Audio  Lujos Ñandú S.A.S." -> "AUDIO LUJOS NANDU S A S": only exact matches after this count as the same name. */
export const normalizeName = (n: string) =>
  n
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^0-9A-Z]+/g, ' ')
    .trim();

/** Billing name -> the cartera sheet's customer key (NIT/code), when exactly one sheet customer has that name. */
function carteraNames(): Map<string, string> {
  const rows = getDb()
    .prepare("SELECT DISTINCT json_extract(data, '$.nombre') AS n, json_extract(data, '$.cliente') AS k FROM receivables WHERE source = ? AND json_extract(data, '$.cliente') IS NOT NULL")
    .all(SOURCE) as { n: string | null; k: string }[];
  const keys = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.n) continue;
    const n = normalizeName(r.n);
    keys.set(n, (keys.get(n) ?? new Set()).add(r.k));
  }
  return new Map([...keys].filter(([, ks]) => ks.size === 1).map(([n, ks]) => [n, [...ks][0]]));
}

type Resolved = { key: string; contactId: number | null; placeholder: string; linked: boolean };

function resolver() {
  const d = getDb();
  const byName = carteraNames();
  const linkOf = d.prepare('SELECT contact_id, status FROM cartera_links WHERE cliente = ?');
  const byPhone = d.prepare('SELECT id FROM contacts WHERE phone = ?');
  const cache = new Map<string, Resolved>();
  return (client: string): Resolved => {
    const norm = normalizeName(client);
    const hit = cache.get(norm);
    if (hit) return hit;
    const key = byName.get(norm) ?? `NOM:${norm}`;
    const link = linkOf.get(key) as { contact_id: number; status: string } | undefined;
    const linked = link?.status === 'linked' && contactById(link.contact_id) ? link.contact_id : null;
    const placeholder = placeholderFor(key, client);
    const r: Resolved = linked
      ? { key, contactId: linked, placeholder, linked: true }
      : { key, contactId: (byPhone.get(placeholder) as { id: number } | undefined)?.id ?? null, placeholder, linked: false };
    cache.set(norm, r);
    return r;
  };
}

export type AnalixPlan = {
  months: number;
  firstMonth: string | null;
  lastMonth: string | null;
  lines: number;
  total: number;
  skipped: number;
  customers: number;
  unlinked: number;
  /** Months whose total changes, with before and after (the newest first). */
  changed: { month: string; before: number; after: number }[];
  blockers: string[];
};

const nextMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};

function currentByMonth(): Map<string, { lines: number; total: number }> {
  const rows = getDb()
    .prepare("SELECT substr(sold_at, 1, 7) AS m, COUNT(*) AS n, SUM(amount) AS t FROM sales WHERE external_id LIKE 'ANX-%' AND sold_at >= ? GROUP BY m")
    .all(`${fromMonth()}-01`) as { m: string; n: number; t: number }[];
  return new Map(rows.map((r) => [r.m, { lines: r.n, total: r.t }]));
}

export function planAnalix(parsed: { lines: AnalixLine[]; skipped: number }): AnalixPlan {
  const lines = parsed.lines.filter((l) => l.month >= fromMonth());
  const resolve = resolver();
  const byMonth = new Map<string, number>();
  const keys = new Map<string, boolean>();
  let total = 0;
  for (const l of lines) {
    total += l.total;
    byMonth.set(l.month, (byMonth.get(l.month) ?? 0) + l.total);
    const r = resolve(l.client);
    keys.set(r.key, r.linked);
  }
  const months = [...byMonth.keys()].sort();
  const before = currentByMonth();
  const changed = months
    .map((m) => ({ month: m, before: before.get(m)?.total ?? 0, after: byMonth.get(m)! }))
    .filter((c) => Math.abs(c.before - c.after) >= 1)
    .reverse();
  const blockers: string[] = [];
  if (!lines.length) blockers.push('AnaliX no trajo ventas');
  const thisMonth = todayCo().slice(0, 7);
  for (const c of changed) {
    if (c.month === thisMonth || c.before <= 0) continue;
    if (c.after < c.before * MIN_MONTH_SHARE) blockers.push(`El mes ${c.month} bajaría de ${Math.round(c.before)} a ${Math.round(c.after)} (más de la mitad)`);
  }
  return {
    months: months.length,
    firstMonth: months[0] ?? null,
    lastMonth: months[months.length - 1] ?? null,
    lines: lines.length,
    total,
    skipped: parsed.skipped,
    customers: keys.size,
    unlinked: [...keys.values()].filter((v) => !v).length,
    changed,
    blockers
  };
}

export type AnalixLast = { at: string; ok: boolean; trigger: 'auto' | 'manual'; error?: string; months?: number; lines?: number; total?: number; lastMonth?: string | null };

function saveLast(last: AnalixLast) {
  getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SETTING_LAST, JSON.stringify(last));
}

export function analixLast(): AnalixLast | null {
  const r = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_LAST) as { value: string } | undefined;
  try {
    return r ? (JSON.parse(r.value) as AnalixLast) : null;
  } catch {
    return null;
  }
}

/**
 * Remembers, as a suggestion for the user to confirm, the WhatsApp contact that holds a customer's AnaliX sales today
 * (how OpenClaw had them). Only when exactly one real contact holds them; never applied on its own.
 */
function rememberSuggestions(resolve: ReturnType<typeof resolver>, clients: string[]) {
  const d = getDb();
  const holders = new Map<string, Set<number>>();
  const rows = d
    .prepare("SELECT DISTINCT json_extract(s.data, '$.client') AS c, s.contact_id AS id, c.phone FROM sales s JOIN contacts c ON c.id = s.contact_id WHERE s.external_id LIKE 'ANX-%'")
    .all() as { c: string | null; id: number; phone: string }[];
  for (const r of rows) {
    if (!r.c || !isRealPhone(r.phone)) continue;
    const n = normalizeName(r.c);
    holders.set(n, (holders.get(n) ?? new Set()).add(r.id));
  }
  const add = d.prepare("INSERT OR IGNORE INTO cartera_links (cliente, contact_id, status) VALUES (?, ?, 'suggested')");
  for (const client of clients) {
    const r = resolve(client);
    if (r.linked) continue;
    const h = holders.get(normalizeName(client));
    if (h?.size === 1) add.run(r.key, [...h][0]);
  }
}

let running = false;

/** Brings the sales from AnaliX and replaces, month by month, what the CRM had. `force` skips the drop check. */
export async function syncAnalix(opts: { trigger: 'auto' | 'manual'; force?: boolean }): Promise<{ ok: boolean; plan?: AnalixPlan; error?: string }> {
  if (running) return { ok: false, error: 'Ya se están trayendo las ventas, espera un momento' };
  running = true;
  const at = new Date().toISOString();
  try {
    if (!analixConfigured()) throw new Error('AnaliX no está conectado (bash /opt/crm/deploy/setup-analix.sh)');
    const parsed = parseAnalix(await call('getAllData'));
    const plan = planAnalix(parsed);
    const blockers = opts.force ? plan.blockers.filter((b) => b.startsWith('AnaliX no trajo')) : plan.blockers;
    if (blockers.length) {
      const error = `No se cargó: ${blockers.join('. ')}`;
      saveLast({ at, ok: false, trigger: opts.trigger, error });
      return { ok: false, plan, error };
    }
    const lines = parsed.lines.filter((l) => l.month >= fromMonth());
    const resolve = resolver();
    rememberSuggestions(resolve, [...new Set(lines.map((l) => l.client))]);

    const d = getDb();
    const stage = d.prepare("SELECT id FROM stages WHERE name = 'Cliente'").get() as { id: number } | undefined;
    const contactOf = new Map<string, number>();
    const contactFor = (client: string) => {
      const r = resolve(client);
      let id = contactOf.get(r.key);
      if (id === undefined) {
        id = r.contactId ?? ensurePlaceholder(r.placeholder, { cliente: r.key.startsWith('NOM:') ? '' : r.key, name: client });
        contactOf.set(r.key, id);
      }
      return { id, key: r.key };
    };
    const months = [...new Set(lines.map((l) => l.month))];
    const used = new Set<string>();
    d.exec('BEGIN');
    try {
      const del = d.prepare("DELETE FROM sales WHERE external_id LIKE 'ANX-%' AND sold_at >= ? AND sold_at < ?");
      for (const m of months) del.run(`${m}-01`, `${nextMonth(m)}-01`);
      const ins = d.prepare('INSERT INTO sales (contact_id, sold_at, amount, product, external_id, data) VALUES (?,?,?,?,?,?)');
      for (const l of lines) {
        const c = contactFor(l.client);
        const base = `ANX-${l.month}-${createHash('sha1').update([l.client, l.product, l.description, l.zone, l.seller].join('|')).digest('hex').slice(0, 12)}`;
        let id = base;
        for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
        used.add(id);
        ins.run(
          c.id,
          `${l.month}-01`,
          l.total,
          (l.description || l.product).slice(0, 120),
          id,
          JSON.stringify({ seller: l.seller, zone: l.zone, qty: l.qty, client: l.client, clientKey: c.key, code: l.product })
        );
      }
      // Someone who buys is a customer, whatever stage the chat left them in.
      if (stage)
        for (const id of new Set(contactOf.values()))
          d.prepare("UPDATE contacts SET stage_id = ? WHERE id = ? AND (stage_id IS NULL OR stage_id IN (SELECT id FROM stages WHERE name = 'Nuevo'))").run(stage.id, id);
      d.exec('COMMIT');
    } catch (e) {
      d.exec('ROLLBACK');
      throw e;
    }
    dropEmptyPlaceholders();
    saveLast({ at, ok: true, trigger: opts.trigger, months: plan.months, lines: plan.lines, total: plan.total, lastMonth: plan.lastMonth });
    return { ok: true, plan };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Error trayendo las ventas';
    saveLast({ at, ok: false, trigger: opts.trigger, error });
    return { ok: false, error };
  } finally {
    running = false;
  }
}

export type SalesClient = {
  key: string;
  name: string;
  contactId: number;
  balance: number;
  invoices: number;
  linked: { id: number; name: string; phone: string } | null;
  suggestion: { id: number; name: string; phone: string } | null;
};

/** AnaliX customers whose sales still sit on a customer without WhatsApp, the biggest buyers (last 12 months) first. */
export function analixUnlinked(): SalesClient[] {
  const today = todayCo();
  const since = `${Number(today.slice(0, 4)) - 1}${today.slice(4, 7)}-01`;
  const rows = getDb()
    .prepare(
      `SELECT json_extract(s.data, '$.clientKey') AS key, MAX(json_extract(s.data, '$.client')) AS name, MAX(s.contact_id) AS contact_id,
              SUM(CASE WHEN s.sold_at >= ? THEN s.amount ELSE 0 END) AS recent, COUNT(*) AS lines, l.status, l.contact_id AS link_id
       FROM sales s JOIN contacts c ON c.id = s.contact_id LEFT JOIN cartera_links l ON l.cliente = json_extract(s.data, '$.clientKey')
       WHERE s.external_id LIKE 'ANX-%' AND json_extract(s.data, '$.clientKey') IS NOT NULL AND c.phone NOT GLOB '[0-9]*'
       GROUP BY key ORDER BY recent DESC, lines DESC LIMIT 300`
    )
    .all(since) as { key: string; name: string; contact_id: number; recent: number; lines: number; status: string | null; link_id: number | null }[];
  return rows.map((r) => ({
    key: r.key,
    name: r.name || r.key.replace(/^NOM:/, ''),
    contactId: r.contact_id,
    balance: r.recent,
    invoices: r.lines,
    linked: null,
    suggestion: r.status === 'suggested' && r.link_id ? contactById(r.link_id) ?? null : null
  }));
}

/** While AnaliX is connected, OpenClaw must not load AnaliX sales too (it would tie them by its own guesses). */
export function analixGuard(sales: { externalId?: unknown }[]): string | null {
  if (!analixConfigured() || !sales.some((s) => String(s?.externalId ?? '').toUpperCase().startsWith('ANX'))) return null;
  return 'Las ventas de AnaliX ahora las trae el CRM directo. No las cargues: no hace falta.';
}

let started = false;

/** Brings the sales by itself Monday to Saturday at 23:00 (not on Colombian holidays), once per day. */
export function startAnalixSchedule() {
  if (started) return;
  started = true;
  const tick = async () => {
    if (!analixConfigured()) return;
    const now = Date.now();
    const day = todayCo(now);
    if (dayProblem(day)) return;
    const at = slotMs(day, ANALIX_TIME);
    if (now < at || now - at > 2 * 3_600_000) return;
    const d = getDb();
    const done = d.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_SLOT) as { value: string } | undefined;
    if (done?.value === day) return;
    d.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SETTING_SLOT, day);
    const r = await syncAnalix({ trigger: 'auto' });
    console.log(`[ANALIX] carga ${day}: ${r.ok ? 'ok' : r.error}`);
  };
  const timer = setInterval(() => void tick().catch((e) => console.error('[ANALIX]', e instanceof Error ? e.message : 'error')), 60_000);
  timer.unref?.();
}
