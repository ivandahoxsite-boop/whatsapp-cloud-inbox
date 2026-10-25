'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { REPEAT_LABEL, calendarUrl, dueLabel, type Task } from '@/lib/crm/tasks-info';
import { api, formatPhone } from './shared';
import { DatePick } from './task-form';

export const tasksQuery = (contactId?: number) => ({
  queryKey: contactId ? ['crm-tasks', contactId] : ['crm-tasks'],
  queryFn: () => api<{ today: string; tasks: Task[] }>(`/api/crm/tasks${contactId ? `?contactId=${contactId}` : ''}`)
});

/** One open to-do with its buttons. `showWho` adds the customer's name (not needed inside their own file). */
export function TaskRow({ t, today, showWho, onOpenCustomer }: { t: Task; today: string; showWho: boolean; onOpenCustomer?: (id: number) => void }) {
  const qc = useQueryClient();
  const [moving, setMoving] = useState(false);
  const [err, setErr] = useState('');
  const act = async (body: Record<string, unknown>) => {
    setErr('');
    try {
      await api('/api/crm/tasks', 'PATCH', { id: t.id, ...body });
      await qc.invalidateQueries({ queryKey: ['crm-tasks'] });
      setMoving(false);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const label = dueLabel(t.dueDate, today, t.dueTime);
  const cal = typeof window === 'undefined' ? null : calendarUrl(t, `${window.location.origin}/crm`);
  const late = !!t.dueDate && t.dueDate < today;
  return (
    <li className="rounded-lg border border-border/60 bg-background/40 p-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm">{t.text}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className={cn(late && 'text-rose-400', label === 'Hoy' && 'text-amber-500')}>{label}</span>
            {t.repeat && ` · 🔁 ${REPEAT_LABEL[t.repeat]}`}
            {showWho && t.contactId && (
              <>
                {' · '}
                <button onClick={() => onOpenCustomer?.(t.contactId!)} className="underline">
                  {t.name || formatPhone(t.phone)}
                </button>
              </>
            )}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <button onClick={() => act({ action: 'done' })} className="h-8 rounded-full bg-emerald-500/20 px-3 text-emerald-400">
          ✓ Hecho
        </button>
        {cal && (
          <a href={cal} target="_blank" rel="noreferrer" className="h-8 rounded-full border px-3 leading-8">
            🔔 Calendar
          </a>
        )}
        <button onClick={() => setMoving(!moving)} className="h-8 rounded-full border px-3">
          📅 Mover
        </button>
        <button
          onClick={() => confirm('¿Borrar este pendiente?') && act({ action: 'delete' })}
          className="h-8 rounded-full border px-3 text-muted-foreground"
        >
          Borrar
        </button>
      </div>
      {moving && (
        <div className="mt-2">
          <DatePick value={t.dueDate ?? ''} onChange={(v) => act({ action: 'move', dueDate: v || null })} />
        </div>
      )}
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </li>
  );
}

/** The open to-dos of one customer, for their file. */
export function CustomerTasks({ contactId }: { contactId: number }) {
  const { data } = useQuery(tasksQuery(contactId));
  if (!data || data.tasks.length === 0) return null;
  return (
    <ul className="space-y-2">
      {data.tasks.map((t) => (
        <TaskRow key={t.id} t={t} today={data.today} showWho={false} />
      ))}
    </ul>
  );
}
