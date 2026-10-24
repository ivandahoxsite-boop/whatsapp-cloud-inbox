'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { RECURRENCE_INFO, SEGMENT_INFO, type Recurrence, type Segment } from '@/lib/crm/scoring';
import type { CustomerFilter } from '@/lib/crm/filters';
import type { Customer } from '@/lib/crm/customers';
import { cityOptions } from './shared';

export type CrmTab = 'resumen' | 'clientes' | 'segmentos' | 'aprobaciones' | 'importar' | 'estructura';

type Item = { id: string; group: string; label: string; hint?: string; run: () => void };

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Plain-language shortcuts so you can type what you want instead of finding a filter.
const RFM_WORDS: Record<Segment, string[]> = {
  campeon: ['campeon', 'vip', 'mejores', 'top'],
  leal: ['leal'],
  potencial: ['potencial', 'oportunidad', 'vender'],
  en_riesgo: ['riesgo', 'enfria', 'perder'],
  dormido_valioso: ['dormido', 'reactivar', 'inactivo', 'valioso', 'recuperar'],
  perdido: ['perdido'],
  sin_compras: ['sin compra']
};
const RECURRENCE_WORDS: Record<Recurrence, string[]> = {
  prospecto: ['prospecto', 'lead', 'no ha comprado'],
  primera_compra: ['primera', 'nuevo', 'segunda compra'],
  una_vez: ['una vez', 'una compra', 'no volvio'],
  recurrente: ['recurrente', 'fiel', 'frecuente', 'repite'],
  por_recomprar: ['toca', 'recomprar', 'atrasad', 'renovar', 'pendiente'],
  recurrente_perdido: ['dejo de', 'perdido']
};

export function CommandPalette({
  open,
  onClose,
  customers,
  onTab,
  onFilter,
  onOpenCustomer
}: {
  open: boolean;
  onClose: () => void;
  customers: Customer[];
  onTab: (t: CrmTab) => void;
  onFilter: (f: CustomerFilter) => void;
  onOpenCustomer: (id: number) => void;
}) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const q = norm(text.trim());
    const done = (fn: () => void) => () => {
      fn();
      onClose();
    };
    const nav: Item[] = (
      [
        ['resumen', 'Ir a Resumen'],
        ['clientes', 'Ir a Clientes'],
        ['segmentos', 'Ir a Segmentos'],
        ['aprobaciones', 'Aprobar mensajes del agente'],
        ['importar', 'Importar ventas'],
        ['estructura', 'Editar estructura (campos, etapas, etiquetas)']
      ] as [CrmTab, string][]
    ).map(([t, label]) => ({ id: `nav-${t}`, group: 'Ir a', label, run: done(() => onTab(t)) }));

    const recs: Item[] = (Object.keys(RECURRENCE_INFO) as Recurrence[]).map((r) => ({
      id: `rec-${r}`,
      group: 'Tipo',
      label: `Mostrar: ${RECURRENCE_INFO[r].label}`,
      hint: RECURRENCE_INFO[r].hint,
      run: done(() => onFilter({ recurrence: [r] }))
    }));
    const segs: Item[] = (Object.keys(SEGMENT_INFO) as Segment[]).map((s) => ({
      id: `seg-${s}`,
      group: 'Valor',
      label: `Mostrar: ${SEGMENT_INFO[s].label}`,
      hint: SEGMENT_INFO[s].hint,
      run: done(() => onFilter({ rfm: [s] }))
    }));
    const cities: Item[] = cityOptions(customers).map((c) => ({
      id: `city-${c.name}`,
      group: 'Ciudad',
      label: `Clientes de ${c.name}`,
      hint: `${c.count} clientes`,
      run: done(() => onFilter({ cities: [c.name] }))
    }));

    if (!q) return [...nav, recs.find((r) => r.id === 'rec-por_recomprar')!, ...recs.filter((r) => r.id !== 'rec-por_recomprar'), ...segs];

    const byWords = [
      ...(Object.keys(RECURRENCE_WORDS) as Recurrence[])
        .filter((r) => RECURRENCE_WORDS[r].some((w) => q.includes(w) || (q.length >= 3 && w.startsWith(q))))
        .map((r) => recs.find((x) => x.id === `rec-${r}`)!),
      ...(Object.keys(RFM_WORDS) as Segment[])
        .filter((s) => RFM_WORDS[s].some((w) => q.includes(w) || (q.length >= 3 && w.startsWith(q))))
        .map((s) => segs.find((x) => x.id === `seg-${s}`)!)
    ];
    const cityHits = cities.filter((c) => norm(c.label).includes(q)).slice(0, 3);

    const digits = q.replace(/\D/g, '');
    const people: Item[] = customers
      .filter((c) => norm(c.name).includes(q) || (digits.length >= 3 && c.phone.includes(digits)))
      .slice(0, 5)
      .map((c) => ({
        id: `c-${c.id}`,
        group: 'Cliente',
        label: c.name || `+${c.phone}`,
        hint: `${RECURRENCE_INFO[c.recurrence].label}${c.city ? ` · ${c.city}` : ''} · potencial ${c.score}`,
        run: done(() => onOpenCustomer(c.id))
      }));

    if (/respuesta|esperan|contestar|pendiente|responder/.test(q)) {
      byWords.unshift({
        id: 'awaiting',
        group: 'Chats',
        label: 'Mostrar: Esperan tu respuesta',
        hint: 'Te escribieron y aún no contestas',
        run: done(() => onFilter({ awaiting: true }))
      });
    }
    const shown = new Set([...byWords, ...cityHits].map((i) => i.id));
    const rest = [...nav, ...recs, ...segs].filter((i) => norm(i.label).includes(q) && !shown.has(i.id));
    return [...byWords, ...people, ...cityHits, ...rest];
  }, [text, customers, onClose, onTab, onFilter, onOpenCustomer]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') items[active]?.run();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[15vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Barra de comandos"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border/60 bg-popover shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            autoFocus
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
            }}
            placeholder="Escribe: “le toca”, “fieles”, “Bogotá”, un nombre…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul className="max-h-80 overflow-auto p-2">
          {items.length === 0 && <li className="p-3 text-sm text-muted-foreground">Sin resultados.</li>}
          {items.map((it, i) => (
            <li key={it.id}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={it.run}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === active ? 'bg-accent' : ''}`}
              >
                <span className="w-20 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{it.group}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{it.label}</span>
                  {it.hint && <span className="block truncate text-xs text-muted-foreground">{it.hint}</span>}
                </span>
                {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
