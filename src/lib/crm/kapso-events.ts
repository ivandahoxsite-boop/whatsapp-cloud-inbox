import { addActivity, claimEvent, findOrCreateContactByPhone } from './agent-store';

type KapsoPayload = {
  message?: { id?: string; type?: string; from?: string; to?: string; text?: { body?: string }; kapso?: { direction?: string; content?: string } };
  conversation?: { id?: string; contact_name?: string; phone_number?: string };
  phone_number_id?: string;
  is_new_conversation?: boolean;
};

export type EventResult = { handled: boolean; duplicate?: boolean; contactId?: number; created?: boolean };

export function handleKapsoEvent(event: string, payload: KapsoPayload, idempotencyKey?: string): EventResult {
  if (event !== 'whatsapp.message.received' && event !== 'whatsapp.message.sent') return { handled: false };

  const key = `${idempotencyKey || ''}:${payload.message?.id || ''}:${event}`;
  if (key !== `::${event}` && !claimEvent(key)) return { handled: true, duplicate: true };

  const inbound = event === 'whatsapp.message.received';
  const phone = payload.conversation?.phone_number || (inbound ? payload.message?.from : payload.message?.to);
  // BSUID-only contacts have no phone number; there is nothing to key a CRM record on yet.
  if (!phone) return { handled: false };

  const { id, created } = findOrCreateContactByPhone(phone, inbound ? payload.conversation?.contact_name || '' : '');
  const text = payload.message?.kapso?.content ?? payload.message?.text?.body ?? `[${payload.message?.type ?? 'mensaje'}]`;
  addActivity(id, inbound ? 'whatsapp_in' : 'whatsapp_out', text, {
    phone_number_id: payload.phone_number_id,
    conversation_id: payload.conversation?.id,
    message_id: payload.message?.id,
    type: payload.message?.type
  });
  return { handled: true, contactId: id, created };
}
