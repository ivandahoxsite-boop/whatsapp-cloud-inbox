// Colombian public holidays (Ley Emiliani): fixed dates, dates moved to the next Monday, and the ones counted from Easter.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Moves a date to the following Monday (a Monday stays where it is). */
const toMonday = (d: Date) => addDays(d, (8 - d.getUTCDay()) % 7);

/** Easter Sunday (Meeus/Jones/Butcher algorithm). */
function easter(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(y, month, day);
}

const cache = new Map<number, Set<string>>();

export function colombianHolidays(year: number): Set<string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const e = easter(year);
  const out = new Set<string>();
  // Fixed dates
  for (const [m, d] of [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]]) out.add(iso(utc(year, m, d)));
  // Moved to the next Monday
  for (const [m, d] of [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]]) out.add(iso(toMonday(utc(year, m, d))));
  // Holy Thursday and Good Friday
  out.add(iso(addDays(e, -3)));
  out.add(iso(addDays(e, -2)));
  // Ascension, Corpus Christi and Sacred Heart: Easter + 39 / 60 / 68 days, moved to Monday
  for (const n of [39, 60, 68]) out.add(iso(toMonday(addDays(e, n))));
  cache.set(year, out);
  return out;
}

export const isColombianHoliday = (date: string) => colombianHolidays(Number(date.slice(0, 4))).has(date);
