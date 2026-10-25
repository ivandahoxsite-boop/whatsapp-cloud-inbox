'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { PENDING_INFO, type PendingChat, type PendingReason } from '@/lib/crm/pending';
import { api, card, formatPhone, relativeDays } from './shared';

const REASON_COLOR: Record<PendingReason, string> = { sin_respuesta: 'text-rose-400', en_el_aire: 'text-amber-500', cotizacion: 'text-sky-400' };

export function PendingView({ onOpenCustomer }: { onOpenCustomer: (id: number) => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState<PendingReason | ''>('');
  const [error, setError] = useState('');
  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['crm-pending'],
    queryFn: () => api<{ chats: PendingChat[] }>('/api/crm/pending')
  });

  const close = async (contactId: number, kind: 'resolved' | 'ignored') => {
    setError('');
    try {
      await api('/api/crm/pending', 'POST', { contactId, kind });
      qc.invalidateQueries({ queryKey: ['crm-pending'] });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Buscando chats pendientes…</p>;
  if (loadError) return <p className="text-sm text-destructive">{(loadError as Error).message}</p>;
  const all = data?.chats ?? [];
  const chats = reason ? all.filter((c) => c.reason === reason) : all;
  const count = (r: PendingReason) => all.filter((c) => c.reason === r).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {(Object.keys(PENDING_INFO) as PendingReason[]).map((r) => (
          <button
            key={r}
            onClick={() => setReason(reason === r ? '' : r)}
            aria-pressed={reason === r}
            className={cn(card, 'text-left transition-colors', reason === r && 'border-emerald-400/60 bg-emerald-400/10', reason && reason !== r && 'opacity-50')}
          >
            <p className="text-xs text-muted-foreground">{PENDING_INFO[r].label}</p>
            <p className={cn('mt-1 text-xl font-semibold tabular-nums', REASON_COLOR[r])}>{count(r)}</p>
          </button>
        ))}
      </div>

      <section className={card}>
        <h2 className="text-sm font-medium">Chats pendientes · últimos 90 días</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Toca un cuadro para filtrar. <b>Resuelto</b> o <b>Ignorar</b> lo saca de la lista; si el cliente vuelve a escribir, reaparece solo.
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
                  <a href={`https://wa.me/${c.phone}`} target="_blank" rel="noreferrer" className="h-8 rounded-full border px-3 leading-8">
                    WhatsApp
                  </a>
                )}
                <button onClick={() => close(c.contactId, 'resolved')} className="h-8 rounded-full bg-emerald-500/20 px-3 text-emerald-400">
                  ✓ Resuelto
                </button>
                <button onClick={() => close(c.contactId, 'ignored')} className="h-8 rounded-full border px-3 text-muted-foreground">
                  Ignorar
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
