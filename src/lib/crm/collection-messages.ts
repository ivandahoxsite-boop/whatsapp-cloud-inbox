// Client-safe (no database imports): the payment-reminder texts used by "Escribir por WhatsApp" in the customer file
// and by the "Recordar" button in Cartera. The tone depends on the oldest overdue invoice.
// Firm but within Colombian collection rules (Ley 2300 de 2023): no threats, insults or pressure on third parties.
// Before changing a text, keep it truthful: only mention consequences (stopping credit, prejudicial collection) that
// the business really applies.

export type DebtItem = { doc: string; balance: number; daysLate: number };

export type CollectionTier = { level: 1 | 2 | 3 | 4; label: string; from: number };

export const COLLECTION_TIERS: CollectionTier[] = [
  { level: 1, label: 'Recordatorio cordial (30 a 45 días)', from: 30 },
  { level: 2, label: 'Firme (46 a 55 días)', from: 46 },
  { level: 3, label: 'Más firme (56 a 65 días)', from: 56 },
  { level: 4, label: 'Llamado formal (66 días o más)', from: 66 }
];

/** The tier for the oldest overdue invoice, or null under 30 days (then the chat opens without a text). */
export function collectionTier(days: number): CollectionTier | null {
  return [...COLLECTION_TIERS].reverse().find((t) => days >= t.from) ?? null;
}

const money = (n: number) => `$${Math.round(n).toLocaleString('es-CO', { maximumFractionDigits: 0, useGrouping: true })}`;

/** First readable word(s) of a WhatsApp/AnaliX name, without emojis; '' when there is nothing usable. */
function greetName(name: string): string {
  const clean = name.replace(/[^\p{L}\p{N}\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  return clean && !/^\d+$/.test(clean) ? clean : '';
}

export function collectionMessage(name: string, items: DebtItem[]): { tier: CollectionTier; text: string } | null {
  const overdue = items.filter((i) => i.daysLate > 0 && i.balance > 0).sort((a, b) => b.daysLate - a.daysLate);
  if (!overdue.length) return null;
  const days = overdue[0].daysLate;
  const tier = collectionTier(days);
  if (!tier) return null;
  const total = money(overdue.reduce((a, i) => a + i.balance, 0));
  const shown = overdue.slice(0, 8);
  const list = shown.map((i) => `• Factura ${i.doc}: ${money(i.balance)} (vencida hace ${i.daysLate} días)`).join('\n');
  const more = overdue.length > shown.length ? `\n• y ${overdue.length - shown.length} factura(s) más` : '';
  const who = greetName(name);
  const hola = `Hola${who ? ` ${who}` : ''}`;
  const facturas = `${list}${more}`;

  const texts: Record<CollectionTier['level'], string> = {
    1:
      `${hola}, te saludamos de *Xsite Group*, área de cartera. 😊\n\n` +
      `Te recordamos que tienes pendiente:\n${facturas}\n\n*Total: ${total}*\n\n` +
      `¿Nos ayudas confirmando la fecha de pago? Si ya pagaste, por favor envíanos el soporte para descargarlo. ¡Gracias!`,
    2:
      `${hola}, te escribimos de *Xsite Group*, área de cartera.\n\n` +
      `Tu cuenta presenta facturas vencidas:\n${facturas}\n\n*Total vencido: ${total}*\n\n` +
      `Necesitamos que nos confirmes hoy la fecha de pago para mantener tu cuenta al día y seguir despachando sin inconvenientes. ` +
      `Si ya pagaste, envíanos el soporte.`,
    3:
      `${hola}. Te contactamos de *Xsite Group*, área de cartera, por el saldo vencido de tu cuenta:\n${facturas}\n\n` +
      `*Total vencido: ${total}* (${days} días de mora).\n\n` +
      `Requerimos el pago o un acuerdo de pago en los próximos 3 días hábiles. ` +
      `Mientras la cuenta tenga saldo vencido, los nuevos despachos a crédito quedan sujetos a revisión de cartera.`,
    4:
      `${hola}. Te contactamos de *Xsite Group*, área de cartera. Tu cuenta tiene un saldo con ${days} días de mora:\n${facturas}\n\n` +
      `*Total vencido: ${total}*\n\n` +
      `Este es un llamado formal: si en los próximos 5 días hábiles no recibimos el pago o un acuerdo de pago, ` +
      `se suspenderán los despachos a crédito y la cuenta pasará a cobro prejurídico. ` +
      `Queremos evitarlo: respóndenos hoy con tu propuesta de pago.`
  };
  return { tier, text: texts[tier.level] };
}
