// Copies to THIS cartera CRM the WhatsApp of each customer that was already linked BY NIT in the original CRM.
//   bash /opt/crm-cartera/deploy/importar-whatsapp.sh
// - The original CRM's database is opened READ-ONLY: nothing changes there.
// - Only links the user confirmed there (cartera_links status 'linked', by NIT) and only for customers that have
//   invoices in this CRM (Cartera or Cartera Cali). Never by name.
// - Each link goes through this CRM's own API (same as "Buscar su WhatsApp" → "Es este"), so invoices move to the
//   WhatsApp contact exactly as when the user links by hand.
// - Shows how many it will link and asks before doing it. Prints no phone numbers.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import readline from 'node:readline/promises';

const ORIG_DB = process.env.ORIG_DB || '/var/lib/crm/crm.db';
const ENV_FILE = process.env.CRM_ENV_FILE || '/etc/crm-cartera/crm.env';
const PORT = process.env.CRM_PORT || '4100';

const env = Object.fromEntries(
  fs
    .readFileSync(ENV_FILE, 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^"(.*)"$/, '$1')])
);
const NEW_DB = env.CRM_DB_PATH;
if (!NEW_DB || !fs.existsSync(NEW_DB)) throw new Error(`No encuentro la base del CRM de cartera (${NEW_DB})`);
if (!fs.existsSync(ORIG_DB)) throw new Error(`No encuentro la base del CRM original (${ORIG_DB})`);
if (ORIG_DB === NEW_DB) throw new Error('La base original y la nueva son la misma');

// 1) Linked NIT -> WhatsApp in the original CRM (read-only).
const orig = new DatabaseSync(ORIG_DB, { readOnly: true });
const links = new Map(
  orig
    .prepare(
      `SELECT l.cliente AS key, c.phone, c.name FROM cartera_links l JOIN contacts c ON c.id = l.contact_id
       WHERE l.status = 'linked' AND c.phone NOT LIKE 'nit:%'`
    )
    .all()
    .map((r) => [r.key, { phone: r.phone, name: r.name || '' }])
);
orig.close();

// 2) Customers (NIT) with invoices in this CRM, and the ones already linked here.
const mine = new DatabaseSync(NEW_DB, { readOnly: true });
const keys = new Set(
  mine
    .prepare("SELECT DISTINCT json_extract(data, '$.cliente') AS key FROM receivables WHERE status = 'open' AND source = 'cartera'")
    .all()
    .map((r) => r.key)
    .filter(Boolean)
);
const cali = mine.prepare("SELECT value FROM settings WHERE key = 'cartera_cali'").get();
if (cali) for (const i of JSON.parse(cali.value).invoices ?? []) if (i.key) keys.add(i.key);
const already = new Set(mine.prepare("SELECT cliente FROM cartera_links WHERE status = 'linked'").all().map((r) => r.cliente));
mine.close();

const todo = [...keys].filter((k) => links.has(k) && !already.has(k));
const missing = [...keys].filter((k) => !links.has(k) && !already.has(k)).length;
console.log(`Clientes con facturas en este CRM:            ${keys.size}`);
console.log(`Ya tienen WhatsApp aquí:                      ${[...keys].filter((k) => already.has(k)).length}`);
console.log(`Se pueden unir con el WhatsApp del CRM original: ${todo.length}`);
console.log(`Sin WhatsApp en ninguno de los dos (a mano):  ${missing}`);
if (!todo.length) process.exit(0);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question(`\n¿Unir esos ${todo.length} clientes con su WhatsApp? Escriba si o no: `)).trim().toLowerCase();
rl.close();
if (answer !== 'si' && answer !== 'sí') {
  console.log('No se cambió nada.');
  process.exit(0);
}

const auth = 'Basic ' + Buffer.from(`${env.INBOX_USERNAME || 'admin'}:${env.INBOX_PASSWORD}`).toString('base64');
let ok = 0;
const errors = [];
for (const key of todo) {
  const { phone, name } = links.get(key);
  const res = await fetch(`http://127.0.0.1:${PORT}/api/crm/receivables/links`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, phone, name })
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.ok) ok++;
  else errors.push(body.error || `HTTP ${res.status}`);
}
console.log(`\n✅ Unidos: ${ok}`);
if (errors.length) console.log(`⚠️ No se pudieron unir ${errors.length}: ${[...new Set(errors)].slice(0, 3).join(' | ')}`);
console.log('Abra el CRM y recargue la página (F5).');
