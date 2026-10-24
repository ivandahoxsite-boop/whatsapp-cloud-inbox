import { getWhatsAppClient } from '@/lib/whatsapp-client';
import { getOutbox, lastPhoneNumberId, markOutbox, sentLastHour, addActivity } from './agent-store';

const HOURLY_LIMIT = Number(process.env.CRM_MAX_SENDS_PER_HOUR || 20);

/** Sends an approved outbox message through Kapso. Only transitions pending -> sent/failed. */
export async function approveAndSend(id: number): Promise<{ ok: boolean; error?: string }> {
  const item = getOutbox(id);
  if (!item) return { ok: false, error: 'Mensaje no encontrado' };
  if (item.status !== 'pending') return { ok: false, error: `El mensaje ya está ${item.status}` };
  if (sentLastHour() >= HOURLY_LIMIT) return { ok: false, error: `Límite de ${HOURLY_LIMIT} envíos por hora alcanzado` };

  const phoneNumberId = lastPhoneNumberId(item.contactId) || process.env.PHONE_NUMBER_ID;
  if (!phoneNumberId) return { ok: false, error: 'No sé desde qué número enviar: define PHONE_NUMBER_ID' };

  try {
    await getWhatsAppClient().messages.sendText({ phoneNumberId, to: item.phone, body: item.body });
    markOutbox(id, 'sent');
    addActivity(item.contactId, 'whatsapp_out', item.body, { phone_number_id: phoneNumberId, via: 'crm' });
    return { ok: true };
  } catch (e) {
    // Outside the 24h window Meta rejects free text: the error is surfaced, never retried silently.
    const msg = e instanceof Error ? e.message : 'Error al enviar';
    markOutbox(id, 'failed', msg);
    return { ok: false, error: msg };
  }
}
