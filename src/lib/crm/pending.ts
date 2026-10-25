import { getDb } from './db';
import { needsReply } from './reply';
import type { PendingChat, PendingReason } from './pending-info';

/** Chats older than this are history, not a to-do. */
export const PENDING_WINDOW_DAYS = 90;
/** A chat where you answered last is only "in the air" once the customer has been quiet this long. */
const STALE_DAYS = 2;

export { PENDING_INFO, type PendingChat, type PendingReason } from './pending-info';

// Things you say when you owe the customer something.
const PROMISE = /te (confirmo|aviso|cuento|averiguo|reviso|cotizo|env[ií]o|mando|paso|escribo|llamo)|le (confirmo|aviso|cuento|averiguo|reviso|cotizo|env[ií]o|mando|paso|escribo|llamo)|d[eé]jame|d[eé]jeme|perm[ií]t(a|e)me|voy a (revisar|consultar|averiguar|preguntar|cotizar)|lo (reviso|averiguo|consulto|miro)|d[ée]me un (momento|momentico|rato)|en un momento|ahorita (le|te)|quedo pendiente|ma[ñn]ana (le|te)/i;
const QUOTE = /precio|cu[aá]nto (vale|cuesta|sale|es)|cost(ar[ií]a|ar[aá]|ar)|valor|cotiz|disponib|tiene[sn]? |hay |referencia|catalogo|cat[aá]logo/i;

const toIso = (s: string) => `${s.replace(' ', 'T')}Z`;
const DAY = 86_400_000;

type Msg = { contact_id: number; kind: 'whatsapp_in' | 'whatsapp_out'; text: string; created_at: string };

/**
 * Chats from the last 90 days that need something from you, one reason per customer (the most urgent):
 * 1. they wrote and nobody answered, 2. you promised something and nothing followed,
 * 3. they asked for a price and no sale came after. Closing a chat hides it until the customer writes again.
 */
export function pendingChats(now = new Date()): PendingChat[] {
  const db = getDb();
  const since = new Date(now.getTime() - PENDING_WINDOW_DAYS * DAY).toISOString().slice(0, 19).replace('T', ' ');
  const msgs = db
    .prepare(
      `SELECT contact_id, kind, text, created_at FROM activities
       WHERE kind IN ('whatsapp_in','whatsapp_out') AND created_at >= ? ORDER BY contact_id, created_at, id`
    )
    .all(since) as unknown as Msg[];
  const lastSale = new Map(
    (db.prepare('SELECT contact_id, MAX(sold_at) AS d FROM sales WHERE amount > 0 GROUP BY contact_id').all() as unknown as { contact_id: number; d: string }[]).map(
      (r) => [r.contact_id, r.d]
    )
  );
  const closed = new Map(
    (db.prepare('SELECT contact_id, resolved_at FROM chat_resolutions').all() as unknown as { contact_id: number; resolved_at: string }[]).map((r) => [
      r.contact_id,
      r.resolved_at
    ])
  );
  const muted = new Set((db.prepare('SELECT contact_id FROM chat_mutes').all() as unknown as { contact_id: number }[]).map((r) => r.contact_id));
  const contacts = new Map(
    (db.prepare('SELECT id, name, phone FROM contacts').all() as unknown as { id: number; name: string; phone: string }[]).map((c) => [c.id, c])
  );

  const byContact = new Map<number, Msg[]>();
  for (const m of msgs) {
    const list = byContact.get(m.contact_id) ?? [];
    list.push(m);
    byContact.set(m.contact_id, list);
  }

  const out: PendingChat[] = [];
  for (const [id, list] of byContact) {
    const c = contacts.get(id);
    if (!c || muted.has(id)) continue;
    const last = list[list.length - 1];
    const lastInbound = [...list].reverse().find((m) => m.kind === 'whatsapp_in');
    // Closed from the panel: stays hidden until the customer writes something newer.
    const closedAt = closed.get(id);
    if (closedAt && (!lastInbound || lastInbound.created_at < closedAt)) continue;
    const soldAfter = (iso: string) => {
      const d = lastSale.get(id);
      return !!d && d >= iso.slice(0, 10);
    };

    let hit: { reason: PendingReason; m: Msg } | null = null;
    if (last.kind === 'whatsapp_in' && needsReply(last.text)) {
      hit = { reason: 'sin_respuesta', m: last };
    } else if (last.kind === 'whatsapp_out' && PROMISE.test(last.text) && now.getTime() - Date.parse(toIso(last.created_at)) >= STALE_DAYS * DAY && !soldAfter(last.created_at)) {
      hit = { reason: 'en_el_aire', m: last };
    } else {
      // Asked for a price and you never answered after it (any reply counts: text, voice note, photo).
      // A chat you did answer is not pending, even without a sale.
      const i = list.findLastIndex((m) => m.kind === 'whatsapp_in' && QUOTE.test(m.text) && m.text.length >= 4);
      const answered = i >= 0 && list.slice(i + 1).some((m) => m.kind === 'whatsapp_out');
      if (i >= 0 && !answered && !soldAfter(list[i].created_at)) hit = { reason: 'cotizacion', m: list[i] };
    }
    if (!hit) continue;
    out.push({
      contactId: id,
      name: c.name,
      phone: c.phone,
      hasPhone: /^\d{7,}$/.test(c.phone),
      reason: hit.reason,
      text: hit.m.text,
      at: toIso(hit.m.created_at),
      days: Math.floor((now.getTime() - Date.parse(toIso(hit.m.created_at))) / DAY)
    });
  }
  const rank: Record<PendingReason, number> = { sin_respuesta: 0, en_el_aire: 1, cotizacion: 2 };
  return out.sort((a, b) => rank[a.reason] - rank[b.reason] || b.at.localeCompare(a.at));
}

export function closeChat(contactId: number, kind: 'resolved' | 'ignored') {
  getDb()
    .prepare(
      `INSERT INTO chat_resolutions (contact_id, kind, resolved_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(contact_id) DO UPDATE SET kind = excluded.kind, resolved_at = excluded.resolved_at`
    )
    .run(contactId, kind);
}

/** Hides a customer from "Pendientes" for good (until `unmuteChat`), even when they write again. */
export function muteChat(contactId: number) {
  getDb().prepare('INSERT OR IGNORE INTO chat_mutes (contact_id) VALUES (?)').run(contactId);
}

export function unmuteChat(contactId: number) {
  getDb().prepare('DELETE FROM chat_mutes WHERE contact_id = ?').run(contactId);
}

export function mutedChats(): { contactId: number; name: string; phone: string }[] {
  return getDb()
    .prepare('SELECT c.id AS contactId, c.name, c.phone FROM chat_mutes m JOIN contacts c ON c.id = m.contact_id ORDER BY c.name')
    .all() as unknown as { contactId: number; name: string; phone: string }[];
}
