// Heuristic for "does this last message need an answer?". Questions and requests always do;
// short closings ("listo, gracias", "ok", "le aviso") and one-word reactions do not.
const REQUEST = /\?|precio|cu[aá]nto|valor|cotiz|necesito|me (puede|podr[ií]a|env[ií]a|manda|regala)|pedido|disponib|tiene[sn]? |garant|problema|da[ñn]|quem|no (sirve|funciona|prende)|factura|cuenta de cobro|cu[aá]ndo|d[oó]nde|urgente/i;
const CLOSING = /gracias|\bok\b|okey|listo|dale|de una|perfecto|excelente|bueno|con gusto|entendido|comprendo|claro|s[ií] se[ñn]or|s[ií] sr|le (aviso|informo|confirmo)|te (aviso|informo|confirmo)|ya le (aviso|informo)|bendicion|feliz|igualmente|👍|🙏|👌|🫡|💪|🤝|❤️/i;

// Closings that end the exchange whatever their length.
const FAREWELL = /(le|te|les) (aviso|informo|confirmo|cuento)|quedo pendiente|que (tenga|tengas|tengan) (un )?(buen|feliz|lindo)|con much[oa] gusto|bendiciones|feliz (d[ií]a|tarde|noche)/i;

/** Older unanswered chats are history, not a to-do. */
export const AWAITING_WINDOW_DAYS = 14;

export function needsReply(raw: string): boolean {
  // A voice note, photo, video or document with no text (no transcript yet) still waits for your answer.
  if (/^(🎤\s*audio|\[(audio|image|video|document)\])$/iu.test(raw.trim())) return true;
  const text = raw.replace(/^🎤\s*/, '').replace(/^\[(sticker|reaction|mensaje|image|audio)\]$/i, '').trim();
  if (!text) return false;
  if (REQUEST.test(text)) return true;
  // A photo or file sent without an answer is usually part of a request (product photo, receipt).
  if (/^(📷|📄|🎬|📎)/u.test(text)) return true;
  if (FAREWELL.test(text)) return false;
  // A bare greeting usually opens a request: answer it.
  if (/^(hola|buen[oa]s?( (d[ií]as?|tardes?|noches?))?|qu[eé] m[aá]s|saludos)\b[\s!.,]*$/i.test(text)) return true;
  const words = text.split(/\s+/).length;
  if (words <= 8 && CLOSING.test(text)) return false;
  if (words <= 2) return false; // "Jajaja", "Ajuemadre", "Amén"
  return true;
}
