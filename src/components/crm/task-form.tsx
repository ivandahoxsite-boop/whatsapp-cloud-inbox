'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { addDays, nextMonday, todayCo, type Repeat } from '@/lib/crm/tasks-info';
import { api, displayName } from './shared';

const chip = 'h-8 rounded-full border px-3 text-xs';
const field = 'w-full rounded-md border bg-transparent p-2 text-sm outline-none focus:border-primary/60';

/** Quick day buttons plus a calendar field. `value` is "YYYY-MM-DD" or "" for no date. */
export function DatePick({ value, onChange, allowNone = true }: { value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  const today = todayCo();
  const presets = [
    ['Hoy', today],
    ['Mañana', addDays(today, 1)],
    ['Lunes', nextMonday(today)],
    ['En 1 semana', addDays(today, 7)],
    ...(allowNone ? [['Sin fecha', '']] : [])
  ] as [string, string][];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {presets.map(([label, v]) => (
          <button key={label} type="button" onClick={() => onChange(v)} aria-pressed={value === v} className={cn(chip, value === v && 'border-emerald-400/60 bg-emerald-400/10')}>
            {label}
          </button>
        ))}
      </div>
      <input type="date" value={value} min={today} onChange={(e) => onChange(e.target.value)} className={cn(field, 'h-9 max-w-[11rem] py-0')} aria-label="Fecha" />
    </div>
  );
}

type Pickable = { id: number; name: string; phone: string };

/**
 * Writes a to-do. With `fixed` it belongs to that customer (the file view); with `customers` the user may pick one
 * (or none, for something loose like "comprar cinta").
 */
export function TaskForm({
  fixed,
  customers,
  initialText = '',
  onDone
}: {
  fixed?: number;
  customers?: Pickable[];
  initialText?: string;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState(initialText);
  const [date, setDate] = useState(nextMonday(todayCo()));
  const [repeat, setRepeat] = useState<Repeat>('');
  const [who, setWho] = useState<Pickable | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const matches =
    customers && q.trim().length >= 2 && !who
      ? customers.filter((c) => norm(`${c.name} ${c.phone}`).includes(norm(q.trim()))).slice(0, 6)
      : [];

  const save = async () => {
    setErr('');
    setBusy(true);
    try {
      await api('/api/crm/tasks', 'POST', { text, contactId: fixed ?? who?.id ?? null, dueDate: date || null, repeat });
      await qc.invalidateQueries({ queryKey: ['crm-tasks'] });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-background/40 p-3">
      {!fixed && customers && (
        <div className="space-y-1">
          {who ? (
            <p className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">👤 {displayName(who)}</span>
              <button type="button" onClick={() => setWho(null)} className="shrink-0 text-xs underline">
                Quitar
              </button>
            </p>
          ) : (
            <>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente (opcional): escribe su nombre" className={field} />
              {matches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setWho(c);
                    setQ('');
                  }}
                  className="block w-full truncate rounded-md border px-2 py-1.5 text-left text-sm"
                >
                  {displayName(c)}
                </button>
              ))}
            </>
          )}
        </div>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={300} placeholder="Ej: Llevarle el imán de Jesús" className={field} />
      <DatePick value={date} onChange={setDate} />
      <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)} className={cn(field, 'h-9 max-w-[14rem] py-0')} aria-label="Repetir">
        <option value="">No se repite</option>
        <option value="semanal">Repetir cada semana</option>
        <option value="quincenal">Repetir cada 15 días</option>
        <option value="mensual">Repetir cada mes</option>
      </select>
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !text.trim()} onClick={save} className="h-9 rounded-full bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50">
          Guardar pendiente
        </button>
        <button type="button" onClick={onDone} className="h-9 rounded-full border px-4 text-sm">
          Cancelar
        </button>
      </div>
    </div>
  );
}
