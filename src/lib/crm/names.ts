// Words that say little about WHICH business it is (legal forms, articles, and terms every shop in this trade uses).
const GENERIC = new Set([
  'SAS', 'SA', 'LTDA', 'SCA', 'CIA', 'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'E', 'CAR', 'CARS', 'AUDIO',
  'SONIDO', 'LUJOS', 'LUJO', 'ACCESORIOS', 'TUNING', 'SHOP', 'STORE', 'TIENDA', 'COLOMBIA', 'GRUPO', 'EMPRESARIAL'
]);

function tokens(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/&/g, ' Y ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 2);
}

function distinctive(name: string): string[] {
  const all = tokens(name);
  const rest = all.filter((t) => !GENERIC.has(t));
  return rest.length ? rest : all;
}

/**
 * Whether two names written by a billing system / sheet / WhatsApp plausibly name the same customer
 * ("ALARMAS Y SONIDO JGR CARTAGO" and "AlARMAS Y SONIDO CARTAGO"). It leans towards "different":
 * a false alarm costs a look, a wrong merge costs a customer's whole history.
 */
export function sameCustomerName(a: string, b: string): boolean {
  const x = new Set(distinctive(a));
  const y = new Set(distinctive(b));
  if (!x.size || !y.size) return false;
  let common = 0;
  for (const t of x) if (y.has(t)) common++;
  return common / Math.min(x.size, y.size) >= 0.5;
}
