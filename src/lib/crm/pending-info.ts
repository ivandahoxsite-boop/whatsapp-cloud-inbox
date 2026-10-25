// Client-safe: no database imports, so the browser bundle can use it.
export type PendingReason = 'sin_respuesta' | 'en_el_aire' | 'cotizacion';

export type PendingChat = {
  contactId: number;
  name: string;
  phone: string;
  hasPhone: boolean;
  reason: PendingReason;
  /** The message that makes the chat pending (what they asked / what you promised). */
  text: string;
  at: string;
  days: number;
};

export const PENDING_INFO: Record<PendingReason, { label: string; hint: string }> = {
  sin_respuesta: { label: 'Sin respuesta', hint: 'Te escribió algo que pide respuesta y no le contestaste (un audio tuyo cuenta como respuesta).' },
  en_el_aire: { label: 'Quedó en el aire', hint: 'Le dijiste algo como "te confirmo" y el chat murió sin cierre.' },
  cotizacion: { label: 'Pidió precio sin respuesta', hint: 'Preguntó precio, disponibilidad o cotización y no le contestaste después (ni por texto ni por audio).' }
};
