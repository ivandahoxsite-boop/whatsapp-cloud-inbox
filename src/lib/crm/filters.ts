// Pure filtering shared by the browser (lists, exports) and the server (saved segments, agent API).
import type { Recurrence, Segment } from './scoring';

export type CustomerFilter = {
  q?: string;
  rfm?: Segment[];
  recurrence?: Recurrence[];
  cities?: string[];
  /** Matches customers that have ANY of these tag ids. */
  tags?: number[];
  /** Stage ids; 0 means "no stage". */
  stages?: number[];
  minSpent?: number;
  /** Bought within the last N days. */
  maxDaysSince?: number;
  /** Has NOT bought in the last N days. */
  minDaysSince?: number;
};

export type FilterableCustomer = {
  name: string;
  phone: string;
  city: string;
  tags: number[];
  stageId: number | null;
  segment: Segment;
  recurrence: Recurrence;
  totalSpent: number;
  daysSinceLastSale: number | null;
};

export const normalizeText = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

/** "bogotá d.c." and "Bogota D.C." group together; display keeps the most common spelling. */
export const cityKey = (s: string) => normalizeText(s);

export function matchesFilter(c: FilterableCustomer, f: CustomerFilter): boolean {
  if (f.q) {
    const q = normalizeText(f.q);
    const digits = q.replace(/\D/g, '');
    if (!normalizeText(c.name).includes(q) && !(digits && c.phone.includes(digits)) && !cityKey(c.city).includes(q)) return false;
  }
  if (f.rfm?.length && !f.rfm.includes(c.segment)) return false;
  if (f.recurrence?.length && !f.recurrence.includes(c.recurrence)) return false;
  if (f.cities?.length && !f.cities.map(cityKey).includes(cityKey(c.city))) return false;
  if (f.tags?.length && !f.tags.some((t) => c.tags.includes(t))) return false;
  if (f.stages?.length && !f.stages.includes(c.stageId ?? 0)) return false;
  if (f.minSpent != null && c.totalSpent < f.minSpent) return false;
  if (f.maxDaysSince != null && (c.daysSinceLastSale == null || c.daysSinceLastSale > f.maxDaysSince)) return false;
  if (f.minDaysSince != null && c.daysSinceLastSale != null && c.daysSinceLastSale < f.minDaysSince) return false;
  return true;
}

export function isEmptyFilter(f: CustomerFilter): boolean {
  return Object.values(f).every((v) => v == null || v === '' || (Array.isArray(v) && v.length === 0));
}

/** Drops unknown keys and wrong types so a stored or user-supplied filter can be trusted. */
export function sanitizeFilter(raw: unknown): CustomerFilter {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 50) : undefined);
  const nums = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter(Number.isFinite).slice(0, 50) : undefined);
  const num = (v: unknown) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));
  return {
    q: typeof o.q === 'string' ? o.q.slice(0, 100) : undefined,
    rfm: strs(o.rfm) as Segment[] | undefined,
    recurrence: strs(o.recurrence) as Recurrence[] | undefined,
    cities: strs(o.cities),
    tags: nums(o.tags),
    stages: nums(o.stages),
    minSpent: num(o.minSpent),
    maxDaysSince: num(o.maxDaysSince),
    minDaysSince: num(o.minDaysSince)
  };
}
