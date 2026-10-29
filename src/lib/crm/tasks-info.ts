// Client-safe (no database imports): types and date helpers shared by the server and the browser.
// Dates are plain "YYYY-MM-DD" in Colombia time (UTC-5, no daylight saving).
import { isColombianHoliday } from './holidays';

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
  /** "HH:MM" (24 h), or null for the default time. */
  dueTime: string | null;
  repeat: Repeat;
  /** Notified on the phone every 30 minutes from its time until it is done (only the ones the user marks). */
  notify: boolean;
};

/** Time of the Calendar reminder when the to-do has a day but no time. */
export const DEFAULT_TIME = '09:00';

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

/** Why a to-do cannot be set on that day (Sunday or a Colombian holiday), or null when it can. */
export function dayProblem(date: string): string | null {
  if (at(date).getUTCDay() === 0) return 'Los domingos no se puede. Elige de lunes a sábado.';
  if (isColombianHoliday(date)) return 'Ese día es festivo en Colombia. Elige otro día.';
  return null;
}

/** The same day if it is Monday-Saturday and not a holiday, else the next one that is. */
export function workdayOnOrAfter(date: string): string {
  let d = date;
  while (dayProblem(d)) d = addDays(d, 1);
  return d;
}

export const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Link that opens Google Calendar with the event filled in (30 min, Colombian time); the user only taps Save. */
export function calendarUrl(t: Pick<Task, 'text' | 'name' | 'phone' | 'dueDate' | 'dueTime'>, crmUrl: string): string | null {
  if (!t.dueDate) return null;
  const time = (t.dueTime ?? DEFAULT_TIME).replace(':', '');
  const [h, m] = [Number(time.slice(0, 2)), Number(time.slice(2))];
  const endMin = h * 60 + m + 30;
  const end = `${String(Math.floor((endMin % 1440) / 60)).padStart(2, '0')}${String(endMin % 60).padStart(2, '0')}`;
  const endDate = endMin >= 1440 ? addDays(t.dueDate, 1) : t.dueDate;
  const day = (d: string) => d.replace(/-/g, '');
  const details = [t.name && `Cliente: ${t.name}`, /^\d{7,}$/.test(t.phone) && `WhatsApp: https://wa.me/${t.phone}`, `CRM: ${crmUrl}`].filter(Boolean).join('\n');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: t.name ? `${t.text} · ${t.name}` : t.text,
    dates: `${day(t.dueDate)}T${time}00/${day(endDate)}T${end}00`,
    ctz: 'America/Bogota',
    details
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function nextDue(base: string, repeat: Exclude<Repeat, ''>): string {
  return repeat === 'semanal' ? addDays(base, 7) : repeat === 'quincenal' ? addDays(base, 15) : addMonths(base, 1);
}

const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "Atrasado 3 d", "Hoy", "Mañana", "lun 27 oct", "Sin fecha". */
export function dueLabel(date: string | null, today: string, time?: string | null): string {
  if (!date) return 'Sin fecha';
  const at12 = (t: string) => `${Number(t.slice(0, 2)) % 12 || 12}:${t.slice(3)} ${Number(t.slice(0, 2)) < 12 ? 'am' : 'pm'}`;
  const suffix = time ? ` · ${at12(time)}` : '';
  const diff = Math.round((at(date).getTime() - at(today).getTime()) / 86_400_000);
  if (diff < 0) return `Atrasado ${-diff} d`;
  if (diff === 0) return `Hoy${suffix}`;
  if (diff === 1) return `Mañana${suffix}`;
  const d = at(date);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${suffix}`;
}

/** "sáb 25 oct · 1:02 p. m." in Colombian time. */
export function coDateTime(iso: string): string {
  const ms = Date.parse(iso);
  const date = new Date(ms).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Bogota' });
  const time = new Date(ms).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
  return `${date} · ${time}`;
}

/** "hoy, " / "ayer, " / "mañana, " before a Colombian date, or nothing (to put before `coDateTime`). */
export function dayWord(iso: string, now = Date.now()): string {
  const co = (ms: number) => new Date(ms - 5 * 3_600_000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(co(Date.parse(iso))) - Date.parse(co(now))) / 86_400_000);
  return days === 0 ? 'hoy, ' : days === -1 ? 'ayer, ' : days === 1 ? 'mañana, ' : '';
}
