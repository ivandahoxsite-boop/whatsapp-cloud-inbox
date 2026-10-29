'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  if (res.status === 423 && typeof window !== 'undefined') window.dispatchEvent(new Event('crm-locked'));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error || 'Error'), { body: data });
  return data as T;
}

export function useCrmData() {
  return useQuery({ queryKey: QUERY_KEY, queryFn: () => api<CrmData>('/api/crm/customers') });
}

/**
 * Keeps the CRM live: every few seconds asks the server (a tiny request) whether anything changed — a new
 * WhatsApp message, a sale, an approval — and only then reloads the CRM queries.
 */
export function useLiveSync(everyMs = 5000): { newBuild: boolean } {
  const qc = useQueryClient();
  const last = useRef<string | null>(null);
  const build = useRef<string | null>(null);
  const [newBuild, setNewBuild] = useState(false);
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const { version, build: serverBuild } = await api<{ version: string; build?: string }>('/api/crm/version');
        if (stopped) return;
        // The server was updated while this page stayed open: this page's code is outdated.
        if (serverBuild) {
          if (build.current === null) build.current = serverBuild;
          else if (build.current !== serverBuild) setNewBuild(true);
        }
        if (last.current !== null && last.current !== version) {
          qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('crm') });
        }
        last.current = version;
      } catch {
        /* offline or signed out: try again on the next tick */
      }
    };
    check();
    const timer = setInterval(check, everyMs);
    document.addEventListener('visibilitychange', check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [qc, everyMs]);
  return { newBuild };
}

export const money = (n: number) => n.toLocaleString('es', { maximumFractionDigits: 0, useGrouping: 'always' });
export const card = 'rounded-2xl border border-border/80 bg-card/90 p-4 shadow-sm shadow-black/5 backdrop-blur-xl dark:shadow-black/30';
/** Money with its sign: "$ 14.213.000". */
export const cop = (n: number) => `$\u00a0${money(n)}`;

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'slate';
const TONES: Record<Tone, { chip: string; tint: string; value: string; ring: string }> = {
  green: { chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', tint: 'from-emerald-500/10', value: 'text-emerald-600 dark:text-emerald-400', ring: 'border-emerald-500/50' },
  amber: { chip: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', tint: 'from-amber-500/10', value: 'text-amber-600 dark:text-amber-400', ring: 'border-amber-500/50' },
  red: { chip: 'bg-rose-500/15 text-rose-600 dark:text-rose-400', tint: 'from-rose-500/10', value: 'text-rose-600 dark:text-rose-400', ring: 'border-rose-500/50' },
  blue: { chip: 'bg-sky-500/15 text-sky-600 dark:text-sky-400', tint: 'from-sky-500/10', value: 'text-sky-600 dark:text-sky-400', ring: 'border-sky-500/50' },
  violet: { chip: 'bg-violet-500/15 text-violet-600 dark:text-violet-400', tint: 'from-violet-500/10', value: 'text-violet-600 dark:text-violet-400', ring: 'border-violet-500/50' },
  slate: { chip: 'bg-slate-500/15 text-slate-600 dark:text-slate-300', tint: 'from-slate-500/10', value: '', ring: 'border-slate-500/50' }
};

/**
 * A number that matters, with its color and icon so it reads at a glance. `colorValue` paints the number itself
 * (for what needs attention: overdue, unanswered). `active` marks it as the filter in use. `compact`: for three
 * narrow cards in a row on the phone, the icon goes above the label.
 */
export function Stat({
  label,
  value,
  sub,
  tone = 'slate',
  icon: Icon,
  colorValue,
  active,
  onClick,
  className,
  compact,
  children
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  icon?: React.ComponentType<{ className?: string }>;
  colorValue?: boolean;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const t = TONES[tone];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      aria-pressed={onClick ? !!active : undefined}
      className={cn(
        card,
        'relative overflow-hidden bg-gradient-to-br to-transparent p-3 text-left sm:p-4',
        t.tint,
        onClick && 'transition-colors hover:border-primary/50',
        active && t.ring,
        className
      )}
    >
      <div className={cn('flex gap-2', compact ? 'flex-col items-start sm:flex-row sm:items-center' : 'items-center')}>
        {Icon && (
          <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', t.chip)}>
            <Icon className="size-4" />
          </span>
        )}
        <p className="min-w-0 text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
      </div>
      <p className={cn('mt-2 flex items-center gap-1 whitespace-nowrap text-xl font-semibold tabular-nums tracking-tight sm:text-2xl lg:text-[1.7rem]', colorValue && t.value)}>{value}</p>
      {sub && <p className="mt-1 text-[11px] leading-snug text-muted-foreground sm:text-xs">{sub}</p>}
      {children}
    </Tag>
  );
}

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

/** True on a computer (mouse/trackpad, not Android/iPhone): there WhatsApp opens in WhatsApp Web instead of the app. */
type Device = 'desktop' | 'android' | 'phone';

function useDevice(): Device {
  const [device, setDevice] = useState<Device>('phone');
  useEffect(() => {
    const ua = navigator.userAgent;
    setDevice(/Android/i.test(ua) ? 'android' : !/iPhone|iPad|iPod/i.test(ua) && window.matchMedia('(pointer: fine)').matches ? 'desktop' : 'phone');
  }, []);
  return device;
}

/** The WhatsApp Business app on Android (its package name). */
const WA_BUSINESS = 'com.whatsapp.w4b';

/**
 * On Android: an intent that opens the chat straight in the WhatsApp Business app, without going through a browser
 * tab (the user asked for it). It hands the app WhatsApp's own https link (api.whatsapp.com/send, the same format as
 * wa.me): with the whatsapp:// scheme the app cut long messages on the user's phone. If the app is missing, Chrome
 * falls back to wa.me.
 */
export function whatsappBusinessIntent(phone: string, text?: string): string {
  const q = `phone=${phone}${text ? `&text=${encodeURIComponent(text)}` : ''}`;
  const fallback = encodeURIComponent(`https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`);
  return `intent://api.whatsapp.com/send?${q}#Intent;scheme=https;package=${WA_BUSINESS};S.browser_fallback_url=${fallback};end`;
}

/**
 * "Escribir por WhatsApp". On a computer it opens the chat straight in WhatsApp Web, always in the same browser tab
 * (named "whatsapp-web") instead of a new one each time; on Android it opens the WhatsApp Business app directly; on
 * other phones, the WhatsApp app through wa.me.
 */
export function WhatsAppLink({
  phone,
  text,
  className,
  children,
  beforeOpen
}: {
  phone: string;
  text?: string;
  className?: string;
  children: React.ReactNode;
  /** Runs on tap: false cancels, a string replaces the text ('' opens the chat without text). */
  beforeOpen?: () => Promise<boolean | string>;
}) {
  const device = useDevice();
  const desktop = device === 'desktop';
  const url = (t?: string) => {
    if (device === 'android') return whatsappBusinessIntent(phone, t);
    const q = t ? `text=${encodeURIComponent(t)}` : '';
    return desktop ? `https://web.whatsapp.com/send?phone=${phone}${q ? `&${q}` : ''}` : `https://wa.me/${phone}${q ? `?${q}` : ''}`;
  };
  const onClick = beforeOpen
    ? async (e: React.MouseEvent) => {
        e.preventDefault();
        const r = await beforeOpen();
        if (r === false) return;
        const target = url(typeof r === 'string' ? r : text);
        // Android: the intent hands the chat to the app; the CRM page stays where it was.
        if (device === 'android') window.location.href = target;
        else window.open(target, desktop ? 'whatsapp-web' : '_blank', desktop ? undefined : 'noopener');
      }
    : undefined;
  // On a computer no rel="noopener": the browser must be able to find and reuse the tab it opened the first time.
  if (device === 'android')
    return (
      <a href={url(text)} className={className} onClick={onClick}>
        {children}
      </a>
    );
  return desktop ? (
    <a href={url(text)} target="whatsapp-web" className={className} onClick={onClick}>
      {children}
    </a>
  ) : (
    <a href={url(text)} target="_blank" rel="noreferrer" className={className} onClick={onClick}>
      {children}
    </a>
  );
}

/**
 * Before opening WhatsApp with a payment reminder: checks the collection rules (hours, Sundays and holidays, a payment
 * promise in force, already contacted today). Returns true to open with the message, '' to open the chat without it,
 * false to cancel. If the check itself fails it does not block.
 */
export async function checkCollection(contactId: number): Promise<boolean | string> {
  try {
    const r = await api<{ checks: { allowed: boolean; reasons: string[] }[] }>(`/api/crm/collections/check?customerId=${contactId}`);
    const ch = r.checks[0];
    if (ch && !ch.allowed) {
      return confirm(`No es buen momento para cobrarle:\n\n• ${ch.reasons.join('\n• ')}\n\n¿Abrir el chat SIN el mensaje de cobro?`) ? '' : false;
    }
  } catch {
    /* if the check fails, do not block the message */
  }
  return true;
}

/** Whether "Llamar" goes through Twilio (rings your phone first, then the customer) or the phone's own dialer. */
export function useTwilio(): { configured: boolean; agent: string | null } {
  const { data } = useQuery({
    queryKey: ['crm-twilio'],
    queryFn: () => api<{ configured: boolean; agent: string | null }>('/api/crm/twilio'),
    staleTime: 5 * 60_000
  });
  return data ?? { configured: false, agent: null };
}

/** Starts a Twilio call; returns the text to show. Throws with Twilio's reason when it fails. */
export async function twilioCall(contactId: number, name: string, agent: string | null): Promise<string> {
  await api('/api/crm/twilio', 'POST', { contactId });
  return `📲 Twilio te está llamando a tu celular${agent ? ` (${agent})` : ''}. Contesta y te conecta con ${name || 'el cliente'}.`;
}
