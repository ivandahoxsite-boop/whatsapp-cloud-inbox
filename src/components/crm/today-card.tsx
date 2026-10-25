'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import type { TodayBoard } from '@/lib/crm/today';
import { PENDING_INFO, type PendingReason } from '@/lib/crm/pending-info';
import { dueLabel } from '@/lib/crm/tasks-info';
import { api, card, money } from './shared';

const REASON_COLOR: Record<PendingReason, string> = { sin_respuesta: 'text-rose-400', en_el_aire: 'text-amber-500', cotizacion: 'text-sky-400' };
const h3 = 'mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground';
const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
const ampm = (t: string) => `${Number(t.slice(0, 2)) % 12 || 12}:${t.slice(3)} ${Number(t.slice(0, 2)) < 12 ? 'am' : 'pm'}`;

/** Top of the Resumen tab: everything for today in one place, so nothing has to arrive as a notification. */
export function TodayCard({ onPending, onOpenCustomer }: { onPending: () => void; onOpenCustomer: (id: number) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['crm-today'], queryFn: () => api<TodayBoard>('/api/crm/today') });
  if (!data) return null;

  const done = async (id: number) => {
    await api('/api/crm/tasks', 'PATCH', { id, action: 'done' });
    await Promise.all([qc.invalidateQueries({ queryKey: ['crm-today'] }), qc.invalidateQueries({ queryKey: ['crm-tasks'] })]);
  };
  const chatTotal = Object.values(data.chats).reduce((a, n) => a + n, 0);
  const empty = !data.tasks.length && !chatTotal && !data.promisesToday.length && !data.promisesBroken.length && !data.calls.length;

  return (
    <section className={cn(card, 'space-y-4')}>
      <div className="flex items-baseline gap-2">
        <h2 className="min-w-0 flex-1 text-sm font-medium">📋 Hoy</h2>
        <button onClick={onPending} className="shrink-0 text-xs underline">
          Ver Pendientes
        </button>
      </div>
      {data.restDay && <p className="text-xs text-muted-foreground">Hoy es domingo o festivo: descansa, esto puede esperar.</p>}
      {empty && <p className="text-sm text-muted-foreground">Nada pendiente para hoy ✨</p>}

      {data.tasks.length > 0 && (
        <div>
          <h3 className={h3}>Mis pendientes ({data.tasks.length})</h3>
          <ul className="space-y-1.5">
            {data.tasks.slice(0, 6).map((t) => {
              const label = dueLabel(t.dueDate, data.today, t.dueTime);
              return (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <button onClick={() => done(t.id)} aria-label="Marcar hecho" className="h-7 w-7 shrink-0 rounded-full border text-xs text-emerald-400">
                    ✓
                  </button>
                  <button onClick={() => (t.contactId ? onOpenCustomer(t.contactId) : onPending())} className="min-w-0 flex-1 text-left">
                    <span className="block truncate">{t.text}</span>
                    <span className={cn('block truncate text-xs', label.startsWith('Atrasado') ? 'text-rose-400' : 'text-muted-foreground')}>
                      {label}
                      {t.name ? ` · ${t.name}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {data.tasks.length > 6 && (
            <button onClick={onPending} className="mt-1 text-xs underline">
              y {data.tasks.length - 6} más
            </button>
          )}
        </div>
      )}

      {chatTotal > 0 && (
        <div>
          <h3 className={h3}>Chats por atender ({chatTotal})</h3>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(PENDING_INFO) as PendingReason[])
              .filter((r) => data.chats[r] > 0)
              .map((r) => (
                <button key={r} onClick={onPending} className="rounded-full border px-3 py-1 text-xs">
                  <span className={cn('font-semibold tabular-nums', REASON_COLOR[r])}>{data.chats[r]}</span> {PENDING_INFO[r].label}
                </button>
              ))}
          </div>
        </div>
      )}

      {(data.promisesToday.length > 0 || data.promisesBroken.length > 0) && (
        <div>
          <h3 className={h3}>Promesas de pago</h3>
          <ul className="space-y-1 text-sm">
            {data.promisesToday.map((p) => (
              <li key={`t${p.id}`}>
                <button onClick={() => onOpenCustomer(p.id)} className="text-left">
                  📞 {p.name || 'Cliente'} prometió pagar hoy{p.amount ? ` $${money(p.amount)}` : ''}
                </button>
              </li>
            ))}
            {data.promisesBroken.map((p) => (
              <li key={`b${p.id}`}>
                <button onClick={() => onOpenCustomer(p.id)} className="text-left text-rose-400">
                  ⚠️ {p.name || 'Cliente'} prometió el {shortDay(p.due)} y no ha pagado
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.calls.length > 0 && (
        <div>
          <h3 className={h3}>Llamadas programadas</h3>
          <ul className="space-y-1 text-sm">
            {data.calls.map((c) => (
              <li key={c.contactId}>
                <button onClick={() => onOpenCustomer(c.contactId)} className="text-left">
                  📅 {ampm(c.time)} · {c.name || 'Cliente'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
