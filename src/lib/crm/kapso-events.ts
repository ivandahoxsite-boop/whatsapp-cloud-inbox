import { addActivity, claimEvent, findOrCreateContactByPhone, hasMessageActivity } from './agent-store';

type KapsoPayload = {
  message?: {
    id?: string;
    type?: string;
    timestamp?: string;
    from?: string;
    to?: string;
    text?: { body?: string };
    kapso?: { direction?: string; content?: string; transcript?: unknown };
  };
  conversation?: { id?: string; contact_name?: string; phone_number?: string };
  phone_number_id?: string;
  is_new_conversation?: boolean;
};

export type EventResult = { handled: boolean; duplicate?: boolean; contactId?: number; created?: boolean };

const transcriptText = (t: unknown) => (typeof t === 'string' ? t : t && typeof t === 'object' && typeof (t as { text?: unknown }).text === 'string' ? (t as { text: string }).text : '');

/** Readable text for a WhatsApp message: audio transcript, text body, or a short label for media. */
export function messageText(m: { type?: string; text?: { body?: string }; kapso?: { content?: unknown; transcript?: unknown } }): string {
  const transcript = transcriptText(m.kapso?.transcript);
  if (transcript) return `🎤 ${transcript}`;
  const content = typeof m.kapso?.content === 'string' ? m.kapso.content : '';
  // Kapso appends signed media URLs to the content; they expire, so they are not worth storing.
  const clean = (content || m.text?.body || '').replace(/\s*URL:\s*\S+/g, '').trim();
  return mediaLabel(clean) || clean || `[${m.type ?? 'mensaje'}]`;
}

// "Image attached (image_5bf3.jpeg) [Size: 357.9 KB | Type: image/jpeg]" -> "📷 Imagen"
function mediaLabel(content: string): string {
  // History imported from the WhatsApp Business app can hold media Kapso never downloaded.
  if (/^\[Media\b[^\]]*\]$/i.test(content)) return '📎 Archivo';
  const m = /^(Image|Video|Document|Audio|Sticker) attached(?: \(([^)]*)\))?/i.exec(content);
  if (!m) return '';
  const kind = m[1].toLowerCase();
  if (kind === 'image') return '📷 Imagen';
  if (kind === 'video') return '🎬 Video';
  if (kind === 'audio') return '🎤 Audio';
  if (kind === 'sticker') return '[sticker]';
  return `📄 ${m[2] || 'Documento'}`;
}

export function handleKapsoEvent(event: string, payload: KapsoPayload, idempotencyKey?: string): EventResult {
  if (event !== 'whatsapp.message.received' && event !== 'whatsapp.message.sent') return { handled: false };

  const key = `${idempotencyKey || ''}:${payload.message?.id || ''}:${event}`;
  if (key !== `::${event}` && !claimEvent(key)) return { handled: true, duplicate: true };

  const inbound = event === 'whatsapp.message.received';
  const phone = payload.conversation?.phone_number || (inbound ? payload.message?.from : payload.message?.to);
  // BSUID-only contacts have no phone number; there is nothing to key a CRM record on yet.
  if (!phone) return { handled: false };

  // The history sync may already have stored this message.
  if (payload.message?.id && hasMessageActivity(payload.message.id)) return { handled: true, duplicate: true };

  const { id, created } = findOrCreateContactByPhone(phone, inbound ? payload.conversation?.contact_name || '' : '');
  const text = messageText(payload.message ?? {});
  addActivity(id, inbound ? 'whatsapp_in' : 'whatsapp_out', text, {
    phone_number_id: payload.phone_number_id,
    conversation_id: payload.conversation?.id,
    message_id: payload.message?.id,
    type: payload.message?.type
  });
  return { handled: true, contactId: id, created };
}
