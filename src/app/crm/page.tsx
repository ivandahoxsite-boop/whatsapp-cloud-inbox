'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageCircle, Plus, Search, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/theme-toggle';
import { CommandPalette, type CrmTab } from '@/components/crm/command-palette';
import { Overview } from '@/components/crm/overview';
import { SEGMENT_INFO, type Segment } from '@/lib/crm/scoring';
import { parseCsv } from '@/lib/crm/csv';
import type { Customer } from '@/lib/crm/customers';
import type { CustomField, Stage } from '@/lib/crm/db';

type CrmData = { customers: Customer[]; fields: CustomField[]; stages: Stage[] };
type Tab = CrmTab;

const QUERY_KEY = ['crm'] as const;

async function api<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data as T;
}

const money = (n: number) => n.toLocaleString('es', { maximumFractionDigits: 0, useGrouping: 'always' });

const SEGMENT_STYLE: Record<Segment, string> = {
  campeon: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  leal: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  potencial: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  en_riesgo: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  dormido_valioso: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400',
  perdido: 'bg-muted text-muted-foreground',
  sin_compras: 'bg-muted text-muted-foreground'
};

const TAB_LABEL: Record<Tab, string> = {
  resumen: 'Resumen',
  clientes: 'Clientes',
  importar: 'Importar ventas',
  estructura: 'Estructura'
};

export default function CrmPage() {
  const [tab, setTab] = useState<Tab>('resumen');
  const [segment, setSegment] = useState<Segment | 'todos'>('todos');
  const [q, setQ] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { data, error, isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: () => api<CrmData>('/api/crm/customers', 'GET') });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const showSegment = (s: Segment) => {
    setSegment(s);
    setQ('');
    setTab('clientes');
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-0 opacity-60 dark:opacity-100">
        <div className="absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-emerald-500/15 blur-[120px]" />
        <div className="absolute -right-40 top-20 h-[26rem] w-[26rem] rounded-full bg-fuchsia-500/15 blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 h-[24rem] w-[24rem] rounded-full bg-sky-500/10 blur-[120px]" />
      </div>
      <header className="relative z-10 flex flex-wrap items-center gap-3 border-b border-border/60 bg-background/50 px-4 py-3 backdrop-blur-xl">
        <Link href="/" className="text-muted-foreground hover:text-foreground" aria-label="Volver a la bandeja">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">CRM</h1>
        <nav className="flex gap-1">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <Button key={t} size="sm" variant={tab === t ? 'default' : 'ghost'} onClick={() => setTab(t)}>
              {TAB_LABEL[t]}
            </Button>
          ))}
        </nav>
        <button
          onClick={() => setPaletteOpen(true)}
          className="ml-auto flex h-9 items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3 text-sm text-muted-foreground hover:text-foreground"
        >
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">Pregunta o busca…</span>
          <kbd className="rounded border px-1.5 text-[10px]">⌘K</kbd>
        </button>
        <ThemeToggle />
      </header>
      <main className="relative z-10 mx-auto max-w-6xl p-4">
        {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {data && tab === 'resumen' && <Overview customers={data.customers} onSegment={showSegment} />}
        {data && tab === 'clientes' && <Customers data={data} segment={segment} setSegment={setSegment} q={q} setQ={setQ} />}
        {data && tab === 'importar' && <Importer data={data} onDone={() => setTab('resumen')} />}
        {data && tab === 'estructura' && <Structure data={data} />}
      </main>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        customers={data?.customers ?? []}
        onTab={setTab}
        onSegment={showSegment}
        onSearch={(text) => {
          setSegment('todos');
          setQ(text);
          setTab('clientes');
        }}
      />
    </div>
  );
}

function Customers({
  data,
  segment,
  setSegment,
  q,
  setQ
}: {
  data: CrmData;
  segment: Segment | 'todos';
  setSegment: (s: Segment | 'todos') => void;
  q: string;
  setQ: (q: string) => void;
}) {
  const qc = useQueryClient();
  const [sort, setSort] = useState<'score' | 'totalSpent' | 'daysSinceLastSale'>('score');
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState('');
  const contactFields = data.fields.filter((f) => f.entity === 'contact');

  const counts = useMemo(() => {
    const c: Partial<Record<Segment, number>> = {};
    data.customers.forEach((x) => (c[x.segment] = (c[x.segment] ?? 0) + 1));
    return c;
  }, [data.customers]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.customers
      .filter((c) => segment === 'todos' || c.segment === segment)
      .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.phone.includes(needle))
      .sort((a, b) =>
        sort === 'daysSinceLastSale' ? (a.daysSinceLastSale ?? 1e9) - (b.daysSinceLastSale ?? 1e9) : b[sort] - a[sort]
      );
  }, [data.customers, segment, q, sort]);

  const refresh = () => qc.invalidateQueries({ queryKey: QUERY_KEY });
  const run = async (fn: () => Promise<unknown>) => {
    setErr('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (data.customers.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Aún no hay clientes. Ve a <b>Importar ventas</b> para cargar tu historial, o crea uno manualmente.
        </p>
        <AddCustomer {...{ newPhone, setNewPhone, newName, setNewName, run }} />
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={segment === 'todos' ? 'default' : 'outline'} onClick={() => setSegment('todos')}>
          Todos ({data.customers.length})
        </Button>
        {(Object.keys(SEGMENT_INFO) as Segment[])
          .filter((s) => counts[s])
          .map((s) => (
            <Button key={s} size="sm" variant={segment === s ? 'default' : 'outline'} onClick={() => setSegment(s)} title={SEGMENT_INFO[s].hint}>
              {SEGMENT_INFO[s].label} ({counts[s]})
            </Button>
          ))}
      </div>
      {segment !== 'todos' && <p className="text-sm text-muted-foreground">{SEGMENT_INFO[segment].hint}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Buscar nombre o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
        <select
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          <option value="score">Ordenar: potencial</option>
          <option value="totalSpent">Ordenar: total gastado</option>
          <option value="daysSinceLastSale">Ordenar: compra más reciente</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Cliente</th>
              <th className="p-2">Potencial</th>
              <th className="p-2">Segmento</th>
              <th className="p-2 text-right">Compras</th>
              <th className="p-2 text-right">Total</th>
              <th className="p-2 text-right">Última compra</th>
              <th className="p-2">Etapa</th>
              {contactFields.map((f) => (
                <th key={f.id} className="p-2">
                  {f.label}
                </th>
              ))}
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-2">
                  <div className="font-medium">{c.name || '—'}</div>
                  <div className="text-xs text-muted-foreground">+{c.phone}</div>
                </td>
                <td className="p-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${c.score}%` }} />
                    </div>
                    <span className="tabular-nums">{c.score}</span>
                  </div>
                </td>
                <td className="p-2">
                  <Badge className={SEGMENT_STYLE[c.segment]}>{SEGMENT_INFO[c.segment].label}</Badge>
                </td>
                <td className="p-2 text-right tabular-nums">{c.salesCount}</td>
                <td className="p-2 text-right tabular-nums">{money(c.totalSpent)}</td>
                <td className="p-2 text-right text-xs text-muted-foreground">
                  {c.daysSinceLastSale === null ? '—' : `hace ${c.daysSinceLastSale} d`}
                </td>
                <td className="p-2">
                  <select
                    className="h-8 rounded-md border bg-transparent px-1 text-xs"
                    value={c.stageId ?? ''}
                    onChange={(e) =>
                      run(() => api('/api/crm/customers', 'PATCH', { id: c.id, stageId: e.target.value ? Number(e.target.value) : null }))
                    }
                  >
                    <option value="">—</option>
                    {data.stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </td>
                {contactFields.map((f) => (
                  <td key={f.id} className="p-2">
                    <FieldInput
                      field={f}
                      value={String(c.data[f.key] ?? '')}
                      onSave={(v) => run(() => api('/api/crm/customers', 'PATCH', { id: c.id, data: { [f.key]: v } }))}
                    />
                  </td>
                ))}
                <td className="p-2">
                  <div className="flex gap-1">
                    <a
                      href={`https://wa.me/${c.phone}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
                      aria-label="Abrir WhatsApp"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </a>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label="Eliminar"
                      onClick={() => confirm(`¿Eliminar a ${c.name || c.phone} y sus ventas?`) && run(() => api('/api/crm/customers', 'DELETE', { id: c.id }))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddCustomer {...{ newPhone, setNewPhone, newName, setNewName, run }} />
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}

function AddCustomer(props: {
  newPhone: string;
  setNewPhone: (v: string) => void;
  newName: string;
  setNewName: (v: string) => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Input className="max-w-[12rem]" placeholder="Teléfono (con país)" value={props.newPhone} onChange={(e) => props.setNewPhone(e.target.value)} />
      <Input className="max-w-xs" placeholder="Nombre" value={props.newName} onChange={(e) => props.setNewName(e.target.value)} />
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          props.run(async () => {
            await api('/api/crm/customers', 'POST', { phone: props.newPhone, name: props.newName });
            props.setNewPhone('');
            props.setNewName('');
          })
        }
      >
        <Plus className="mr-1 h-4 w-4" /> Agregar cliente
      </Button>
    </div>
  );
}

function FieldInput({ field, value, onSave }: { field: CustomField; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  if (field.type === 'select') {
    return (
      <select
        className="h-8 rounded-md border bg-transparent px-1 text-xs"
        value={v}
        onChange={(e) => {
          setV(e.target.value);
          onSave(e.target.value);
        }}
      >
        <option value="" />
        {field.options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  }
  return (
    <Input
      className="h-8 min-w-24 text-xs"
      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
    />
  );
}

// ---- Import ----------------------------------------------------------------

const BASE_TARGETS: { value: string; label: string }[] = [
  { value: 'ignore', label: '— Ignorar —' },
  { value: 'phone', label: 'Teléfono *' },
  { value: 'sold_at', label: 'Fecha de venta *' },
  { value: 'name', label: 'Nombre del cliente' },
  { value: 'amount', label: 'Monto' },
  { value: 'product', label: 'Producto' }
];

function guessTarget(header: string): string {
  const h = header.toLowerCase();
  if (/tel|phone|cel|whats|móvil|movil/.test(h)) return 'phone';
  if (/fecha|date/.test(h)) return 'sold_at';
  if (/nombre|name|cliente/.test(h)) return 'name';
  if (/monto|total|importe|amount|precio|valor/.test(h)) return 'amount';
  if (/producto|product|art[ií]culo|item|servicio/.test(h)) return 'product';
  return 'ignore';
}

function Importer({ data, onDone }: { data: CrmData; onDone: () => void }) {
  const qc = useQueryClient();
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; skipped?: { row: number; reason: string }[] } | null>(null);

  const onFile = async (file: File) => {
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) return setMsg({ ok: false, text: 'El archivo está vacío o no es un CSV válido.' });
    const [head, ...body] = parsed;
    setColumns(head);
    setRows(body);
    setMapping(Object.fromEntries(head.map((h) => [h, guessTarget(h)])));
    setMsg(null);
  };

  const targetsFor = (header: string) => {
    const customs = data.fields.map((f) => ({ value: `${f.entity}:${f.key}`, label: `${f.entity === 'contact' ? 'Cliente' : 'Venta'}: ${f.label}` }));
    return [
      ...BASE_TARGETS,
      ...customs,
      { value: `new_contact:${header}`, label: `+ Nuevo campo de cliente “${header}”` },
      { value: `new_sale:${header}`, label: `+ Nuevo campo de venta “${header}”` }
    ];
  };

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      // Create any new custom fields requested in the mapping first.
      const final: Record<string, string> = {};
      for (const col of columns) {
        const t = mapping[col] ?? 'ignore';
        if (t.startsWith('new_')) {
          const entity = t.startsWith('new_contact') ? 'contact' : 'sale';
          const { field } = await api<{ field: CustomField }>('/api/crm/fields', 'POST', { entity, label: col });
          final[col] = `${entity}:${field.key}`;
        } else final[col] = t;
      }
      const r = await api<{ rows: number; salesCreated: number; contactsCreated: number; contactsUpdated: number; skipped: { row: number; reason: string }[] }>(
        '/api/crm/import',
        'POST',
        { columns, mapping: final, rows }
      );
      await qc.invalidateQueries({ queryKey: QUERY_KEY });
      setMsg({
        ok: true,
        text: `${r.salesCreated} ventas importadas · ${r.contactsCreated} clientes nuevos · ${r.contactsUpdated} actualizados · ${r.skipped.length} filas omitidas`,
        skipped: r.skipped
      });
      if (r.skipped.length === 0) setTimeout(onDone, 1200);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Sube un CSV con tus ventas pasadas (una fila por venta). Necesita al menos <b>teléfono</b> y <b>fecha</b>. Si un teléfono ya existe, la venta se suma a ese cliente.
        Fechas: <code>2024-03-15</code> o <code>15/03/2024</code>.
      </p>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
        <Upload className="h-4 w-4" /> Elegir archivo CSV
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>

      {columns.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">Columna del archivo</th>
                  <th className="p-2">Ejemplo</th>
                  <th className="p-2">Guardar como</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((col, i) => (
                  <tr key={col + i} className="border-t">
                    <td className="p-2 font-medium">{col}</td>
                    <td className="max-w-48 truncate p-2 text-muted-foreground">{rows[0]?.[i]}</td>
                    <td className="p-2">
                      <select
                        className="h-8 rounded-md border bg-transparent px-1 text-sm"
                        value={mapping[col]}
                        onChange={(e) => setMapping({ ...mapping, [col]: e.target.value })}
                      >
                        {targetsFor(col).map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Importando…' : `Importar ${rows.length} filas`}
          </Button>
        </>
      )}

      {msg && (
        <div className={msg.ok ? 'text-sm' : 'text-sm text-destructive'}>
          <p>{msg.text}</p>
          {msg.skipped && msg.skipped.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-auto text-xs text-muted-foreground">
              {msg.skipped.slice(0, 50).map((s) => (
                <li key={s.row}>
                  Fila {s.row}: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Structure -------------------------------------------------------------

function Structure({ data }: { data: CrmData }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: QUERY_KEY });
  const [err, setErr] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    setErr('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const [label, setLabel] = useState('');
  const [entity, setEntity] = useState<'contact' | 'sale'>('contact');
  const [type, setType] = useState('text');
  const [options, setOptions] = useState('');
  const [stage, setStage] = useState('');

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section className="space-y-3">
        <h2 className="font-semibold">Campos personalizados</h2>
        <p className="text-sm text-muted-foreground">
          Agrega o quita campos cuando lo necesites. Los de cliente aparecen como columnas editables; los de venta se llenan al importar.
        </p>
        <ul className="space-y-1">
          {data.fields.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
              <Badge variant="outline">{f.entity === 'contact' ? 'Cliente' : 'Venta'}</Badge>
              <span className="font-medium">{f.label}</span>
              <span className="text-xs text-muted-foreground">
                {f.type}
                {f.type === 'select' && `: ${f.options.join(', ')}`}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="ml-auto h-7 w-7"
                aria-label="Eliminar campo"
                onClick={() => confirm(`¿Eliminar el campo “${f.label}”? Los valores guardados dejarán de mostrarse.`) && run(() => api('/api/crm/fields', 'DELETE', { id: f.id }))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
          {data.fields.length === 0 && <li className="text-sm text-muted-foreground">Sin campos todavía.</li>}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-40" placeholder="Nombre del campo" value={label} onChange={(e) => setLabel(e.target.value)} />
          <select className="h-9 rounded-md border bg-transparent px-2 text-sm" value={entity} onChange={(e) => setEntity(e.target.value as 'contact' | 'sale')}>
            <option value="contact">Cliente</option>
            <option value="sale">Venta</option>
          </select>
          <select className="h-9 rounded-md border bg-transparent px-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="text">Texto</option>
            <option value="number">Número</option>
            <option value="date">Fecha</option>
            <option value="select">Lista</option>
          </select>
          {type === 'select' && <Input className="max-w-48" placeholder="Opciones, separadas por coma" value={options} onChange={(e) => setOptions(e.target.value)} />}
          <Button
            size="sm"
            onClick={() =>
              run(async () => {
                await api('/api/crm/fields', 'POST', {
                  entity,
                  label,
                  type,
                  options: type === 'select' ? options.split(',').map((o) => o.trim()).filter(Boolean) : []
                });
                setLabel('');
                setOptions('');
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" /> Agregar
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Etapas del pipeline</h2>
        <ul className="space-y-1">
          {data.stages.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
              <Input
                className="h-7 border-0 bg-transparent px-1 shadow-none"
                defaultValue={s.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && run(() => api('/api/crm/stages', 'PATCH', { id: s.id, name: e.target.value }))}
              />
              <Button
                size="icon"
                variant="ghost"
                className="ml-auto h-7 w-7"
                aria-label="Eliminar etapa"
                onClick={() => run(() => api('/api/crm/stages', 'DELETE', { id: s.id }))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input className="max-w-48" placeholder="Nueva etapa" value={stage} onChange={(e) => setStage(e.target.value)} />
          <Button
            size="sm"
            onClick={() =>
              run(async () => {
                await api('/api/crm/stages', 'POST', { name: stage });
                setStage('');
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" /> Agregar
          </Button>
        </div>
      </section>
      {err && <p className="text-sm text-destructive md:col-span-2">{err}</p>}
    </div>
  );
}
