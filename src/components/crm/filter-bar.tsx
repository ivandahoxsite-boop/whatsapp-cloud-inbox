'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RECURRENCE_INFO, SEGMENT_INFO, type Recurrence, type Segment } from '@/lib/crm/scoring';
import { isEmptyFilter, type CustomerFilter } from '@/lib/crm/filters';
import { RECURRENCE_COLOR, SEGMENT_COLOR, cityOptions, type CrmData } from './shared';

type Option = { value: string; label: string; color?: string; count?: number };

function Dropdown({
  label,
  options,
  selected,
  onChange
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);

  // The filter row scrolls horizontally on phones, which would clip an absolutely positioned
  // panel; a fixed panel anchored to the button escapes that container.
  const openPanel = () => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 264)) });
    setOpen((o) => !o);
  };

  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        onClick={openPanel}
        className={cn(
          'flex h-9 items-center gap-1 whitespace-nowrap rounded-full border px-3 text-sm',
          selected.length ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-border/60 bg-card/50 text-muted-foreground'
        )}
      >
        {label}
        {selected.length > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{selected.length}</span>}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && pos && (
        <div
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-50 max-h-72 w-64 overflow-auto rounded-xl border border-border/60 bg-popover p-1 shadow-xl"
        >
          {options.length === 0 && <p className="p-2 text-xs text-muted-foreground">Sin opciones todavía.</p>}
          {options.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} className="accent-primary" />
              {o.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: o.color }} />}
              <span className="flex-1 truncate">{o.label}</span>
              {o.count != null && <span className="text-xs tabular-nums text-muted-foreground">{o.count}</span>}
            </label>
          ))}
          {selected.length > 0 && (
            <button onClick={() => onChange([])} className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent">
              Quitar selección
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const DAYS_OPTIONS: { label: string; f: Partial<CustomerFilter> }[] = [
  { label: 'Cualquier fecha', f: { maxDaysSince: undefined, minDaysSince: undefined } },
  { label: 'Compró en los últimos 30 días', f: { maxDaysSince: 30, minDaysSince: undefined } },
  { label: 'Compró en los últimos 90 días', f: { maxDaysSince: 90, minDaysSince: undefined } },
  { label: 'Sin comprar hace +90 días', f: { minDaysSince: 90, maxDaysSince: undefined } },
  { label: 'Sin comprar hace +180 días', f: { minDaysSince: 180, maxDaysSince: undefined } },
  { label: 'Sin comprar hace +1 año', f: { minDaysSince: 365, maxDaysSince: undefined } }
];

export function FilterBar({
  data,
  filter,
  onChange,
  showSearch = true
}: {
  data: CrmData;
  filter: CustomerFilter;
  onChange: (f: CustomerFilter) => void;
  showSearch?: boolean;
}) {
  const set = (patch: Partial<CustomerFilter>) => onChange({ ...filter, ...patch });
  const count = <K extends string>(key: (c: CrmData['customers'][number]) => K) => {
    const m = new Map<K, number>();
    data.customers.forEach((c) => m.set(key(c), (m.get(key(c)) ?? 0) + 1));
    return m;
  };
  const recCount = count((c) => c.recurrence);
  const segCount = count((c) => c.segment);
  const stageCount = count((c) => String(c.stageId ?? 0));
  const daysIdx = DAYS_OPTIONS.findIndex((o) => o.f.maxDaysSince === filter.maxDaysSince && o.f.minDaysSince === filter.minDaysSince);

  return (
    <div className="space-y-2">
      {showSearch && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter.q ?? ''}
            onChange={(e) => set({ q: e.target.value || undefined })}
            placeholder="Buscar nombre, teléfono o ciudad"
            className="h-10 w-full rounded-full border border-border/60 bg-card/50 pl-9 pr-3 text-sm outline-none focus:border-primary/60"
          />
        </div>
      )}
      {/* Horizontal scroll on phones instead of wrapping into many rows. */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        <button
          onClick={() => set({ awaiting: filter.awaiting ? undefined : true })}
          className={cn(
            'flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 text-sm',
            filter.awaiting ? 'border-amber-400/70 bg-amber-400/15 text-foreground' : 'border-border/60 bg-card/50 text-muted-foreground'
          )}
        >
          ⏳ Esperan respuesta
          <span className="text-xs tabular-nums opacity-70">{data.customers.filter((c) => c.awaitingReply).length}</span>
        </button>
        <Dropdown
          label="Tipo de cliente"
          selected={filter.recurrence ?? []}
          onChange={(v) => set({ recurrence: v as Recurrence[] })}
          options={(Object.keys(RECURRENCE_INFO) as Recurrence[]).map((r) => ({
            value: r,
            label: RECURRENCE_INFO[r].label,
            color: RECURRENCE_COLOR[r],
            count: recCount.get(r) ?? 0
          }))}
        />
        <Dropdown
          label="Ciudad"
          selected={filter.cities ?? []}
          onChange={(v) => set({ cities: v })}
          options={cityOptions(data.customers).map((c) => ({ value: c.name, label: c.name, count: c.count }))}
        />
        <Dropdown
          label="Etiqueta"
          selected={(filter.tags ?? []).map(String)}
          onChange={(v) => set({ tags: v.map(Number) })}
          options={data.tags.map((t) => ({ value: String(t.id), label: `#${t.name}`, color: t.color, count: t.count }))}
        />
        <Dropdown
          label="Valor (RFM)"
          selected={filter.rfm ?? []}
          onChange={(v) => set({ rfm: v as Segment[] })}
          options={(Object.keys(SEGMENT_INFO) as Segment[]).map((s) => ({
            value: s,
            label: SEGMENT_INFO[s].label,
            color: SEGMENT_COLOR[s],
            count: segCount.get(s) ?? 0
          }))}
        />
        <Dropdown
          label="Etapa"
          selected={(filter.stages ?? []).map(String)}
          onChange={(v) => set({ stages: v.map(Number) })}
          options={[
            ...data.stages.map((s) => ({ value: String(s.id), label: s.name, count: stageCount.get(String(s.id)) ?? 0 })),
            { value: '0', label: 'Sin etapa', count: stageCount.get('0') ?? 0 }
          ]}
        />
        <select
          value={daysIdx < 0 ? 0 : daysIdx}
          onChange={(e) => set(DAYS_OPTIONS[Number(e.target.value)].f)}
          className={cn(
            'h-9 shrink-0 rounded-full border bg-card/50 px-3 text-sm',
            daysIdx > 0 ? 'border-primary/60 text-foreground' : 'border-border/60 text-muted-foreground'
          )}
        >
          {DAYS_OPTIONS.map((o, i) => (
            <option key={o.label} value={i}>
              {o.label}
            </option>
          ))}
        </select>
        {!isEmptyFilter(filter) && (
          <button
            onClick={() => onChange({})}
            className="flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-sm text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" /> Limpiar
          </button>
        )}
      </div>
    </div>
  );
}
