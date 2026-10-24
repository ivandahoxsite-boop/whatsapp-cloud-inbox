'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from './shared';

// ---- Agent message approvals --------------------------------------------------

type OutboxItem = { id: number; contactName: string; phone: string; body: string; status: 'pending' | 'sent' | 'rejected' | 'failed'; error: string; createdAt: string };

export function Approvals() {
  const qc = useQueryClient();
  const [err, setErr] = useState('');
  const { data } = useQuery({
    queryKey: ['crm-outbox'],
    queryFn: () => api<{ messages: OutboxItem[] }>('/api/crm/outbox', 'GET'),
    refetchInterval: 10_000
  });
  const decide = async (id: number, action: 'approve' | 'reject') => {
    setErr('');
    try {
      await api('/api/crm/outbox', 'POST', { id, action });
    } catch (e) {
      setErr((e as Error).message);
    }
    qc.invalidateQueries({ queryKey: ['crm-outbox'] });
  };
  const items = data?.messages ?? [];
  const pending = items.filter((m) => m.status === 'pending');
  const history = items.filter((m) => m.status !== 'pending');

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Mensajes que tu agente (OpenClaw) propone. No salen por WhatsApp hasta que los apruebas.
      </p>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {pending.length === 0 && <p className="text-sm text-muted-foreground">No hay mensajes pendientes.</p>}
      <ul className="grid gap-3 md:grid-cols-2">
        {pending.map((m) => (
          <li key={m.id} className="space-y-2 rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
            <p className="text-sm font-medium">
              {m.contactName || '—'} <span className="font-normal text-muted-foreground">+{m.phone}</span>
            </p>
            <p className="whitespace-pre-wrap rounded-lg bg-background/50 p-2 text-sm">{m.body}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => decide(m.id, 'approve')}>Aprobar y enviar</Button>
              <Button size="sm" variant="outline" onClick={() => decide(m.id, 'reject')}>Rechazar</Button>
            </div>
          </li>
        ))}
      </ul>
      {history.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Historial</h2>
          <ul className="space-y-1 text-sm">
            {history.slice(0, 20).map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-md border px-2 py-1">
                <Badge variant="outline">{m.status === 'sent' ? 'Enviado' : m.status === 'rejected' ? 'Rechazado' : 'Falló'}</Badge>
                <span className="font-medium">{m.contactName || m.phone}</span>
                <span className="truncate text-muted-foreground">{m.status === 'failed' ? m.error : m.body}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
