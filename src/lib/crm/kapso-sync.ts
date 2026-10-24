import { buildKapsoFields, type MessageListResponse } from '@kapso/whatsapp-cloud-api';
import { getWhatsAppClient } from '@/lib/whatsapp-client';
import { getDb } from './db';
import { addActivity, findOrCreateContactByPhone, hasMessageActivity } from './agent-store';
import { messageText } from './kapso-events';
import { normalizePhone } from './customers';

// One-shot import of the WhatsApp history Kapso already stored, so the CRM is not limited
// to messages that arrive after the webhook was created. Read-only on Kapso's side:
// it never sends anything, so it cannot affect the number's quality or get it restricted.

export type SyncState = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  pages: number;
  messagesSeen: number;
  activitiesAdded: number;
  contactsCreated: number;
  skipped: number;
  oldestMessageAt: string | null;
  error: string | null;
};

const PAGE_SIZE = 100;
const PAUSE_MS = 400; // between pages, well under Kapso's per-minute API limits
const MAX_PAGES = 1000; // safety stop: 100k messages

// Types that carry no useful conversation content.
const SKIP_TYPES = new Set(['reaction', 'sticker', 'system', 'unsupported', 'edit', 'ephemeral', 'revoke']);

const state: SyncState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  pages: 0,
  messagesSeen: 0,
  activitiesAdded: 0,
  contactsCreated: 0,
  skipped: 0,
  oldestMessageAt: null,
  error: null
};

export const getSyncState = (): SyncState => ({ ...state });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sqlTime = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ');

type Msg = {
  id: string;
  type?: string;
  timestamp?: string;
  from?: string;
  to?: string;
  text?: { body?: string };
  kapso?: Record<string, unknown>;
};

// The SDK camel-cases Kapso's fields; accept both spellings in case a version does not.
const kv = (m: Msg, camel: string, snake: string): string => {
  const v = m.kapso?.[camel] ?? m.kapso?.[snake];
  return typeof v === 'string' ? v : '';
};

async function fetchPage(phoneNumberId: string, after?: string): Promise<MessageListResponse> {
  const fields = buildKapsoFields(['direction', 'phone_number', 'contact_name', 'content', 'transcript', 'whatsapp_conversation_id']);
  for (let attempt = 0; ; attempt++) {
    try {
      return await getWhatsAppClient().messages.query({ phoneNumberId, limit: PAGE_SIZE, after, fields });
    } catch (e) {
      const err = e as { httpStatus?: number; retry?: { retryAfterMs?: number } };
      const retriable = err.httpStatus === 429 || (err.httpStatus ?? 0) >= 500;
      if (!retriable || attempt >= 5) throw e;
      // Respect Retry-After when Kapso sends it, otherwise back off exponentially.
      await sleep(err.retry?.retryAfterMs ?? 2000 * 2 ** attempt);
    }
  }
}

/** Stores one page of messages, skipping ones that are already in the CRM. */
function storePage(messages: Msg[], phoneNumberId: string) {
  const d = getDb();
  // Outbound messages are sent from the business number; never turn it into a customer.
  const ownNumbers = new Set(messages.filter((m) => kv(m, 'direction', 'direction') === 'outbound' && m.from).map((m) => normalizePhone(m.from!)));
  d.exec('BEGIN');
  try {
    for (const m of messages) {
      state.messagesSeen++;
      const ts = Number(m.timestamp);
      if (Number.isFinite(ts) && ts > 0) {
        const at = new Date(ts * 1000).toISOString();
        if (!state.oldestMessageAt || at < state.oldestMessageAt) state.oldestMessageAt = at;
      }
      const inbound = kv(m, 'direction', 'direction') === 'inbound';
      const phone = normalizePhone(kv(m, 'phoneNumber', 'phone_number') || (inbound ? m.from : m.to) || '');
      if (!m.id || !phone || ownNumbers.has(phone) || SKIP_TYPES.has(m.type ?? '') || hasMessageActivity(m.id)) {
        state.skipped++;
        continue;
      }
      const { id, created } = findOrCreateContactByPhone(phone, inbound ? kv(m, 'contactName', 'contact_name') : '');
      if (created) state.contactsCreated++;
      addActivity(
        id,
        inbound ? 'whatsapp_in' : 'whatsapp_out',
        messageText({ type: m.type, text: m.text, kapso: { content: m.kapso?.content, transcript: m.kapso?.transcript } }),
        {
          phone_number_id: phoneNumberId,
          conversation_id: kv(m, 'whatsappConversationId', 'whatsapp_conversation_id') || undefined,
          message_id: m.id,
          type: m.type,
          via: 'sync'
        },
        Number.isFinite(ts) && ts > 0 ? sqlTime(ts) : undefined
      );
      state.activitiesAdded++;
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

/** Starts the import in the background; a second call while running is a no-op. */
export function startSync(phoneNumberId: string): SyncState {
  if (state.running) return getSyncState();
  Object.assign(state, {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    pages: 0,
    messagesSeen: 0,
    activitiesAdded: 0,
    contactsCreated: 0,
    skipped: 0,
    oldestMessageAt: null,
    error: null
  });

  void (async () => {
    try {
      let after: string | undefined;
      while (state.pages < MAX_PAGES) {
        const page = await fetchPage(phoneNumberId, after);
        const data = (page.data ?? []) as unknown as Msg[];
        state.pages++;
        if (data.length) storePage(data, phoneNumberId);
        const next = page.paging?.cursors?.after;
        if (!data.length || !next || !page.paging?.next) break;
        after = next;
        await sleep(PAUSE_MS);
      }
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
    } finally {
      state.running = false;
      state.finishedAt = new Date().toISOString();
    }
  })();

  return getSyncState();
}
