// Client-safe (no database imports): types and date helpers shared by the server and the browser.
// Dates are plain "YYYY-MM-DD" in Colombia time (UTC-5, no daylight saving).

export type Repeat = '' | 'semanal' | 'quincenal' | 'mensual';

export const REPEAT_LABEL: Record<Exclude<Repeat, ''>, string> = { semanal: 'cada semana', quincenal: 'cada 15 días', mensual: 'cada mes' };

export type Task = {
  id: number;
  contactId: number | null;
  name: string;
  phone: string;
  hasPhone: boolean;
  text: string;
  dueDate: string | null;
  repeat: Repeat;
};

export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export const todayCo = (now = Date.now()) => new Date(now - 5 * 3_600_000).toISOString().slice(0, 10);

const at = (date: string) => new Date(`${date}T00:00:00Z`);

export function addDays(date: string, n: number): string {
  const d = at(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Same day next month(s); a 31st lands on the last day of a shorter month. */
export function addMonths(date: string, n: number): string {
  const d = at(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** The next Monday after `from` (a Monday asks for the following one). */
export function nextMonday(from: string): string {
  return addDays(from, ((8 - at(from).getUTCDay()) % 7) || 7);
}

export function nextDue(base: string, repeat: Exclude<Repeat, ''>): string {
  return repeat === 'semanal' ? addDays(base, 7) : repeat === 'quincenal' ? addDays(base, 15) : addMonths(base, 1);
}

const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "Atrasado 3 d", "Hoy", "Mañana", "lun 27 oct", "Sin fecha". */
export function dueLabel(date: string | null, today: string): string {
  if (!date) return 'Sin fecha';
  const diff = Math.round((at(date).getTime() - at(today).getTime()) / 86_400_000);
  if (diff < 0) return `Atrasado ${-diff} d`;
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  const d = at(date);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
