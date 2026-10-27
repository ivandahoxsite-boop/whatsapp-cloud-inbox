'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { PENDING_INFO, type PendingChat, type PendingReason } from '@/lib/crm/pending-info';
import { Hourglass, MessageCircleQuestion, MessageSquareDashed } from 'lucide-react';
import { Stat, WhatsAppLink, api, card, formatPhone, relativeDays, useCrmData, type Tone } from './shared';
import { DatePick, TaskForm } from './task-form';
import { TaskRow, tasksQuery } from './task-list';
import { dayProblem, nextMonday, todayCo } from '@/lib/crm/tasks-info';

const REASON_COLOR: Record<PendingReason, string> = { sin_respuesta: 'text-rose-500', en_el_aire: 'text-amber-500', cotizacion: 'text-sky-500' };
const REASON_STYLE: Record<PendingReason, { tone: Tone; icon: React.ComponentType<{ className?: string }> }> = {
  sin_respuesta: { tone: 'red', icon: Hourglass },
  en_el_aire: { tone: 'amber', icon: MessageSquareDashed },
  cotizacion: { tone: 'blue', icon: MessageCircleQuestion }
};

export function PendingView({ onOpenCustomer }: { onOpenCustomer: (id: number) => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState<PendingReason | ''>('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [later, setLater] = useState<{ id: number; date: string } | null>(null); // detected chat being moved to another day
  const { data: crm } = useCrmData();
  const { data: tdata } = useQuery(tasksQuery());
  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['crm-pending'],
    queryFn: () => api<{ chats: PendingChat[]; muted: { contactId: number; name: string; phone: string }[] }>('/api/crm/pending')
  });

  const close = async (contactId: number, kind: 'resolved' | 'ignored' | 'muted' | 'unmuted') => {
    setError('');
    try {
      await api('/api/crm/pending', 'POST', { contactId, kind });
      qc.invalidateQueries({ queryKey: ['crm-pending'] });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const postpone = async (c: PendingChat, date: string) => {
    setError('');
    try {
      const snippet = c.text.length > 80 ? `${c.text.slice(0, 80)}…` : c.text;
      await api('/api/crm/tasks', 'POST', {
        contactId: c.contactId,
        text: c.reason === 'en_el_aire' ? `Cumplir lo que le dije: ${snippet}` : `Responderle: ${snippet}`,
        dueDate: date || null
      });
      await api('/api/crm/pending', 'POST', { contactId: c.contactId, kind: 'resolved' });
      setLater(null);
      await Promise.all([qc.invalidateQueries({ queryKey: ['crm-pending'] }), qc.invalidateQueries({ queryKey: ['crm-tasks'] })]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Buscando chats pendientes…</p>;
  if (loadError) return <p className="text-sm text-destructive">{(loadError as Error).message}</p>;
  const all = data?.chats ?? [];
  const chats = reason ? all.filter((c) => c.reason === reason) : all;
  const count = (r: PendingReason) => all.filter((c) => c.reason === r).length;

  const today = tdata?.today ?? todayCo();
  const tasks = tdata?.tasks ?? [];
  const groups: [string, typeof tasks][] = [
    ['Atrasados y de hoy', tasks.filter((t) => t.dueDate && t.dueDate <= today)],
    ['Próximos', tasks.filter((t) => t.dueDate && t.dueDate > today)],
    ['Sin fecha', tasks.filter((t) => !t.dueDate)]
  ];

  return (
    <div className="space-y-4">
      <section className={card}>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="min-w-0 flex-1 text-sm font-medium">Mis pendientes</h2>
          <button onClick={() => setAdding(!adding)} className="h-8 shrink-0 rounded-full bg-primary px-3 text-xs text-primary-foreground">
            + Nuevo
          </button>
        </div>
        {adding && (
          <div className="mb-3">
            <TaskForm customers={crm?.customers} onDone={() => setAdding(false)} />
          </div>
        )}
        {tasks.length === 0 && !adding && (
          <p className="text-xs text-muted-foreground">Aún no has anotado nada. Toca <b>+ Nuevo</b> (ej: «Llevarle el imán a Jesús», lunes).</p>
        )}
        {groups.map(
          ([title, list]) =>
            list.length > 0 && (
              <div key={title} className="mb-3 last:mb-0">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
                <ul className="space-y-2">
                  {list.map((t) => (
                    <TaskRow key={t.id} t={t} today={today} showWho onOpenCustomer={onOpenCustomer} />
                  ))}
                </ul>
              </div>
            )
        )}
      </section>

      <div className="grid grid-cols-3 gap-3">
        {(Object.keys(PENDING_INFO) as PendingReason[]).map((r) => (
          <Stat
            key={r}
            label={PENDING_INFO[r].label}
            value={count(r)}
            tone={REASON_STYLE[r].tone}
            icon={REASON_STYLE[r].icon}
            colorValue
            compact
            active={reason === r}
            onClick={() => setReason(reason === r ? '' : r)}
            className={cn(reason && reason !== r && 'opacity-50')}
          />
        ))}
      </div>

      <section className={card}>
        <h2 className="text-sm font-medium">Chats por atender · últimos 90 días</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Toca un cuadro para filtrar. <b>Resuelto</b> lo saca hasta que el cliente vuelva a escribir. <b>Ignorar</b> lo saca para siempre (se deshace abajo, en «Ocultos»).
        </p>
        {error && <p className="mb-3 rounded-md border bg-background/40 p-2 text-xs text-destructive">{error}</p>}
        <ul className="space-y-2">
          {chats.length === 0 && <li className="text-xs text-muted-foreground">{all.length === 0 ? 'No hay chats pendientes. 🎉' : 'Nada en este grupo.'}</li>}
          {chats.map((c) => (
            <li key={c.contactId} className="rounded-lg border border-border/60 bg-background/40 p-2">
              <button onClick={() => onOpenCustomer(c.contactId)} className="block w-full min-w-0 text-left">
                <div className="flex items-baseline gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{c.name || formatPhone(c.phone)}</p>
                  <span className={cn('shrink-0 text-xs', REASON_COLOR[c.reason])}>{PENDING_INFO[c.reason].label}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {c.reason === 'en_el_aire' ? 'Tú: ' : 'Cliente: '}
                  {c.text || '—'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{relativeDays(c.days)}</p>
              </button>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {c.hasPhone && (
                  <WhatsAppLink phone={c.phone} className="h-8 rounded-full border px-3 leading-8">
                    WhatsApp
                  </WhatsAppLink>
                )}
                <button onClick={() => close(c.contactId, 'resolved')} className="h-8 rounded-full bg-emerald-500/20 px-3 text-emerald-400">
                  ✓ Resuelto
                </button>
                <button onClick={() => setLater(later?.id === c.contactId ? null : { id: c.contactId, date: nextMonday(todayCo()) })} className="h-8 rounded-full border px-3">
                  📅 Otro día
                </button>
                <button onClick={() => close(c.contactId, 'muted')} className="h-8 rounded-full border px-3 text-muted-foreground">
                  Ignorar
                </button>
              </div>
              {later?.id === c.contactId && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-muted-foreground">Lo paso a Mis pendientes con esta fecha y sale de esta lista.</p>
                  <DatePick value={later.date} allowNone={false} onChange={(v) => setLater({ id: c.contactId, date: v })} />
                  <button disabled={!later.date || !!dayProblem(later.date)} onClick={() => postpone(c, later.date)} className="h-8 rounded-full bg-primary px-3 text-xs text-primary-foreground disabled:opacity-50">
                    Guardar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {(data?.muted.length ?? 0) > 0 && (
        <details className={card}>
          <summary className="cursor-pointer text-sm font-medium">Ocultos ({data!.muted.length})</summary>
          <p className="mb-2 mt-1 text-xs text-muted-foreground">Nunca aparecen en Pendientes, aunque escriban. Toca «Mostrar de nuevo» para deshacerlo.</p>
          <ul className="space-y-1.5">
            {data!.muted.map((m) => (
              <li key={m.contactId} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{m.name || formatPhone(m.phone)}</span>
                <button onClick={() => close(m.contactId, 'unmuted')} className="shrink-0 text-xs underline">
                  Mostrar de nuevo
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
