'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OutboxItem } from '@/lib/crm/agent-store';
import { Button } from '@/components/ui/button';
import { WhatsAppLink, api, card, checkCollection, formatPhone } from './shared';

type OutboxData = { pending: OutboxItem[]; recent: OutboxItem[] };

/**
 * Reminders whose WhatsApp chat was already opened, so "¿Lo envió?" is still there when the person comes back: on
 * Android wa.me opens in the same tab and the CRM page reloads. Only this browser remembers it.
 */
const OPENED_KEY = 'crm-aprobaciones-abiertos';
function readOpened(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(OPENED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'number') : [];
  } catch {
    return [];
  }
}
function saveOpened(ids: number[]) {
  try {
    localStorage.setItem(OPENED_KEY, JSON.stringify(ids));
  } catch {
    /* private window or blocked storage: the question just does not survive a reload */
  }
}

const STATUS_LABEL: Record<OutboxItem['status'], string> = {
  pending: 'Pendiente',
  sent: '✅ Enviado',
  rejected: 'Descartado',
  failed: 'Falló'
};

/**
 * "Aprobaciones": the reminders queued with "Recordar". Nothing is sent by the CRM: the person opens WhatsApp with the
 * text (after the collection rules), sends it there and then confirms "Ya lo envié", which is what counts as
 * "cobrado esta semana". If the rules say no, the chat opens without the text and the reminder stays pending.
 */
export function ApprovalsView() {
  const qc = useQueryClient();
  const [opened, setOpenedState] = useState<number[]>([]);
  useEffect(() => setOpenedState(readOpened()), []);
  const setOpened = (id: number, on: boolean) =>
    setOpenedState((prev) => {
      const next = on ? [...prev.filter((x) => x !== id), id] : prev.filter((x) => x !== id);
      saveOpened(next);
      return next;
    });
  const [note, setNote] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['crm-outbox'],
    queryFn: () => api<OutboxData>('/api/crm/outbox'),
    refetchInterval: 15_000
  });

  const decide = async (item: OutboxItem, action: 'sent' | 'rejected') => {
    setNote('');
    try {
      await api('/api/crm/outbox', 'PATCH', { id: item.id, action });
      setOpened(item.id, false);
      setNote(action === 'sent' ? `Listo: quedó registrado que le escribió a ${item.contactName || 'el cliente'}.` : 'Recordatorio descartado.');
      qc.invalidateQueries({ queryKey: ['crm-outbox'] });
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (error) return <p className="text-sm text-red-500">{(error as Error).message}</p>;
  const pending = data?.pending ?? [];
  const recent = data?.recent ?? [];

  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className="text-lg font-semibold">Aprobaciones</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Recordatorios creados con «Recordar». El CRM no los envía: tocas «💬 Abrir WhatsApp», lo envías tú y luego confirmas «Ya lo envié».
        </p>
        {note && <p className="mt-2 text-sm text-emerald-500">{note}</p>}
      </section>

      {pending.length === 0 ? (
        <section className={card}>
          <p className="text-sm text-muted-foreground">No hay recordatorios esperando aprobación.</p>
        </section>
      ) : (
        <ul className="space-y-3" data-testid="approvals-pending">
          {pending.map((o) => (
            <li key={o.id} className={card}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">{o.contactName || formatPhone(o.phone)}</span>
                <span className="text-xs text-muted-foreground">{formatPhone(o.phone)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap rounded-xl bg-muted/60 p-3 text-sm">{o.body}</p>
              {opened.includes(o.id) ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-sm">¿Lo envió?</span>
                  <Button size="sm" onClick={() => decide(o, 'sent')}>
                    Sí, ya lo envié
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setOpened(o.id, false)}>
                    Todavía no
                  </Button>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <WhatsAppLink
                    phone={o.phone}
                    text={o.body}
                    beforeOpen={async () => {
                      const r = await checkCollection(o.contactId, { reminder: true });
                      // Only ask "¿Lo envió?" when the chat opens WITH the reminder.
                      if (r === true) setOpened(o.id, true);
                      return r;
                    }}
                    className="inline-flex h-8 items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-500 hover:bg-emerald-500/20"
                  >
                    💬 Abrir WhatsApp
                  </WhatsAppLink>
                  <Button size="sm" variant="outline" onClick={() => decide(o, 'rejected')}>
                    Descartar
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {recent.length > 0 && (
        <section className={card}>
          <h3 className="font-semibold">Últimos decididos</h3>
          <ul className="mt-2 divide-y divide-border/60 text-sm">
            {recent.map((o) => (
              <li key={o.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">{o.contactName || formatPhone(o.phone)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{STATUS_LABEL[o.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
