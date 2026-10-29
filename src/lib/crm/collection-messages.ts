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
 * Before or on the due date ("Por vencer" in Cartera, after the morning warning): each invoice on its own line with its
 * value, the ones about to fall due and (optionally) the older overdue ones apart, the total, and the payment date
 * question. Layout "Lista con total" approved by the user on 29-oct-2026.
 */
export function preDueMessage(
  name: string,
  items: { doc: string; balance: number; dueAt: string }[],
  overdue: { doc: string; balance: number; daysLate: number }[] = []
): string {
  const who = greetName(name);
  const WEEK = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const MONTH = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const day = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTH[m - 1]}`;
  };
  const soon = [...items].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const old = [...overdue].sort((a, b) => b.daysLate - a.daysLate);
  // Up to 6 overdue invoices one per line; the rest summed in one line so the message stays readable.
  const MAX_OLD = 6;
  const rest = old.slice(MAX_OLD);
  const total = [...soon, ...old].reduce((a, i) => a + i.balance, 0);
  const lines = [
    `Hola${who ? ` ${who}` : ''} 👋 Te escribimos de *Xsite Group* · cartera 💼`,
    '',
    '📅 *Por vencer:*',
    ...soon.map((i) => `🧾 Fact. *${i.doc}* · vence ${day(i.dueAt)} · *${money(i.balance)}*`)
  ];
  if (old.length) {
    lines.push('', '⚠️ *Vencidas:*', ...old.slice(0, MAX_OLD).map((o) => `🧾 Fact. *${o.doc}* · ${o.daysLate} días · *${money(o.balance)}*`));
    if (rest.length) lines.push(`🧾 y ${rest.length} factura${rest.length === 1 ? '' : 's'} más · *${money(rest.reduce((a, o) => a + o.balance, 0))}*`);
  }
  lines.push('', `💰 *Total: ${money(total)}*`, '', '¿Nos confirmas la fecha de pago? 📅 ¡Gracias! ✅');
  return lines.join('\n');
}
