'use client';

import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { RECURRENCE_INFO, SEGMENT_INFO, type Recurrence, type Segment } from '@/lib/crm/scoring';
import type { Customer } from '@/lib/crm/customers';
import type { CustomField, Stage } from '@/lib/crm/db';
import type { Tag } from '@/lib/crm/tags';
import type { SavedSegment } from '@/lib/crm/segments';
import { cityKey } from '@/lib/crm/filters';

export type CrmData = {
  customers: Customer[];
  fields: CustomField[];
  stages: Stage[];
  tags: Tag[];
  segments: SavedSegment[];
};

export const QUERY_KEY = ['crm'] as const;

export async function api<T = unknown>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Error');
  return data as T;
}

export function useCrmData() {
  return useQuery({ queryKey: QUERY_KEY, queryFn: () => api<CrmData>('/api/crm/customers') });
}

export const money = (n: number) => n.toLocaleString('es', { maximumFractionDigits: 0, useGrouping: 'always' });
export const card = 'rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl';

export const SEGMENT_COLOR: Record<Segment, string> = {
  campeon: '#34d399',
  leal: '#38bdf8',
  potencial: '#fbbf24',
  en_riesgo: '#fb923c',
  dormido_valioso: '#e879f9',
  perdido: '#71717a',
  sin_compras: '#52525b'
};

export const RECURRENCE_COLOR: Record<Recurrence, string> = {
  prospecto: '#71717a',
  primera_compra: '#38bdf8',
  una_vez: '#a78bfa',
  recurrente: '#34d399',
  por_recomprar: '#fbbf24',
  recurrente_perdido: '#f87171'
};

/** Small colored pill; color comes from data so it works in light and dark mode. */
export function Pill({ color, children, className }: { color: string; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', className)}
      style={{ background: `${color}26`, color }}
    >
      {children}
    </span>
  );
}

export function SegmentPill({ segment }: { segment: Segment }) {
  return <Pill color={SEGMENT_COLOR[segment]}>{SEGMENT_INFO[segment].label}</Pill>;
}

export function RecurrencePill({ recurrence }: { recurrence: Recurrence }) {
  return <Pill color={RECURRENCE_COLOR[recurrence]}>{RECURRENCE_INFO[recurrence].label}</Pill>;
}

export function TagPill({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <Pill color={tag.color || '#a1a1aa'}>
      #{tag.name}
      {onRemove && (
        <button onClick={onRemove} className="-mr-1 ml-0.5 rounded-full px-1 hover:bg-black/10" aria-label={`Quitar ${tag.name}`}>
          ×
        </button>
      )}
    </Pill>
  );
}

/** Distinct cities with customer counts, keeping the most common spelling of each. */
export function cityOptions(customers: Customer[]): { name: string; count: number }[] {
  const groups = new Map<string, Map<string, number>>();
  for (const c of customers) {
    if (!c.city) continue;
    const k = cityKey(c.city);
    const spellings = groups.get(k) ?? new Map<string, number>();
    spellings.set(c.city, (spellings.get(c.city) ?? 0) + 1);
    groups.set(k, spellings);
  }
  return [...groups.values()]
    .map((sp) => {
      const entries = [...sp.entries()].sort((a, b) => b[1] - a[1]);
      return { name: entries[0][0], count: entries.reduce((a, [, n]) => a + n, 0) };
    })
    .sort((a, b) => b.count - a.count);
}

/** "+57 300 224 5595" for Colombian mobiles, "+<digits>" otherwise, "Sin teléfono" for an internal key. */
export function formatPhone(phone: string): string {
  if (!/^\d+$/.test(phone)) return 'Sin teléfono';
  const m = /^57(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return m ? `+57 ${m[1]} ${m[2]} ${m[3]}` : `+${phone}`;
}

export const displayName = (c: { name: string; phone: string }) => c.name || formatPhone(c.phone);

/** "hace 5 min", "hace 3 h", "hace 2 d" for an ISO timestamp. */
export function ago(iso: string | null): string {
  if (!iso) return '—';
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return `hace ${min} min`;
  if (min < 48 * 60) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} d`;
}

export function relativeDays(days: number | null): string {
  if (days == null) return '—';
  if (days === 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 60) return `hace ${days} d`;
  if (days < 730) return `hace ${Math.round(days / 30)} meses`;
  return `hace ${(days / 365).toFixed(1)} años`;
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV ready for a Kapso broadcast upload (phone first, with country code). */
export function downloadCustomersCsv(customers: Customer[], data: CrmData, filename = 'clientes.csv') {
  const tagName = new Map(data.tags.map((t) => [t.id, t.name]));
  const stageName = new Map(data.stages.map((s) => [s.id, s.name]));
  const header = ['telefono', 'nombre', 'ciudad', 'etiquetas', 'etapa', 'tipo', 'segmento', 'compras', 'total', 'ultima_compra', 'producto_favorito'];
  // Customers without a phone can't be uploaded to a broadcast.
  const rows = customers.filter((c) => c.hasPhone).map((c) => [
    c.phone,
    c.name,
    c.city,
    c.tags.map((t) => tagName.get(t)).filter(Boolean).join(', '),
    c.stageId ? stageName.get(c.stageId) ?? '' : '',
    RECURRENCE_INFO[c.recurrence].label,
    SEGMENT_INFO[c.segment].label,
    c.salesCount,
    Math.round(c.totalSpent),
    c.lastSaleAt ?? '',
    c.favoriteProduct ?? ''
  ]);
  const csv = '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
