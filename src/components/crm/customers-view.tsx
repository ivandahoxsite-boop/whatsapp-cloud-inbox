'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Download, MapPin, Plus, Save, Tag as TagIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isEmptyFilter, matchesFilter, type CustomerFilter } from '@/lib/crm/filters';
import type { Customer } from '@/lib/crm/customers';
import { FilterBar } from './filter-bar';
import { QUERY_KEY, RecurrencePill, SegmentPill, TagPill, api, card, cityOptions, downloadCustomersCsv, money, relativeDays, type CrmData } from './shared';

type SortKey = 'score' | 'totalSpent' | 'recent' | 'overdue' | 'name';

const SORTS: Record<SortKey, { label: string; fn: (a: Customer, b: Customer) => number }> = {
  score: { label: 'Más potencial', fn: (a, b) => b.score - a.score },
  overdue: { label: 'Más atrasados en recomprar', fn: (a, b) => (b.overdueDays ?? -1e9) - (a.overdueDays ?? -1e9) },
  totalSpent: { label: 'Más gastaron', fn: (a, b) => b.totalSpent - a.totalSpent },
  recent: { label: 'Compra más reciente', fn: (a, b) => (a.daysSinceLastSale ?? 1e9) - (b.daysSinceLastSale ?? 1e9) },
  name: { label: 'Nombre A-Z', fn: (a, b) => a.name.localeCompare(b.name, 'es') }
};

const PAGE = 100;

export function CustomersView({
  data,
  filter,
  setFilter,
  onOpen,
  onSaveSegment
}: {
  data: CrmData;
  filter: CustomerFilter;
  setFilter: (f: CustomerFilter) => void;
  onOpen: (id: number) => void;
  onSaveSegment: (f: CustomerFilter) => void;
}) {
  const qc = useQueryClient();
  const [sort, setSort] = useState<SortKey>('score');
  const [limit, setLimit] = useState(PAGE);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [err, setErr] = useState('');
  const tagById = new Map(data.tags.map((t) => [t.id, t]));
  const stageById = new Map(data.stages.map((s) => [s.id, s.name]));

  const rows = useMemo(
    () => data.customers.filter((c) => matchesFilter(c, filter)).sort(SORTS[sort].fn),
    [data.customers, filter, sort]
  );
  const total = rows.reduce((a, c) => a + c.totalSpent, 0);

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const bulk = async (body: Record<string, unknown>) => {
    setErr('');
    try {
      await api('/api/crm/customers/bulk', 'POST', { ids: [...selected], ...body });
      await qc.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const exitSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  return (
    <div className="space-y-3 pb-24">
      <FilterBar data={data} filter={filter} onChange={(f) => { setFilter(f); setLimit(PAGE); }} />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">
          {rows.length} {rows.length === 1 ? 'cliente' : 'clientes'}
        </span>
        <span className="text-muted-foreground">· {money(total)} en compras</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-8 rounded-full border border-border/60 bg-card/50 px-2 text-xs">
            {(Object.keys(SORTS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORTS[k].label}
              </option>
            ))}
          </select>
          {!isEmptyFilter(filter) && (
            <Button size="sm" variant="outline" className="h-8 rounded-full text-xs" onClick={() => onSaveSegment(filter)}>
              <Save className="h-3.5 w-3.5" /> Guardar segmento
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-8 rounded-full text-xs" onClick={() => downloadCustomersCsv(rows, data)}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
          <Button
            size="sm"
            variant={selecting ? 'default' : 'outline'}
            className="h-8 rounded-full text-xs"
            onClick={() => (selecting ? exitSelection() : setSelecting(true))}
          >
            <CheckSquare className="h-3.5 w-3.5" /> {selecting ? 'Listo' : 'Seleccionar'}
          </Button>
        </div>
      </div>

      {selecting && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <button className="underline" onClick={() => setSelected(new Set(rows.map((r) => r.id)))}>
            Seleccionar los {rows.length}
          </button>
          {selected.size > 0 && (
            <button className="underline" onClick={() => setSelected(new Set())}>
              Ninguno
            </button>
          )}
        </div>
      )}

      {data.customers.length === 0 && (
        <p className={cn(card, 'text-sm text-muted-foreground')}>
          Aún no hay clientes. Importa tus ventas pasadas en <b>Importar</b>, o espera a que te escriban por WhatsApp.
        </p>
      )}

      {/* Phones (also in landscape, ~850px wide) and tablets: cards */}
      <ul className="space-y-2 lg:hidden">
        {rows.slice(0, limit).map((c) => (
          <li key={c.id}>
            <button
              onClick={() => (selecting ? toggle(c.id) : onOpen(c.id))}
              className={cn(card, 'w-full p-3 text-left', selected.has(c.id) && 'border-primary ring-1 ring-primary')}
            >
              <div className="flex items-start gap-2">
                {selecting && <input type="checkbox" readOnly checked={selected.has(c.id)} className="mt-1 accent-primary" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{c.name || `+${c.phone}`}</p>
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{c.score}</span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.city ? `${c.city} · ` : ''}
                    {c.salesCount} compras · {money(c.totalSpent)} · {relativeDays(c.daysSinceLastSale)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <RecurrencePill recurrence={c.recurrence} />
                    <SegmentPill segment={c.segment} />
                    {c.tags.map((id) => tagById.get(id)).filter(Boolean).slice(0, 3).map((t) => <TagPill key={t!.id} tag={t!} />)}
                  </div>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {/* Computers: table */}
      <div className={cn(card, 'hidden overflow-x-auto p-0 lg:block')}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-border/60">
              {selecting && <th className="w-8 p-3" />}
              <th className="p-3">Cliente</th>
              <th className="p-3">Tipo</th>
              <th className="p-3">Valor</th>
              <th className="p-3">Etiquetas</th>
              <th className="p-3 text-right">Compras</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3">Última compra</th>
              <th className="p-3">Próxima</th>
              <th className="p-3">Etapa</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((c) => (
              <tr
                key={c.id}
                onClick={() => (selecting ? toggle(c.id) : onOpen(c.id))}
                className={cn('cursor-pointer border-b border-border/40 last:border-0 hover:bg-accent/40', selected.has(c.id) && 'bg-primary/10')}
              >
                {selecting && (
                  <td className="p-3">
                    <input type="checkbox" readOnly checked={selected.has(c.id)} className="accent-primary" />
                  </td>
                )}
                <td className="p-3">
                  <div className="font-medium">{c.name || '—'}</div>
                  <div className="text-xs text-muted-foreground">
                    +{c.phone}
                    {c.city && (
                      <>
                        {' · '}
                        <MapPin className="inline h-3 w-3" /> {c.city}
                      </>
                    )}
                  </div>
                </td>
                <td className="p-3">
                  <RecurrencePill recurrence={c.recurrence} />
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <SegmentPill segment={c.segment} />
                    <span className="text-xs tabular-nums text-muted-foreground">{c.score}</span>
                  </div>
                </td>
                <td className="p-3">
                  <div className="flex max-w-48 flex-wrap gap-1">
                    {c.tags.map((id) => tagById.get(id)).filter(Boolean).map((t) => <TagPill key={t!.id} tag={t!} />)}
                  </div>
                </td>
                <td className="p-3 text-right tabular-nums">{c.salesCount}</td>
                <td className="p-3 text-right tabular-nums">{money(c.totalSpent)}</td>
                <td className="p-3 text-xs text-muted-foreground">{relativeDays(c.daysSinceLastSale)}</td>
                <td className="p-3 text-xs">
                  {c.overdueDays == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : c.overdueDays > 0 ? (
                    <span className="text-amber-500">{c.overdueDays} d tarde</span>
                  ) : (
                    <span className="text-muted-foreground">en {-c.overdueDays} d</span>
                  )}
                </td>
                <td className="p-3 text-xs text-muted-foreground">{c.stageId ? stageById.get(c.stageId) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > limit && (
        <Button variant="outline" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
          Mostrar más ({rows.length - limit} restantes)
        </Button>
      )}

      <AddCustomer data={data} />
      {err && <p className="text-sm text-destructive">{err}</p>}

      {selecting && selected.size > 0 && <BulkBar data={data} count={selected.size} onAction={bulk} onExport={() => downloadCustomersCsv(rows.filter((r) => selected.has(r.id)), data, 'seleccion.csv')} onClose={exitSelection} />}
    </div>
  );
}

function BulkBar({
  data,
  count,
  onAction,
  onExport,
  onClose
}: {
  data: CrmData;
  count: number;
  onAction: (body: Record<string, unknown>) => Promise<void>;
  onExport: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'tag' | 'city' | 'stage' | null>(null);
  const [value, setValue] = useState('');
  const apply = async () => {
    if (mode === 'tag' && value.trim()) await onAction({ addTags: [value.trim()] });
    if (mode === 'city' && value.trim()) await onAction({ city: value.trim() });
    if (mode === 'stage') await onAction({ stageId: value ? Number(value) : null });
    setMode(null);
    setValue('');
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 p-3 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{count} seleccionados</span>
        {mode === null ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setMode('tag')}>
              <TagIcon className="h-3.5 w-3.5" /> Etiquetar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMode('city')}>
              <MapPin className="h-3.5 w-3.5" /> Ciudad
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMode('stage')}>
              Etapa
            </Button>
            <Button size="sm" variant="outline" onClick={onExport}>
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose} aria-label="Cerrar selección">
              <X className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
          >
            {mode === 'stage' ? (
              <select autoFocus value={value} onChange={(e) => setValue(e.target.value)} className="h-9 flex-1 rounded-md border bg-transparent px-2 text-sm">
                <option value="">Sin etapa</option>
                {data.stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <Input
                  autoFocus
                  list={mode === 'tag' ? 'bulk-tags' : 'bulk-cities'}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={mode === 'tag' ? 'Etiqueta (ej: VIP)' : 'Ciudad (ej: Medellín)'}
                  className="h-9 flex-1"
                />
                <datalist id="bulk-tags">
                  {data.tags.map((t) => (
                    <option key={t.id} value={t.name} />
                  ))}
                </datalist>
                <datalist id="bulk-cities">
                  {cityOptions(data.customers).map((c) => (
                    <option key={c.name} value={c.name} />
                  ))}
                </datalist>
              </>
            )}
            <Button size="sm" type="submit" className="h-9">
              Aplicar
            </Button>
            <Button size="sm" type="button" variant="ghost" className="h-9" onClick={() => setMode(null)}>
              Cancelar
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

function AddCustomer({ data }: { data: CrmData }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [err, setErr] = useState('');

  if (!open)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Nuevo cliente
      </Button>
    );

  return (
    <form
      className={cn(card, 'grid gap-2 sm:grid-cols-4')}
      onSubmit={async (e) => {
        e.preventDefault();
        setErr('');
        try {
          await api('/api/crm/customers', 'POST', { phone, name, city });
          await qc.invalidateQueries({ queryKey: QUERY_KEY });
          setPhone('');
          setName('');
          setCity('');
          setOpen(false);
        } catch (e2) {
          setErr((e2 as Error).message);
        }
      }}
    >
      <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Teléfono con país (57...)" inputMode="tel" />
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" />
      <Input list="add-cities" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ciudad" />
      <datalist id="add-cities">
        {cityOptions(data.customers).map((c) => (
          <option key={c.name} value={c.name} />
        ))}
      </datalist>
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="h-9 flex-1">
          Guardar
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
      {err && <p className="text-sm text-destructive sm:col-span-4">{err}</p>}
    </form>
  );
}
