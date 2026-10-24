import { getDb } from './db';
import { createCustomer, normalizePhone } from './customers';

export type Activity = { id: number; kind: string; text: string; meta: Record<string, unknown>; createdAt: string };
export type OutboxItem = {
  id: number;
  contactId: number;
  contactName: string;
  phone: string;
  body: string;
  status: 'pending' | 'sent' | 'rejected' | 'failed';
  error: string;
  createdAt: string;
};

/** `createdAt` (UTC, "YYYY-MM-DD HH:MM:SS") backdates imported history; defaults to now. */
export function addActivity(contactId: number, kind: string, text: string, meta: Record<string, unknown> = {}, createdAt?: string) {
  getDb()
    .prepare("INSERT INTO activities (contact_id, kind, text, meta, created_at) VALUES (?,?,?,?, COALESCE(?, datetime('now')))")
    .run(contactId, kind, text, JSON.stringify(meta), createdAt ?? null);
}

export function hasMessageActivity(messageId: string): boolean {
  return !!getDb().prepare("SELECT 1 FROM activities WHERE json_extract(meta, '$.message_id') = ? LIMIT 1").get(messageId);
}

export function listActivities(contactId: number, limit = 30): Activity[] {
  const rows = getDb()
    .prepare('SELECT id, kind, text, meta, created_at FROM activities WHERE contact_id = ? ORDER BY id DESC LIMIT ?')
    .all(contactId, limit) as unknown as { id: number; kind: string; text: string; meta: string; created_at: string }[];
  return rows.map((r) => ({ id: r.id, kind: r.kind, text: r.text, meta: JSON.parse(r.meta), createdAt: r.created_at }));
}

/** Last phone_number_id this contact wrote to, so replies leave from the same WhatsApp number. */
export function lastPhoneNumberId(contactId: number): string | null {
  const rows = getDb()
    .prepare("SELECT meta FROM activities WHERE contact_id = ? AND kind IN ('whatsapp_in','whatsapp_out') ORDER BY id DESC LIMIT 20")
    .all(contactId) as unknown as { meta: string }[];
  for (const r of rows) {
    const id = (JSON.parse(r.meta) as { phone_number_id?: string }).phone_number_id;
    if (id) return id;
  }
  return null;
}

/** Returns false if this key was already processed (idempotency for webhook retries). */
export function claimEvent(key: string): boolean {
  const res = getDb().prepare('INSERT OR IGNORE INTO processed_events (key) VALUES (?)').run(key);
  return Number(res.changes) > 0;
}

/** Kapso uses the phone number as contact name when WhatsApp has no profile name. */
export const isPlaceholderName = (name: string) => !name.trim() || /^[\d\s+()-]+$/.test(name.trim());

/** Sets the name only when the contact has none (or just its number); never overwrites one you typed. */
export function fillContactName(rawPhone: string, name: string): boolean {
  if (isPlaceholderName(name)) return false;
  const d = getDb();
  const row = d.prepare('SELECT id, name FROM contacts WHERE phone = ?').get(normalizePhone(rawPhone)) as { id: number; name: string } | undefined;
  if (!row || !isPlaceholderName(row.name)) return false;
  d.prepare('UPDATE contacts SET name = ? WHERE id = ?').run(name.trim().slice(0, 80), row.id);
  return true;
}

export function findOrCreateContactByPhone(rawPhone: string, rawName: string): { id: number; created: boolean } {
  const phone = normalizePhone(rawPhone);
  const name = isPlaceholderName(rawName) ? '' : rawName.trim();
  const d = getDb();
  const existing = d.prepare('SELECT id, name FROM contacts WHERE phone = ?').get(phone) as { id: number; name: string } | undefined;
  if (existing) {
    if (name && isPlaceholderName(existing.name)) d.prepare('UPDATE contacts SET name = ? WHERE id = ?').run(name, existing.id);
    return { id: existing.id, created: false };
  }
  const stage = d.prepare("SELECT id FROM stages WHERE name = 'Nuevo'").get() as { id: number } | undefined;
  return { id: createCustomer({ phone, name, stageId: stage?.id ?? null }), created: true };
}

// ---- Outbox -----------------------------------------------------------------

type OutboxRow = {
  id: number; contact_id: number; name: string; phone: string; body: string; status: OutboxItem['status']; error: string; created_at: string;
};

const OUTBOX_SELECT = `SELECT o.id, o.contact_id, c.name, c.phone, o.body, o.status, o.error, o.created_at
  FROM outbox o JOIN contacts c ON c.id = o.contact_id`;

const toItem = (r: OutboxRow): OutboxItem => ({
  id: r.id, contactId: r.contact_id, contactName: r.name, phone: r.phone, body: r.body, status: r.status, error: r.error, createdAt: r.created_at
});

export function listOutbox(status?: OutboxItem['status']): OutboxItem[] {
  const d = getDb();
  const rows = (status
    ? d.prepare(`${OUTBOX_SELECT} WHERE o.status = ? ORDER BY o.id DESC LIMIT 100`).all(status)
    : d.prepare(`${OUTBOX_SELECT} ORDER BY o.id DESC LIMIT 100`).all()) as unknown as OutboxRow[];
  return rows.map(toItem);
}

export function getOutbox(id: number): OutboxItem | null {
  const r = getDb().prepare(`${OUTBOX_SELECT} WHERE o.id = ?`).get(id) as OutboxRow | undefined;
  return r ? toItem(r) : null;
}

export function proposeMessage(contactId: number, body: string, by = 'agent'): number {
  const text = body.trim();
  if (!text) throw new Error('El mensaje está vacío');
  if (text.length > 1000) throw new Error('El mensaje supera 1000 caracteres');
  return Number(getDb().prepare('INSERT INTO outbox (contact_id, body, proposed_by) VALUES (?,?,?)').run(contactId, text, by).lastInsertRowid);
}

export function markOutbox(id: number, status: 'sent' | 'rejected' | 'failed', error = '') {
  getDb().prepare("UPDATE outbox SET status = ?, error = ?, decided_at = datetime('now') WHERE id = ?").run(status, error, id);
}

export function sentLastHour(): number {
  const r = getDb().prepare("SELECT COUNT(*) AS n FROM outbox WHERE status = 'sent' AND decided_at > datetime('now','-1 hour')").get() as { n: number };
  return r.n;
}
