'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QUERY_KEY, api, type CrmData } from './shared';

// ---- Structure -------------------------------------------------------------

export function Structure({ data }: { data: CrmData }) {
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
      <section className="space-y-3 md:col-span-2">
        <h2 className="font-semibold">Etiquetas</h2>
        <p className="text-sm text-muted-foreground">
          Se crean desde la ficha del cliente o al etiquetar varios en Clientes. Aquí puedes renombrarlas, cambiar su color o borrarlas.
        </p>
        {data.tags.length === 0 && <p className="text-sm text-muted-foreground">Sin etiquetas todavía.</p>}
        <ul className="grid gap-1 sm:grid-cols-2">
          {data.tags.map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
              <input
                type="color"
                defaultValue={t.color || '#a1a1aa'}
                onBlur={(e) => e.target.value !== t.color && run(() => api('/api/crm/tags', 'PATCH', { id: t.id, color: e.target.value }))}
                className="h-6 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                aria-label={`Color de ${t.name}`}
              />
              <Input
                className="h-7 border-0 bg-transparent px-1 shadow-none"
                defaultValue={t.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && run(() => api('/api/crm/tags', 'PATCH', { id: t.id, name: e.target.value }))}
              />
              <span className="shrink-0 text-xs text-muted-foreground">{t.count}</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label="Eliminar etiqueta"
                onClick={() => confirm(`¿Eliminar la etiqueta “${t.name}”? Se quitará de ${t.count} clientes.`) && run(() => api('/api/crm/tags', 'DELETE', { id: t.id }))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      </section>
      {err && <p className="text-sm text-destructive md:col-span-2">{err}</p>}
    </div>
  );
}
