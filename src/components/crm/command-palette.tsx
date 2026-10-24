'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { SEGMENT_INFO, type Segment } from '@/lib/crm/scoring';
import type { Customer } from '@/lib/crm/customers';

export type CrmTab = 'resumen' | 'clientes' | 'aprobaciones' | 'importar' | 'estructura';

type Item = { id: string; group: string; label: string; hint?: string; run: () => void };

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Plain-language shortcuts so you can type what you want instead of finding a filter.
const SYNONYMS: Record<Segment, string[]> = {
  campeon: ['campeon', 'vip', 'mejores', 'top'],
  leal: ['leal', 'fiel', 'recurrente'],
  potencial: ['potencial', 'nuevo', 'oportunidad', 'vender'],
  en_riesgo: ['riesgo', 'enfria', 'perder'],
  dormido_valioso: ['dormido', 'reactivar', 'inactivo', 'valioso', 'recuperar'],
  perdido: ['perdido'],
  sin_compras: ['sin compra', 'prospecto']
};

export function CommandPalette({
  open,
  onClose,
  customers,
  onTab,
  onSegment,
  onSearch
}: {
  open: boolean;
  onClose: () => void;
  customers: Customer[];
  onTab: (t: CrmTab) => void;
  onSegment: (s: Segment) => void;
  onSearch: (q: string) => void;
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
        ['aprobaciones', 'Aprobar mensajes del agente'],
        ['importar', 'Importar ventas'],
        ['estructura', 'Editar estructura (campos y etapas)']
      ] as [CrmTab, string][]
    ).map(([t, label]) => ({ id: `nav-${t}`, group: 'Ir a', label, run: done(() => onTab(t)) }));

    const segs: Item[] = (Object.keys(SEGMENT_INFO) as Segment[]).map((s) => ({
      id: `seg-${s}`,
      group: 'Segmentos',
      label: `Mostrar: ${SEGMENT_INFO[s].label}`,
      hint: SEGMENT_INFO[s].hint,
      run: done(() => onSegment(s))
    }));

    if (!q) return [...nav, ...segs];

    const bySynonym = (Object.keys(SYNONYMS) as Segment[])
      .filter((s) => SYNONYMS[s].some((w) => q.includes(w) || w.includes(q)))
      .map((s) => segs.find((x) => x.id === `seg-${s}`)!);

    const people: Item[] = customers
      .filter((c) => norm(c.name).includes(q) || c.phone.includes(q.replace(/\D/g, '') || '§'))
      .slice(0, 5)
      .map((c) => ({
        id: `c-${c.id}`,
        group: 'Clientes',
        label: c.name || `+${c.phone}`,
        hint: `${SEGMENT_INFO[c.segment].label} · potencial ${c.score}`,
        run: done(() => onSearch(c.name || c.phone))
      }));

    const rest = [...nav, ...segs].filter((i) => norm(i.label).includes(q) && !bySynonym.includes(i));
    return [...bySynonym, ...people, ...rest];
  }, [text, customers, onClose, onTab, onSegment, onSearch]);

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
            placeholder="Escribe: “reactivar”, “vip”, un nombre o un teléfono…"
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
