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

/** First name without emojis ("Juan Taller 🙏" -> "Juan"); two words when the first is very short ("AB Motos"). */
function greetName(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length || /^\d+$/.test(words.join(''))) return '';
  return words[0].length <= 2 && words[1] ? `${words[0]} ${words[1]}` : words[0];
}

/** The customer's whole name without emojis or odd symbols ("DEMO AUDIO 🔊 S.A.S." -> "DEMO AUDIO S.A.S."). */
function fullName(name: string): string {
  const n = name.replace(/[^\p{L}\p{N}\s.'&/()-]/gu, ' ').replace(/\s+/g, ' ').trim();
  return /^[\d\s]*$/.test(n) ? '' : n;
}

/** The company as messages name it; the "Cartera Cali" customers get "Xsite Group · sede Cali" (user's choice, 30-oct-2026). */
export const MAIN_COMPANY = 'Xsite Group';
export const CALI_COMPANY = 'Xsite Group · sede Cali';

/** Every level names only the oldest overdue invoice and asks the customer for a payment date. */
export function collectionMessage(name: string, items: DebtItem[], company = MAIN_COMPANY): { tier: CollectionTier; text: string } | null {
  const overdue = items.filter((i) => i.daysLate > 0 && i.balance > 0).sort((a, b) => b.daysLate - a.daysLate);
  if (!overdue.length) return null;
  const days = overdue[0].daysLate;
  const tier = collectionTier(days);
  if (!tier) return null;
  const who = greetName(name);
  const full = fullName(name);

  const texts: Record<CollectionTier['level'], string> = {
    // Level 1: the oldest overdue invoice (number and value, no days) and the owner's own words to ask for the payment
    // day; full name, complete with a formal closing (chosen on 5-nov-2026).
    1:
      `Hola${full ? ` ${full}` : ''} 👋\n` +
      `Te saludamos de *${company}* · cartera 💼\n\n` +
      `Tenemos pendiente la factura:\n` +
      `🧾 Fact. *${overdue[0].doc}* · *${money(overdue[0].balance)}*\n\n` +
      `🙏 Por favor, ¿nos puedes decir *para qué día programamos el pago*? 📅\n\n` +
      `Quedamos atentos a tu respuesta ✅\n` +
      `Cordialmente,\n` +
      `*${company}* · Cartera`,
    // Level 2: like level 1 but "de nuevo" and asking for the day *today*; no days, no mention of dispatches (5-nov-2026).
    2:
      `Hola${full ? ` ${full}` : ''} 👋\n` +
      `Te escribimos de nuevo de *${company}* · cartera ⚠️\n\n` +
      `Seguimos con pendiente la factura:\n` +
      `🧾 Fact. *${overdue[0].doc}* · *${money(overdue[0].balance)}*\n\n` +
      `🙏 Por favor, ¿nos confirmas *hoy* para qué día programamos el pago? 📅\n\n` +
      `Quedamos atentos a tu respuesta ✅\n` +
      `Cordialmente,\n` +
      `*${company}* · Cartera`,
    // Level 3: only the oldest overdue invoice; keep the relationship, ask which day (user's choice, 26-oct-2026).
    3:
      `Hola${who ? ` ${who}` : ''} 👋 Te escribimos de *${company}* · cartera.\n\n` +
      `La factura *${overdue[0].doc}* por *${money(overdue[0].balance)}* lleva *${days} días* vencida 🧾\n\n` +
      `Queremos seguir trabajando contigo 🤝 pero necesitamos que te pongas al día. Confírmanos hoy *qué día* realizas el pago 📅🙏`,
    // Level 4: "último aviso" with the days in mora; no deadline and no prejudicial collection (5-nov-2026).
    4:
      `📌 *Último aviso de cartera* 🔴\n\n` +
      `Hola${full ? ` ${full}` : ''} 👋\n` +
      `Te escribimos de *${company}* · cartera.\n\n` +
      `Tu factura ya lleva *${days} días* en mora:\n` +
      `🧾 Fact. *${overdue[0].doc}* · *${money(overdue[0].balance)}*\n\n` +
      `Necesitamos resolver este saldo lo antes posible.\n\n` +
      `🙏 Por favor, ¿nos confirmas *hoy* para qué día programamos el pago? 📅\n\n` +
      `Quedamos atentos a tu respuesta ✅\n` +
      `Cordialmente,\n` +
      `*${company}* · Cartera`
  };
  return { tier, text: texts[tier.level] };
}

/**
 * Before or on the due date ("Por vencer" in Cartera, after the morning warning): each invoice on its own line with its
 * value, the older overdue ones (optional) apart, the total, and a formal request for the date the payment is scheduled.
 * Layout "Lista con total" approved by the user on 29-oct-2026. The invoices of the warning go without a title or due
 * date: the user does not want to tell the customer they "just fell due", only to ask for the payment date (29-oct-2026).
 */
export function preDueMessage(
  name: string,
  items: { doc: string; balance: number; dueAt: string }[],
  overdue: { doc: string; balance: number; daysLate: number }[] = [],
  company = MAIN_COMPANY
): string {
  // The whole name in this message (the user asked: "Hola DEMO AUDIO…", not just "Hola DEMO").
  const who = fullName(name);
  const sorted = [...items].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const old = [...overdue].sort((a, b) => b.daysLate - a.daysLate);
  // Up to 6 overdue invoices one per line; the rest summed in one line so the message stays readable.
  const MAX_OLD = 6;
  const rest = old.slice(MAX_OLD);
  const total = [...sorted, ...old].reduce((a, i) => a + i.balance, 0);
  const lines = [`Hola${who ? ` ${who}` : ''} 👋 Te escribimos de *${company}* · cartera 💼`];
  if (sorted.length) lines.push('', ...sorted.map((i) => `🧾 Fact. *${i.doc}* · *${money(i.balance)}*`));
  if (old.length) {
    lines.push('', '⚠️ *Vencidas:*', ...old.slice(0, MAX_OLD).map((o) => `🧾 Fact. *${o.doc}* · ${o.daysLate} días · *${money(o.balance)}*`));
    if (rest.length) lines.push(`🧾 y ${rest.length} factura${rest.length === 1 ? '' : 's'} más · *${money(rest.reduce((a, o) => a + o.balance, 0))}*`);
  }
  // Formal closing chosen by the user (option 1, 29-oct-2026).
  lines.push(
    '',
    `💰 *Total: ${money(total)}*`,
    '',
    '📅 Le agradecemos confirmarnos la *fecha programada para el pago*.',
    'Quedamos atentos.',
    '',
    'Cordialmente,',
    `*${company}* · Cartera`
  );
  return lines.join('\n');
}
