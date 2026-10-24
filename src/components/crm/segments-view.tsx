'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Trash2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RECURRENCE_INFO, SEGMENT_INFO } from '@/lib/crm/scoring';
import { isEmptyFilter, matchesFilter, type CustomerFilter } from '@/lib/crm/filters';
import { FilterBar } from './filter-bar';
import { QUERY_KEY, RECURRENCE_COLOR, SEGMENT_COLOR, api, card, downloadCustomersCsv, money, type CrmData } from './shared';

const QUICK: { name: string; hint: string; color: string; filter: CustomerFilter }[] = [
  { name: 'Esperan tu respuesta', hint: 'Te escribieron y aún no contestas', color: '#f59e0b', filter: { awaiting: true } },
  { name: RECURRENCE_INFO.por_recomprar.label, hint: 'Ya pasaron su ritmo habitual de compra', color: RECURRENCE_COLOR.por_recomprar, filter: { recurrence: ['por_recomprar'] } },
  { name: 'Lograr la 2ª compra', hint: 'Compraron una vez hace poco', color: RECURRENCE_COLOR.primera_compra, filter: { recurrence: ['primera_compra'] } },
  { name: 'Recuperar de una sola compra', hint: 'Compraron una vez y no volvieron', color: RECURRENCE_COLOR.una_vez, filter: { recurrence: ['una_vez'] } },
  { name: 'Recurrentes al día', hint: 'Tus clientes fieles', color: RECURRENCE_COLOR.recurrente, filter: { recurrence: ['recurrente'] } },
  { name: 'Recurrentes perdidos', hint: 'Compraban seguido y dejaron de venir', color: RECURRENCE_COLOR.recurrente_perdido, filter: { recurrence: ['recurrente_perdido'] } },
  { name: SEGMENT_INFO.dormido_valioso.label, hint: 'Gastaron mucho y llevan tiempo sin comprar', color: SEGMENT_COLOR.dormido_valioso, filter: { rfm: ['dormido_valioso'] } },
  { name: 'Compraron este mes', hint: 'Últimos 30 días', color: '#22d3ee', filter: { maxDaysSince: 30 } },
  { name: 'Prospectos', hint: 'Escribieron pero aún no compran', color: RECURRENCE_COLOR.prospecto, filter: { recurrence: ['prospecto'] } }
];

export function describeFilter(f: CustomerFilter, data: CrmData): string[] {
  const out: string[] = [];
  if (f.q) out.push(`“${f.q}”`);
  if (f.recurrence?.length) out.push(f.recurrence.map((r) => RECURRENCE_INFO[r]?.label ?? r).join(' o '));
  if (f.rfm?.length) out.push(f.rfm.map((r) => SEGMENT_INFO[r]?.label ?? r).join(' o '));
  if (f.cities?.length) out.push(f.cities.join(' o '));
  if (f.tags?.length) out.push(f.tags.map((id) => `#${data.tags.find((t) => t.id === id)?.name ?? '?'}`).join(' o '));
  if (f.stages?.length) out.push(f.stages.map((id) => (id === 0 ? 'Sin etapa' : data.stages.find((s) => s.id === id)?.name ?? '?')).join(' o '));
  if (f.maxDaysSince != null) out.push(`compró en ≤ ${f.maxDaysSince} días`);
  if (f.minDaysSince != null) out.push(`sin comprar ≥ ${f.minDaysSince} días`);
  if (f.minSpent != null) out.push(`gastó ≥ ${money(f.minSpent)}`);
  if (f.awaiting) out.push('esperan respuesta');
  return out;
}

export function SegmentsView({
  data,
  draft,
  setDraft,
  onOpen
}: {
  data: CrmData;
  draft: CustomerFilter;
  setDraft: (f: CustomerFilter) => void;
  onOpen: (f: CustomerFilter) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const stats = (f: CustomerFilter) => {
    const list = data.customers.filter((c) => matchesFilter(c, f));
    return { list, count: list.length, revenue: list.reduce((a, c) => a + c.totalSpent, 0) };
  };
  const preview = stats(draft);

  const save = async () => {
    setErr('');
    try {
      await api('/api/crm/segments', 'POST', { name, filter: draft });
      setName('');
      setDraft({});
      await qc.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Segmentos listos</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {QUICK.map((q) => {
            const st = stats(q.filter);
            return (
              <button key={q.name} onClick={() => onOpen(q.filter)} className={cn(card, 'p-3 text-left transition-colors hover:border-primary/50')}>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: q.color }} />
                  <span className="truncate text-sm font-medium">{q.name}</span>
                </div>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{st.count}</p>
                <p className="text-[11px] leading-snug text-muted-foreground">{q.hint}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Tus segmentos</h2>
        {data.segments.length === 0 && <p className="text-sm text-muted-foreground">Aún no guardaste ninguno. Créalo abajo.</p>}
        <ul className="grid gap-2 md:grid-cols-2">
          {data.segments.map((seg) => {
            const st = stats(seg.filter);
            return (
              <li key={seg.id} className={cn(card, 'space-y-2 p-3')}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{seg.name}</p>
                    <p className="text-xs text-muted-foreground">{describeFilter(seg.filter, data).join(' · ') || 'Todos los clientes'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums">{st.count}</p>
                    <p className="text-[11px] text-muted-foreground">{money(st.revenue)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="h-8" onClick={() => onOpen(seg.filter)}>
                    <Users className="h-3.5 w-3.5" /> Ver clientes
                  </Button>
                  <Button size="sm" variant="outline" className="h-8" onClick={() => downloadCustomersCsv(st.list, data, `${seg.name}.csv`)}>
                    <Download className="h-3.5 w-3.5" /> CSV
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-8 text-muted-foreground"
                    aria-label="Eliminar segmento"
                    onClick={async () => {
                      if (!confirm(`¿Eliminar el segmento “${seg.name}”? Los clientes no se borran.`)) return;
                      await api('/api/crm/segments', 'DELETE', { id: seg.id });
                      await qc.invalidateQueries({ queryKey: QUERY_KEY });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={cn(card, 'space-y-3')}>
        <h2 className="font-medium">Crear segmento</h2>
        <p className="text-xs text-muted-foreground">Combina filtros. Por ejemplo: Ciudad = Bogotá + Tipo = Le toca recomprar + Etiqueta = VIP.</p>
        <FilterBar data={data} filter={draft} onChange={setDraft} />
        <p className="text-sm">
          <b>{preview.count}</b> clientes · {money(preview.revenue)} en compras
          {!isEmptyFilter(draft) && <span className="text-muted-foreground"> · {describeFilter(draft, data).join(' · ')}</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (ej: VIP Bogotá por recomprar)" className="max-w-sm" />
          <Button onClick={save} disabled={!name.trim() || isEmptyFilter(draft)}>
            Guardar segmento
          </Button>
          <Button variant="outline" onClick={() => onOpen(draft)} disabled={isEmptyFilter(draft)}>
            Ver estos clientes
          </Button>
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </section>
    </div>
  );
}
