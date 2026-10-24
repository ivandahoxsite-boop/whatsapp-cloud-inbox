'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { SyncState } from '@/lib/crm/kapso-sync';
import { QUERY_KEY, api, card } from './shared';

export function KapsoSyncCard() {
  const qc = useQueryClient();
  const [err, setErr] = useState('');
  const { data } = useQuery({
    queryKey: ['crm-sync'],
    queryFn: () => api<SyncState>('/api/crm/sync-kapso'),
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

  const start = async () => {
    setErr('');
    try {
      await api('/api/crm/sync-kapso', 'POST');
      await qc.invalidateQueries({ queryKey: ['crm-sync'] });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const oldest = data?.oldestMessageAt ? new Date(data.oldestMessageAt).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <section className={cn(card, 'space-y-3')}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
          <MessageCircle className="h-4 w-4" />
        </span>
        <div className="space-y-1">
          <h2 className="font-medium">Traer historial de WhatsApp (Kapso)</h2>
          <p className="text-sm text-muted-foreground">
            Copia al CRM los chats que Kapso ya tiene guardados: crea los contactos que falten y agrega cada mensaje a su historial (los audios llegan
            transcritos). Solo lee: no envía nada a nadie. Puedes repetirlo cuando quieras; no duplica mensajes.
          </p>
        </div>
      </div>

      {data?.running ? (
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          {data.phase === 'nombres' ? (
            <>Completando nombres de contactos… {data.namesFilled} nombres agregados</>
          ) : (
            <>
              Leyendo… {data.messagesSeen} mensajes revisados, {data.activitiesAdded} nuevos, {data.contactsCreated} contactos nuevos
              {oldest && <span className="text-muted-foreground"> · llegando a {oldest}</span>}
            </>
          )}
        </div>
      ) : (
        <Button onClick={start}>Traer historial</Button>
      )}

      {data && !data.running && data.finishedAt && (
        <p className={cn('text-sm', data.error ? 'text-destructive' : 'text-muted-foreground')}>
          {data.error
            ? `Se detuvo: ${data.error}. Lo ya importado se conserva; puedes intentarlo de nuevo.`
            : `Listo: ${data.messagesSeen} mensajes revisados, ${data.activitiesAdded} agregados, ${data.contactsCreated} contactos nuevos, ${data.namesFilled} nombres completados${oldest ? `, desde ${oldest}` : ''}.`}
        </p>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
    </section>
  );
}
