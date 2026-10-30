import { getDb } from './db';
import { createCustomer, isRealPhone, normalizeNit, normalizePhone, parseAmount, parseDate, placeholderKey } from './customers';
import { LOAD_TIMES, carteraSheetConfigured, slotMs, upsertReceivables } from './receivables';
import { dayProblem, todayCo } from './tasks-info';

/**
 * The CRM reads the aging report straight from the Google Sheet tab "Cartera por vendedor" (through a small Apps
 * Script published by the user, see deploy/cartera-apps-script.gs). Invoices are tied to a customer ONLY by the sheet's
 * "Cliente" (NIT or code): to a WhatsApp contact the user linked, otherwise to a customer without phone. Never by a
 * look-alike name or a guessed phone; a guess is only shown as a suggestion for the user to accept.
 */

export const SOURCE = 'cartera';
const SETTING_LAST = 'cartera_sheet_last';
const SETTING_SLOT = 'cartera_sheet_slot';
export const CREDITS_SETTING = 'cartera_credit_notes';
const MAX_CLOSED_SHARE = 0.15;
/**
 * The second tab, "Cartera Cali" (user's request, 30-oct-2026): read in the same call but kept APART, never mixed with
 * the main cartera ("NO JUNTA"). It is stored as it comes in `settings.cartera_cali` and shown in its own CRM tab.
 * "CALI-<doc>" receivables are leftovers of the first version that mixed them, removed on the next load.
 */
export const CALI_TAB = 'Cartera Cali';
export const CALI_PREFIX = 'CALI-';
export const CALI_SETTING = 'cartera_cali';
export type CaliStore = { at: string; corte: string | null; invoices: SheetInvoice[]; credits: CreditNote[]; error?: string };

export type SheetInvoice = {
  /** The receivable's id in the CRM: the document number. */
  externalId: string;
  cliente: string;
  key: string;
  name: string;
  tipo: string;
  doc: string;
  issuedAt: string;
  dueAt: string;
  amount: number;
  balance: number;
  seller: string;
};

/** A credit note of the sheet: never applied to the debt in the CRM, only shown in the "Extracto" view. */
export type CreditNote = { cliente: string; key: string; name: string; doc: string; issuedAt: string | null; dueAt: string | null; amount: number; seller: string };

export type ParsedSheet = {
  invoices: SheetInvoice[];
  creditNotes: number;
  credits: CreditNote[];
  corte: string | null;
  problems: string[];
  /** The "Cartera Cali" tab read apart (null when it did not come: an old Apps Script only sends the main tab). */
  caliSheet?: ParsedSheet | null;
  /** Why the Cali tab could not be read this time (its last good copy stays; the main tab loads anyway). */
  caliError?: string;
};

/** "900123456-7" -> "9001234567", "c133" -> "C133": letters and digits only. */
export const clienteKey = (raw: string) =>
  raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^0-9A-Z]/g, '');

const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown) => (typeof v === 'number' ? v : parseAmount(cell(v)));

/** Reads the tab's values (first rows: the filters, then the titles Cliente, Nombre_Cliente, T_Dcto, Documento...). */
export function parseCarteraSheet(rows: unknown[][]): ParsedSheet {
  const h = rows.findIndex((r) => Array.isArray(r) && r.some((c) => cell(c) === 'Documento') && r.some((c) => cell(c) === 'Cliente'));
  if (h < 0) throw new Error('No encuentro los títulos de la cartera (Cliente, Documento…) en la pestaña');
  const titles = rows[h].map((c) => cell(c).toLowerCase());
  const col = (name: string) => titles.indexOf(name.toLowerCase());
  const need = ['Cliente', 'Nombre_Cliente', 'T_Dcto', 'Documento', 'F_Expedic', 'F_Vencim', 'Deuda', 'Saldo'];
  const missing = need.filter((n) => col(n) < 0);
  if (missing.length) throw new Error(`Faltan columnas en la pestaña: ${missing.join(', ')}`);
  const [iCli, iName, iTipo, iDoc, iExp, iVen, iDeuda, iSaldo] = need.map(col);
  const iSeller = col('Nombre_Vendedor');

  // Header area: "Fecha final" (the cut-off date of the report) and "Vendedor", each followed by its value.
  const after = (label: string) => {
    for (const r of rows.slice(0, h)) {
      const i = (r ?? []).findIndex((c) => cell(c).toLowerCase() === label);
      if (i >= 0) return cell(r[i + 1]);
    }
    return '';
  };
  const corte = parseDate(after('fecha final'));
  const sellerAll = after('vendedor');

  const invoices: SheetInvoice[] = [];
  const problems: string[] = [];
  const docs = new Set<string>();
  let creditNotes = 0;
  const credits: CreditNote[] = [];
  rows.slice(h + 1).forEach((r, i) => {
    const line = h + i + 2;
    const doc = cell(r?.[iDoc]);
    if (!doc) return;
    const tipo = cell(r[iTipo]).toUpperCase();
    const balance = num(r[iSaldo]);
    // Credit notes are crossed by hand by the user: they never reach the CRM.
    const cliente = cell(r[iCli]);
    if (tipo.startsWith('N') || balance < 0) {
      creditNotes++;
      credits.push({
        cliente,
        key: clienteKey(cliente),
        name: cell(r[iName]).slice(0, 80),
        doc: doc.slice(0, 60),
        issuedAt: parseDate(cell(r[iExp])),
        dueAt: parseDate(cell(r[iVen])),
        amount: Number.isFinite(balance) ? balance : num(r[iDeuda]),
        seller: (iSeller >= 0 ? cell(r[iSeller]) : '') || sellerAll
      });
      return;
    }
    const key = clienteKey(cliente);
    const issuedAt = parseDate(cell(r[iExp]));
    const dueAt = parseDate(cell(r[iVen]));
    if (!key) return void problems.push(`Fila ${line} (factura ${doc}): no tiene Cliente`);
    if (!issuedAt || !dueAt) return void problems.push(`Fila ${line} (factura ${doc}): fecha de expedición o vencimiento inválida`);
    if (!Number.isFinite(balance)) return void problems.push(`Fila ${line} (factura ${doc}): saldo inválido`);
    if (docs.has(doc)) return void problems.push(`Fila ${line}: la factura ${doc} está repetida`);
    docs.add(doc);
    const amount = num(r[iDeuda]);
    invoices.push({
      externalId: doc.slice(0, 60),
      cliente,
      key,
      name: cell(r[iName]).slice(0, 80),
      tipo,
      doc: doc.slice(0, 60),
      issuedAt,
      dueAt,
      amount: Number.isFinite(amount) ? amount : balance,
      balance,
      seller: (iSeller >= 0 ? cell(r[iSeller]) : '') || sellerAll
    });
  });
  return { invoices, creditNotes, credits, corte, problems };
}

export type SheetTabs = { main: unknown[][]; cali: unknown[][] | null };

/** Downloads the tabs through the Apps Script web app. The key keeps anyone else with the link out. */
export async function fetchCarteraSheet(): Promise<SheetTabs> {
  if (!carteraSheetConfigured()) throw new Error('La hoja de cartera no está conectada (bash /opt/crm/deploy/setup-cartera-hoja.sh)');
  const url = new URL(process.env.CARTERA_SHEET_URL!);
  url.searchParams.set('k', process.env.CARTERA_SHEET_KEY!);
  const res = await fetch(url, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Google respondió ${res.status} al leer la hoja`);
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; filas?: unknown[][]; pestanas?: Record<string, unknown[][]> } | null;
  if (!body) throw new Error('Google no devolvió la cartera: revisa que el Apps Script esté implementado con acceso "Cualquier persona"');
  if (body.error) throw new Error(body.error === 'clave' ? 'La clave del Apps Script no coincide con la del CRM' : `Apps Script: ${body.error}`);
  if (!Array.isArray(body.filas)) throw new Error('El Apps Script no devolvió filas');
  const cali = body.pestanas?.[CALI_TAB];
  return { main: body.filas, cali: Array.isArray(cali) ? cali : null };
}

/**
 * The main tab, with the Cali tab read apart. The main tab never depends on Cali: if the Cali tab is missing,
 * unreadable or has incomplete rows, only Cali is left as it was and the main tab loads as always.
 */
export function parseCarteraTabs(tabs: SheetTabs): ParsedSheet {
  const main = parseCarteraSheet(tabs.main);
  if (!tabs.cali) return { ...main, caliSheet: null };
  try {
    const cali = parseCarteraSheet(tabs.cali);
    if (cali.problems.length) return { ...main, caliSheet: null, caliError: `${cali.problems.length} fila(s) con datos incompletos (${cali.problems.slice(0, 3).join('; ')})` };
    return { ...main, caliSheet: cali };
  } catch (e) {
    return { ...main, caliSheet: null, caliError: e instanceof Error ? e.message : 'no se pudo leer' };
  }
}

/** The last good copy of the "Cartera Cali" tab (null if it never came). */
export function caliStore(): CaliStore | null {
  const r = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(CALI_SETTING) as { value: string } | undefined;
  try {
    return r ? (JSON.parse(r.value) as CaliStore) : null;
  } catch {
    return null;
  }
}

type Contact = { id: number; name: string; phone: string };
export const contactById = (id: number) => getDb().prepare('SELECT id, name, phone FROM contacts WHERE id = ?').get(id) as Contact | undefined;
const contactByPhone = (phone: string) => getDb().prepare('SELECT id, name, phone FROM contacts WHERE phone = ?').get(phone) as Contact | undefined;
const linkOf = (key: string) =>
  getDb().prepare('SELECT contact_id, status FROM cartera_links WHERE cliente = ?').get(key) as { contact_id: number; status: string } | undefined;

/**
 * Key of a billing customer in `cartera_links`: the sheet's NIT/code (letters and digits), or "NOM:<NAME>" for a
 * customer known only by name (AnaliX sales bring no NIT).
 */
export const linkKey = (key: string) => (key.startsWith('NOM:') ? key.trim() : clienteKey(key));

/** The phone-less customer that holds a billing customer's invoices and sales until the user links it. */
export const placeholderFor = (key: string, name: string) =>
  (key.startsWith('NOM:') ? placeholderKey(undefined, name || key.slice(4)) : placeholderKey(key, name)) ?? `nit:${key}`;

/** Where this sheet customer's invoices go: the WhatsApp contact the user linked, else its customer without phone. */
export function target(inv: Pick<SheetInvoice, 'key' | 'cliente' | 'name'>): { contact: Contact | null; placeholder: string; linked: boolean } {
  const placeholder = placeholderKey(inv.cliente, inv.name) ?? `nit:${inv.key}`;
  const link = linkOf(inv.key);
  const linked = link?.status === 'linked' ? contactById(link.contact_id) : undefined;
  if (linked) return { contact: linked, placeholder, linked: true };
  return { contact: contactByPhone(placeholder) ?? null, placeholder, linked: false };
}

export type CarteraPlan = {
  corte: string | null;
  invoices: number;
  total: number;
  creditNotes: number;
  customers: number;
  /** Customers of the sheet with no WhatsApp contact linked yet. */
  unlinked: number;
  created: number;
  updated: number;
  closed: number;
  closedAmount: number;
  /** Invoices that today sit on another customer in the CRM and will move. */
  moves: { doc: string; balance: number; sheetName: string; from: string; to: string }[];
  problems: string[];
  /** Why an automatic load would not go ahead (empty when it can). */
  blockers: string[];
  /** Invoices and money of the "Cartera Cali" tab (kept apart, in its own tab), or null when it did not come. */
  cali: { invoices: number; total: number } | null;
  /** Why the Cali tab could not be read this time (its last copy stays). */
  caliError?: string;
  /** Cali invoices that the first version had mixed into the main cartera, taken out on this load. */
  caliMixed: number;
};

const who = (c: Contact | null | undefined, fallback: string) =>
  c ? `${c.name || fallback}${isRealPhone(c.phone) ? ` (${c.phone})` : ' (sin WhatsApp)'}` : `${fallback} (sin WhatsApp, nuevo)`;

/** What loading this sheet would change, without changing anything. */
export function planCartera(sheet: ParsedSheet): CarteraPlan {
  const d = getDb();
  const current = new Map(
    (d.prepare('SELECT external_id, contact_id, status, source FROM receivables').all() as { external_id: string; contact_id: number; status: string; source: string }[]).map((r) => [
      r.external_id,
      r
    ])
  );
  const open = d.prepare("SELECT external_id, balance FROM receivables WHERE status = 'open' AND source = ?").all(SOURCE) as { external_id: string; balance: number }[];
  const inSheet = new Set(sheet.invoices.map((i) => i.externalId));
  const plan: CarteraPlan = {
    corte: sheet.corte, invoices: sheet.invoices.length, total: 0, creditNotes: sheet.creditNotes, customers: 0, unlinked: 0,
    created: 0, updated: 0, closed: 0, closedAmount: 0, moves: [], problems: sheet.problems, blockers: [],
    cali: sheet.caliSheet ? { invoices: sheet.caliSheet.invoices.length, total: sheet.caliSheet.invoices.reduce((a, i) => a + i.balance, 0) } : null,
    caliError: sheet.caliError,
    caliMixed: open.filter((r) => r.external_id.startsWith(CALI_PREFIX)).length
  };
  const targets = new Map<string, ReturnType<typeof target>>();
  for (const inv of sheet.invoices) {
    plan.total += inv.balance;
    let t = targets.get(inv.key);
    if (!t) {
      t = target(inv);
      targets.set(inv.key, t);
      if (!t.linked) plan.unlinked++;
    }
    const was = current.get(inv.externalId);
    if (!was) {
      plan.created++;
      continue;
    }
    plan.updated++;
    if (was.status === 'open' && was.contact_id !== t.contact?.id) {
      plan.moves.push({ doc: inv.doc, balance: inv.balance, sheetName: inv.name, from: who(contactById(was.contact_id), '?'), to: who(t.contact, inv.name) });
    }
  }
  plan.customers = targets.size;
  for (const r of open) {
    // Mixed-in Cali invoices are taken out (not paid): counted apart in `caliMixed`.
    if (inSheet.has(r.external_id) || r.external_id.startsWith(CALI_PREFIX)) continue;
    plan.closed++;
    plan.closedAmount += r.balance;
  }
  if (plan.problems.length) plan.blockers.push(`La hoja tiene ${plan.problems.length} fila(s) con datos incompletos (${plan.problems.slice(0, 3).join('; ')})`);
  if (!plan.invoices) plan.blockers.push('La hoja no trae facturas');
  if (open.length && plan.closed > open.length * MAX_CLOSED_SHARE)
    plan.blockers.push(`Se darían por pagadas ${plan.closed} de ${open.length} facturas abiertas (más del ${MAX_CLOSED_SHARE * 100} %)`);
  return plan;
}

export type CarteraLast = {
  at: string;
  ok: boolean;
  trigger: 'auto' | 'manual';
  error?: string;
  corte?: string | null;
  invoices?: number;
  total?: number;
  created?: number;
  updated?: number;
  closed?: number;
  moved?: number;
  /** The Cali tab was left out of a load that otherwise went fine. */
  caliError?: string;
};

function saveLast(last: CarteraLast) {
  getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SETTING_LAST, JSON.stringify(last));
}

export function carteraLast(): CarteraLast | null {
  const r = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_LAST) as { value: string } | undefined;
  try {
    return r ? (JSON.parse(r.value) as CarteraLast) : null;
  } catch {
    return null;
  }
}

/** A customer without phone for this sheet customer (reuses the one OpenClaw may have created). */
export function ensurePlaceholder(placeholder: string, inv: Pick<SheetInvoice, 'cliente' | 'name'>): number {
  const found = contactByPhone(placeholder);
  if (found) return found.id;
  const d = getDb();
  const stage = d.prepare("SELECT id FROM stages WHERE name = 'Cliente'").get() as { id: number } | undefined;
  const nit = normalizeNit(inv.cliente);
  return Number(
    d.prepare('INSERT INTO contacts (phone, name, city, stage_id, data) VALUES (?,?,?,?,?)').run(placeholder, inv.name, '', stage?.id ?? null, JSON.stringify(nit ? { nit } : {}))
      .lastInsertRowid
  );
}

/**
 * Remembers a guess for the user to confirm: the WhatsApp contact that holds this customer's invoices today (how
 * OpenClaw had them), else one that stored the same NIT. Never applied on its own.
 */
function rememberSuggestion(inv: SheetInvoice) {
  if (linkOf(inv.key)) return;
  const d = getDb();
  const holder = d
    .prepare("SELECT c.id, c.phone FROM receivables r JOIN contacts c ON c.id = r.contact_id WHERE r.external_id = ? AND r.source = ?")
    .get(inv.externalId, SOURCE) as { id: number; phone: string } | undefined;
  const nit = normalizeNit(inv.cliente);
  const byNit = nit
    ? (d.prepare("SELECT id, phone FROM contacts WHERE json_extract(data, '$.nit') = ? AND phone GLOB '[0-9]*' ORDER BY id LIMIT 1").get(nit) as { id: number; phone: string } | undefined)
    : undefined;
  const guess = [holder, byNit].find((c) => c && isRealPhone(c.phone));
  if (guess) d.prepare("INSERT OR IGNORE INTO cartera_links (cliente, contact_id, status) VALUES (?, ?, 'suggested')").run(inv.key, guess.id);
}

/** Cali goes apart and on its own: its copy is replaced whenever it reads fine, whatever happens with the main tab. */
function saveCali(sheet: ParsedSheet, at: string) {
  const d = getDb();
  if (sheet.caliSheet) {
    const store: CaliStore = { at, corte: sheet.caliSheet.corte, invoices: sheet.caliSheet.invoices, credits: sheet.caliSheet.credits };
    d.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(CALI_SETTING, JSON.stringify(store));
  } else if (sheet.caliError) {
    const old = caliStore();
    if (old) d.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(CALI_SETTING, JSON.stringify({ ...old, error: sheet.caliError }));
  }
}

let running: Promise<unknown> | null = null;

/**
 * Reads the sheet and loads it as the complete aging report. `force` skips the safety checks (the user looked at the
 * preview and confirmed); automatic loads never force.
 */
export async function syncCarteraSheet(opts: { trigger: 'auto' | 'manual'; force?: boolean }): Promise<{ ok: boolean; plan?: CarteraPlan; error?: string }> {
  if (running) return { ok: false, error: 'Ya se está trayendo la cartera, espera un momento' };
  const job = (async () => {
    const at = new Date().toISOString();
    try {
      const sheet = parseCarteraTabs(await fetchCarteraSheet());
      const plan = planCartera(sheet);
      saveCali(sheet, at);
      // Incomplete rows or an empty sheet always stop the load: a missing invoice would be taken as paid.
      const blockers = opts.force ? plan.blockers.filter((b) => !b.startsWith('Se darían por pagadas')) : plan.blockers;
      if (blockers.length) {
        const error = `No se cargó: ${blockers.join('. ')}`;
        saveLast({ at, ok: false, trigger: opts.trigger, error, corte: plan.corte, invoices: plan.invoices });
        return { ok: false, plan, error };
      }
      // The leftovers of the first version, which mixed Cali into this cartera, go away (Cali lives in its own tab).
      const d = getDb();
      d.prepare('DELETE FROM receivables WHERE source = ? AND external_id LIKE ?').run(SOURCE, `${CALI_PREFIX}%`);
      const contactOf = new Map<string, number>();
      for (const inv of sheet.invoices) {
        if (contactOf.has(inv.key)) continue;
        rememberSuggestion(inv);
        const t = target(inv);
        contactOf.set(inv.key, t.contact?.id ?? ensurePlaceholder(t.placeholder, inv));
      }
      const res = upsertReceivables(
        sheet.invoices.map((inv) => ({
          externalId: inv.externalId,
          doc: inv.doc,
          contactId: contactOf.get(inv.key)!,
          name: inv.name,
          amount: inv.amount,
          balance: inv.balance,
          issuedAt: inv.issuedAt,
          dueAt: inv.dueAt,
          seller: inv.seller,
          data: { cliente: inv.key, clienteRaw: inv.cliente, nombre: inv.name, tipo: inv.tipo }
        })),
        { closeMissing: true, source: SOURCE }
      );
      dropEmptyPlaceholders();
      // The sheet's credit notes, replaced on every load: the "Extracto" view shows them like the Excel report.
      getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(CREDITS_SETTING, JSON.stringify(sheet.credits));
      saveLast({
        at, ok: true, trigger: opts.trigger, corte: plan.corte, invoices: plan.invoices, total: plan.total,
        created: res.created, updated: res.updated, closed: res.closed, moved: plan.moves.length, ...(plan.caliError ? { caliError: plan.caliError } : {})
      });
      return { ok: true, plan };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Error leyendo la hoja';
      saveLast({ at, ok: false, trigger: opts.trigger, error });
      return { ok: false, error };
    }
  })();
  running = job;
  try {
    return await job;
  } finally {
    running = null;
  }
}

/** Preview of a load, for the user to confirm. */
export async function previewCarteraSheet(): Promise<CarteraPlan> {
  return planCartera(parseCarteraTabs(await fetchCarteraSheet()));
}

/** Customers without phone left with nothing on them (their invoices moved to the real contact) are removed. */
export function dropEmptyPlaceholders() {
  getDb()
    .prepare(
      `DELETE FROM contacts WHERE (phone LIKE 'nit:%' OR phone LIKE 'nom:%')
         AND NOT EXISTS (SELECT 1 FROM receivables WHERE contact_id = contacts.id)
         AND NOT EXISTS (SELECT 1 FROM sales WHERE contact_id = contacts.id)
         AND NOT EXISTS (SELECT 1 FROM activities WHERE contact_id = contacts.id)
         AND NOT EXISTS (SELECT 1 FROM outbox WHERE contact_id = contacts.id)
         AND NOT EXISTS (SELECT 1 FROM tasks WHERE contact_id = contacts.id)
         AND NOT EXISTS (SELECT 1 FROM call_requests WHERE contact_id = contacts.id)
         AND NOT EXISTS (SELECT 1 FROM campaign_items WHERE contact_id = contacts.id)
         AND NOT EXISTS (SELECT 1 FROM cartera_links WHERE contact_id = contacts.id)`
    )
    .run();
}

export type CarteraClient = {
  key: string;
  name: string;
  contactId: number;
  balance: number;
  invoices: number;
  linked: { id: number; name: string; phone: string } | null;
  suggestion: { id: number; name: string; phone: string } | null;
};

/** The sheet's customers with open invoices, and which WhatsApp contact each one is (or might be). */
export function carteraClients(): CarteraClient[] {
  const rows = getDb()
    .prepare(
      `SELECT json_extract(r.data, '$.cliente') AS key, MAX(json_extract(r.data, '$.nombre')) AS name, MAX(r.contact_id) AS contact_id,
              SUM(r.balance) AS balance, COUNT(*) AS invoices, l.status, l.contact_id AS link_id
       FROM receivables r LEFT JOIN cartera_links l ON l.cliente = json_extract(r.data, '$.cliente')
       WHERE r.status = 'open' AND r.source = ? AND json_extract(r.data, '$.cliente') IS NOT NULL
       GROUP BY key ORDER BY balance DESC`
    )
    .all(SOURCE) as { key: string; name: string; contact_id: number; balance: number; invoices: number; status: string | null; link_id: number | null }[];
  return rows.map((r) => {
    const c = r.link_id ? contactById(r.link_id) ?? null : null;
    return {
      key: r.key,
      name: r.name || r.key,
      contactId: r.contact_id,
      balance: r.balance,
      invoices: r.invoices,
      linked: r.status === 'linked' ? c : null,
      suggestion: r.status === 'suggested' ? c : null
    };
  });
}

/** The billing name of a customer key: from the sheet's invoices, else from the AnaliX sales. */
function sheetName(key: string): string {
  const d = getDb();
  const r = d
    .prepare("SELECT json_extract(data, '$.nombre') AS n FROM receivables WHERE source = ? AND json_extract(data, '$.cliente') = ? ORDER BY id DESC LIMIT 1")
    .get(SOURCE, key) as { n: string | null } | undefined;
  if (r?.n) return r.n;
  const s = d.prepare("SELECT json_extract(data, '$.client') AS n FROM sales WHERE json_extract(data, '$.clientKey') = ? LIMIT 1").get(key) as { n: string | null } | undefined;
  return s?.n ?? '';
}

/** The user says which WhatsApp contact a sheet customer is: by contact id or by phone (creating the contact if needed). */
export function linkCarteraClient(key: string, to: { contactId?: number; phone?: string }): Contact {
  const k = linkKey(key);
  if (!k) throw new Error('Falta el cliente de la hoja');
  let contact: Contact | undefined;
  if (to.contactId) contact = contactById(Number(to.contactId));
  else if (to.phone) {
    const phone = normalizePhone(String(to.phone));
    if (!isRealPhone(phone) || phone.length < 10) throw new Error('Escribe el celular completo (ej: 3001234567)');
    contact = contactByPhone(phone) ?? contactById(createCustomer({ phone, name: sheetName(k) }));
  }
  if (!contact) throw new Error('No encuentro ese contacto');
  if (!isRealPhone(contact.phone)) throw new Error('Ese contacto no tiene WhatsApp');
  const d = getDb();
  d.exec('BEGIN');
  try {
    d.prepare("INSERT OR REPLACE INTO cartera_links (cliente, contact_id, status, updated_at) VALUES (?, ?, 'linked', datetime('now'))").run(k, contact.id);
    d.prepare("UPDATE receivables SET contact_id = ?, updated_at = datetime('now') WHERE source = ? AND json_extract(data, '$.cliente') = ?").run(contact.id, SOURCE, k);
    d.prepare("UPDATE sales SET contact_id = ? WHERE json_extract(data, '$.clientKey') = ?").run(contact.id, k);
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  dropEmptyPlaceholders();
  return contact;
}

/** "No es ese": the suggestion goes away and is not offered again. */
export function rejectCarteraSuggestion(key: string) {
  getDb().prepare("UPDATE cartera_links SET status = 'rejected', updated_at = datetime('now') WHERE cliente = ? AND status = 'suggested'").run(linkKey(key));
}

/** Undoes a link: the invoices go back to a customer without phone until the user links the right one. */
export function unlinkCarteraClient(key: string) {
  const k = linkKey(key);
  const d = getDb();
  d.prepare("UPDATE cartera_links SET status = 'rejected', updated_at = datetime('now') WHERE cliente = ?").run(k);
  const name = sheetName(k);
  const id = ensurePlaceholder(placeholderFor(k, name), { cliente: k.startsWith('NOM:') ? '' : k, name });
  d.prepare("UPDATE receivables SET contact_id = ?, updated_at = datetime('now') WHERE source = ? AND json_extract(data, '$.cliente') = ?").run(id, SOURCE, k);
  d.prepare("UPDATE sales SET contact_id = ? WHERE json_extract(data, '$.clientKey') = ?").run(id, k);
  dropEmptyPlaceholders();
}

/**
 * WhatsApp contacts whose name has every word typed (in any order), or whose phone has the digits typed. The ones
 * that wrote most recently come first: they are the likeliest to be the customer.
 */
export function searchContacts(q: string): (Contact & { city: string; lastChat: string | null })[] {
  const s = q.trim();
  if (s.length < 2) return [];
  const digits = s.replace(/\D/g, '');
  const words = s.split(/\s+/).filter((w) => w.length >= 2 && !/^\d+$/.test(w)).slice(0, 4);
  const byName = words.length ? words.map(() => 'c.name LIKE ?').join(' AND ') : '0';
  const byPhone = digits.length >= 4 ? 'OR c.phone LIKE ?' : '';
  return getDb()
    .prepare(
      `SELECT c.id, c.name, c.phone, COALESCE(c.city, '') AS city,
              (SELECT MAX(a.created_at) FROM activities a WHERE a.contact_id = c.id AND a.kind IN ('whatsapp_in', 'whatsapp_out')) AS lastChat
       FROM contacts c WHERE c.phone GLOB '[0-9]*' AND ((${byName}) ${byPhone})
       ORDER BY lastChat IS NULL, lastChat DESC, c.name LIMIT 10`
    )
    .all(...words.map((w) => `%${w}%`), ...(digits.length >= 4 ? [`%${digits}%`] : [])) as (Contact & { city: string; lastChat: string | null })[];
}

/** While the sheet is connected, OpenClaw must not load the cartera too (it would tie invoices by its own guesses). */
export function carteraSheetGuard(source: unknown): string | null {
  if (!carteraSheetConfigured() || String(source ?? '') !== SOURCE) return null;
  return 'La cartera ahora la lee el CRM directo de la hoja "Cartera por vendedor". No la cargues: no hace falta.';
}

let started = false;

/** Loads the sheet by itself Monday to Saturday at the load times (not on Colombian holidays), once per slot. */
export function startCarteraSchedule() {
  if (started) return;
  started = true;
  const tick = async () => {
    if (!carteraSheetConfigured()) return;
    const now = Date.now();
    const day = todayCo(now);
    if (dayProblem(day)) return;
    // The latest slot that has passed, within the last 2 hours (a restart later on does not load an old slot).
    const t = [...LOAD_TIMES].reverse().find((x) => slotMs(day, x) <= now && now - slotMs(day, x) < 2 * 3_600_000);
    if (!t) return;
    const slot = `${day} ${t}`;
    const d = getDb();
    const done = d.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_SLOT) as { value: string } | undefined;
    if (done?.value === slot) return;
    d.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SETTING_SLOT, slot);
    const r = await syncCarteraSheet({ trigger: 'auto' });
    console.log(`[CARTERA] carga ${slot}: ${r.ok ? 'ok' : r.error}`);
  };
  const timer = setInterval(() => void tick().catch((e) => console.error('[CARTERA]', e)), 60_000);
  timer.unref?.();
}
