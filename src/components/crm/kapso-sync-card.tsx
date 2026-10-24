'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Loader2, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { SyncMode, SyncStatus } from '@/lib/crm/kapso-sync';
import { QUERY_KEY, ago, api, card } from './shared';

const n = (x: number) => x.toLocaleString('es', { useGrouping: 'always' });

export function KapsoSyncCard() {
  const qc = useQueryClient();
  const [err, setErr] = useState('');
  const { data } = useQuery({
    queryKey: ['crm-sync'],
    queryFn: () => api<SyncStatus>('/api/crm/sync-kapso'),
    // Poll only while the import runs; refresh the customer list when it ends.
    refetchInterval: (q) => (q.state.data?.running ? 1500 : false)
  });
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!data) return;
    if (data.running) wasRunning.current = true;
    else if (wasRunning.current) {
      wasRunning.current = false;
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    }
  }, [data, qc]);

  const start = async (mode: SyncMode) => {
    setErr('');
    try {
      await api('/api/crm/sync-kapso', 'POST', { mode });
      await qc.invalidateQueries({ queryKey: ['crm-sync'] });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const oldest = fmt(data?.oldestMessageAt ?? null);

  return (
    <section className={cn(card, 'space-y-3')}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
          <MessageCircle className="h-4 w-4" />
        </span>
        <div className="space-y-1">
          <h2 className="font-medium">Historial de WhatsApp (Kapso)</h2>
          <p className="text-sm text-muted-foreground">
            Copia al CRM los chats que Kapso tiene guardados (los audios llegan transcritos). Solo lee: no envía nada a nadie. No duplica mensajes, y
            los mensajes nuevos llegan solos por el webhook.
          </p>
        </div>
      </div>

      {data && (
        <div className="flex items-start gap-2 rounded-xl bg-muted/40 p-3 text-sm">
          <Database className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p>
            Guardado en tu CRM: <b>{n(data.totals.contacts)}</b> contactos, <b>{n(data.totals.messages)}</b> mensajes y{' '}
            <b>{n(data.totals.sales)}</b> ventas. Se conserva al actualizar el CRM.
          </p>
        </div>
      )}

      {data?.running ? (
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          {data.phase === 'nombres' ? (
            <span>Completando nombres de contactos… {data.namesFilled} nombres agregados</span>
          ) : (
            <span>
              Leyendo{data.mode === 'incremental' ? ' lo nuevo' : ''}… {n(data.messagesSeen)} mensajes revisados, {n(data.activitiesAdded)} nuevos,{' '}
              {data.contactsCreated} contactos nuevos
              {oldest && <span className="text-muted-foreground"> · llegando a {oldest}</span>}
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => start('incremental')}>Traer solo lo nuevo</Button>
          <Button variant="outline" onClick={() => start('full')}>
            Traer historial completo
          </Button>
        </div>
      )}

      {data && !data.running && data.finishedAt && (
        <p className={cn('text-sm', data.error ? 'text-destructive' : 'text-muted-foreground')}>
          Última importación ({data.mode === 'incremental' ? 'solo lo nuevo' : 'completa'}) {ago(data.finishedAt)}:{' '}
          {data.error
            ? `se detuvo: ${data.error}. Lo ya importado se conserva; puedes intentarlo de nuevo.`
            : `${n(data.messagesSeen)} mensajes revisados, ${n(data.activitiesAdded)} agregados, ${data.contactsCreated} contactos nuevos${
                data.namesFilled ? `, ${data.namesFilled} nombres completados` : ''
              }${oldest ? `, desde ${oldest}` : ''}.`}
        </p>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
    </section>
  );
}
