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

/** First name without emojis ("Carlos Serviteca 🙏" -> "Carlos"); two words when the first is very short ("R2 Car"). */
function greetName(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length || /^\d+$/.test(words.join(''))) return '';
  return words[0].length <= 2 && words[1] ? `${words[0]} ${words[1]}` : words[0];
}

export function collectionMessage(name: string, items: DebtItem[]): { tier: CollectionTier; text: string } | null {
  const overdue = items.filter((i) => i.daysLate > 0 && i.balance > 0).sort((a, b) => b.daysLate - a.daysLate);
  if (!overdue.length) return null;
  const days = overdue[0].daysLate;
  const tier = collectionTier(days);
  if (!tier) return null;
  const total = money(overdue.reduce((a, i) => a + i.balance, 0));
  const shown = overdue.slice(0, 6);
  const facturas =
    shown.map((i) => `🧾 ${i.doc}: ${money(i.balance)} (${i.daysLate} días)`).join('\n') +
    (overdue.length > shown.length ? `\n🧾 y ${overdue.length - shown.length} más` : '');
  const who = greetName(name);

  const texts: Record<CollectionTier['level'], string> = {
    1:
      `Hola${who ? ` ${who}` : ''} 👋 Te saludamos de *Xsite Group* · cartera 💼\n\n` +
      `Tienes pendiente:\n${facturas}\n💰 *Total: ${total}*\n\n` +
      `¿Nos confirmas la fecha de pago? 🙏 Si ya pagaste, envíanos el soporte ✅`,
    2:
      `Hola${who ? ` ${who}` : ''} 👋 Te escribimos de *Xsite Group* · cartera.\n\n` +
      `Tienes facturas vencidas ⚠️\n${facturas}\n💰 *Total vencido: ${total}*\n\n` +
      `Por favor confírmanos *hoy* la fecha de pago 📅 para seguir despachando sin inconvenientes 🚚`,
    3:
      `Hola${who ? ` ${who}` : ''} 👋 Te escribimos de *Xsite Group* · cartera.\n\n` +
      `${facturas}\n💰 *Total vencido: ${total}*\n\n` +
      `Queremos seguir trabajando contigo 🤝 pero necesitamos que te pongas al día. Confírmanos hoy cuándo realizas el pago 🙏`,
    4:
      `${who ? `${who}, t` : 'T'}e contactamos de *Xsite Group* · cartera 🔴\n\n` +
      `Tu cuenta lleva *${days} días* en mora:\n${facturas}\n💰 *Total vencido: ${total}*\n\n` +
      `Es un llamado formal 📌 Si en *5 días hábiles* no recibimos el pago o un acuerdo, la cuenta pasa a cobro prejurídico. Respóndenos hoy 🙏`
  };
  return { tier, text: texts[tier.level] };
}
