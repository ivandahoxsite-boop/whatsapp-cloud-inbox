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

/** Every level names only the oldest overdue invoice and asks the customer for a payment date. */
export function collectionMessage(name: string, items: DebtItem[]): { tier: CollectionTier; text: string } | null {
  const overdue = items.filter((i) => i.daysLate > 0 && i.balance > 0).sort((a, b) => b.daysLate - a.daysLate);
  if (!overdue.length) return null;
  const days = overdue[0].daysLate;
  const tier = collectionTier(days);
  if (!tier) return null;
  const who = greetName(name);

  const texts: Record<CollectionTier['level'], string> = {
    // Level 1: only the oldest overdue invoice, and ask for a payment date (user's choice, 26-oct-2026).
    1:
      `Hola${who ? ` ${who}` : ''} 👋 Te escribimos de *Xsite Group* · cartera 💼\n\n` +
      `Tienes pendiente la factura *${overdue[0].doc}* por *${money(overdue[0].balance)}* (vencida hace ${days} días) 🧾\n\n` +
      `¿Qué fecha te programamos para el pago? 📅 Respóndenos con el día y lo dejamos agendado ✅`,
    // Level 2: only the oldest overdue invoice, firmer, asks for the date today (user's choice, 26-oct-2026).
    2:
      `Hola${who ? ` ${who}` : ''} 👋 Te escribimos de *Xsite Group* · cartera ⚠️\n\n` +
      `La factura *${overdue[0].doc}* por *${money(overdue[0].balance)}* ya lleva *${days} días* vencida 🧾\n\n` +
      `Necesitamos que nos confirmes *hoy* la fecha de pago 📅 para seguir despachando sin inconvenientes 🚚`,
    // Level 3: only the oldest overdue invoice; keep the relationship, ask which day (user's choice, 26-oct-2026).
    3:
      `Hola${who ? ` ${who}` : ''} 👋 Te escribimos de *Xsite Group* · cartera.\n\n` +
      `La factura *${overdue[0].doc}* por *${money(overdue[0].balance)}* lleva *${days} días* vencida 🧾\n\n` +
      `Queremos seguir trabajando contigo 🤝 pero necesitamos que te pongas al día. Confírmanos hoy *qué día* realizas el pago 📅🙏`,
    // Level 4: only the oldest overdue invoice; formal notice before prejudicial collection (confirmed by the user).
    4:
      `${who ? `${who}, t` : 'T'}e contactamos de *Xsite Group* · cartera 🔴\n\n` +
      `La factura *${overdue[0].doc}* por *${money(overdue[0].balance)}* lleva *${days} días* en mora 🧾\n\n` +
      `Es un llamado formal 📌 Si en *5 días hábiles* no recibimos el pago o un acuerdo, la cuenta pasa a cobro prejurídico. Respóndenos hoy con la *fecha de pago* 📅`
  };
  return { tier, text: texts[tier.level] };
}

/**
 * Before or on the due date ("Por vencer" in Cartera, after the morning warning): a friendly heads-up that names the
 * invoices that fall due, optionally the customer's older overdue ones too, and asks for the payment date.
 * Approved by the user on 29-oct-2026.
 */
export function preDueMessage(
  name: string,
  items: { doc: string; balance: number; dueAt: string }[],
  overdue: { doc: string; balance: number; daysLate: number }[] = []
): string {
  const who = greetName(name);
  const sorted = [...items].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const dayName = (iso: string, long: boolean) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-CO', long ? { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' } : { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  };
  const oneDay = sorted.every((i) => i.dueAt === sorted[0].dueAt);
  const total = money(sorted.reduce((a, i) => a + i.balance, 0));
  // Same due date: "el jueves, 29 de octubre vencen…"; different dates: each invoice with its own date.
  const dueLine = oneDay
    ? `Te recordamos que el *${dayName(sorted[0].dueAt, true)}* vence${sorted.length === 1 ? '' : 'n'} ${
        sorted.length === 1 ? `la factura *${sorted[0].doc}* por *${money(sorted[0].balance)}*` : `las facturas ${sorted.map((i) => `*${i.doc}*`).join(', ')} por *${total}*`
      } 🧾`
    : `Te recordamos que vencen las facturas ${sorted.map((i) => `*${i.doc}* (${dayName(i.dueAt, false)})`).join(', ')} por *${total}* 🧾`;
  const old = [...overdue].sort((a, b) => b.daysLate - a.daysLate);
  const shown = old.slice(0, 3).map((o) => `*${o.doc}* (${o.daysLate} días)`);
  const oldText = !old.length
    ? ''
    : old.length === 1
      ? `Además tienes vencida la factura *${old[0].doc}* por *${money(old[0].balance)}* (${old[0].daysLate} días) ⚠️\n\n`
      : `Además tienes vencidas las facturas ${shown.join(', ')}${old.length > 3 ? ` y ${old.length - 3} más` : ''} por *${money(old.reduce((a, o) => a + o.balance, 0))}* ⚠️\n\n`;
  return (
    `Hola${who ? ` ${who}` : ''} 👋 Te escribimos de *Xsite Group* · cartera 💼\n\n` +
    `${dueLine}\n\n` +
    oldText +
    `¿Nos confirmas la fecha de pago? 📅 ¡Gracias! ✅`
  );
}
