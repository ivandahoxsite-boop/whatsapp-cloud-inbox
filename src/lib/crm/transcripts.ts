import { buildKapsoFields, type MessageListResponse } from '@kapso/whatsapp-cloud-api';
import { getWhatsAppClient } from '@/lib/whatsapp-client';
import { getDb } from './db';
import { messageText } from './kapso-events';

// Kapso transcribes voice notes a little after they arrive, so the webhook often stores just "🎤 Audio".
// This fills those in from Kapso's message history (read-only on Kapso's side).

const NO_TEXT = ['🎤 Audio', '[audio]'];
const PAGE_SIZE = 100;
const MAX_PAGES = 200;
const PAUSE_MS = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Query = (input: { phoneNumberId: string; since: string; limit: number; after?: string; fields: string }) => Promise<MessageListResponse>;
type Msg = { id?: string; type?: string; text?: { body?: string }; kapso?: Record<string, unknown> };

/** Voice notes from the last `days` days still stored without text, as { message id -> activity id }. */
export function audiosWithoutText(days: number): Map<string, { activityId: number; createdAt: string }> {
  const rows = getDb()
    .prepare(
      `SELECT id, json_extract(meta, '$.message_id') AS mid, created_at FROM activities
       WHERE kind IN ('whatsapp_in', 'whatsapp_out') AND text IN (${NO_TEXT.map(() => '?').join(',')})
         AND created_at >= datetime('now', ?) AND json_extract(meta, '$.message_id') IS NOT NULL`
    )
    .all(...NO_TEXT, `-${days} day`) as unknown as { id: number; mid: string; created_at: string }[];
  return new Map(rows.map((r) => [r.mid, { activityId: r.id, createdAt: r.created_at }]));
}

/** Replaces "🎤 Audio" with "🎤 <transcript>" where Kapso already has it. Returns how many were filled. */
export async function fillTranscripts(phoneNumberId: string, days = 90, query?: Query): Promise<number> {
  const want = audiosWithoutText(days);
  if (!want.size) return 0;
  const run: Query = query ?? ((input) => getWhatsAppClient().messages.query(input));
  const oldest = [...want.values()].reduce((a, w) => (w.createdAt < a ? w.createdAt : a), '9999');
  const since = new Date(Date.parse(`${oldest.replace(' ', 'T')}Z`) - 3_600_000).toISOString();
  const fields = buildKapsoFields(['content', 'transcript']);
  const update = getDb().prepare('UPDATE activities SET text = ? WHERE id = ?');
  let filled = 0;
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES && want.size; page++) {
    const res = await run({ phoneNumberId, since, limit: PAGE_SIZE, after, fields });
    for (const m of (res.data ?? []) as unknown as Msg[]) {
      const hit = m.id ? want.get(m.id) : undefined;
      if (!hit) continue;
      const text = messageText({ type: m.type, text: m.text, kapso: { content: m.kapso?.content, transcript: m.kapso?.transcript } });
      if (!text.startsWith('🎤 ') || NO_TEXT.includes(text)) continue; // not transcribed yet
      update.run(text, hit.activityId);
      want.delete(m.id!);
      filled++;
    }
    const next = res.paging?.cursors?.after;
    if (!res.data?.length || !next || !res.paging?.next) break;
    after = next;
    await sleep(PAUSE_MS);
  }
  return filled;
}

let pending: ReturnType<typeof setTimeout> | null = null;

/**
 * After a voice note arrives without text: look for its transcript 2 minutes later and, if Kapso was still working on
 * it, once more 10 minutes later. Several audios in a row share the same check.
 */
export function scheduleTranscriptFill(phoneNumberId: string) {
  if (pending) return;
  pending = setTimeout(async () => {
    pending = null;
    try {
      await fillTranscripts(phoneNumberId, 2);
      if (audiosWithoutText(1).size) setTimeout(() => void fillTranscripts(phoneNumberId, 2).catch(() => {}), 8 * 60_000);
    } catch {
      // Kapso unreachable: the next crm-update (or audio) tries again.
    }
  }, 2 * 60_000);
}
