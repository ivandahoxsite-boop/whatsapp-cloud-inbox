'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AnalixLast, AnalixPlan, SalesClient } from '@/lib/crm/analix';
import { coDateTime, dayWord } from '@/lib/crm/tasks-info';
import { LinkRow } from './cartera-sheet-panel';
import { api, card, money } from './shared';

type Status = { configured: boolean; last: AnalixLast | null };

const monthName = (m: string) => {
  const [y, mo] = m.split('-');
  return `${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][Number(mo) - 1]} ${y}`;
};

/**
 * When the sales were last brought from AnaliX, and a button to bring them now. The CRM also brings them by itself
 * Monday to Saturday at 11 p. m. If a month would drop by more than half, it does not load and shows why.
 */
export function AnalixBox() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['crm-analix'], queryFn: () => api<Status>('/api/crm/reports/sales/analix') });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [held, setHeld] = useState<AnalixPlan | null>(null);
  if (!data?.configured) return null;
  const last = data.last;

  const run = async (action: 'update' | 'load') => {
    setBusy(true);
    setMsg('');
    setHeld(null);
    try {
      const r = await api<{ plan: AnalixPlan }>('/api/crm/reports/sales/analix', 'POST', { action });
      const p = r.plan;
      setMsg(
        `✅ Ventas actualizadas: ${p.lines} líneas de ${p.firstMonth ? monthName(p.firstMonth) : ''} a ${p.lastMonth ? monthName(p.lastMonth) : ''} por ${money(p.total)}` +
          `${p.changed.length ? ` · cambiaron ${p.changed.length} mes${p.changed.length === 1 ? '' : 'es'}` : ' · sin cambios'}` +
          `${p.unlinked ? ` · ${p.unlinked} clientes sin WhatsApp` : ''}.`
      );
    } catch (e) {
      setMsg((e as Error).message);
      const body = (e as { body?: { plan?: AnalixPlan } }).body;
      if (body?.plan?.blockers.length) setHeld(body.plan);
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ['crm-analix'] });
      qc.invalidateQueries({ queryKey: ['crm-sales-report'] });
      qc.invalidateQueries({ queryKey: ['crm-sales-clients'] });
    }
  };

  return (
    <div
      className={cn(
        'space-y-1 rounded-xl border px-3 py-2 text-xs',
        last && !last.ok ? 'border-amber-500/40 bg-amber-500/10 text-amber-500' : 'border-border/60 text-muted-foreground'
      )}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1">
          {last?.ok ? '🔄 ' : last ? '⚠️ ' : ''}Ventas traídas de AnaliX:{' '}
          {last ? (
            <b>
              {dayWord(last.at)}
              {coDateTime(last.at)}
            </b>
          ) : (
            <b>todavía no</b>
          )}
          {last?.ok && last.lastMonth ? ` · hasta ${monthName(last.lastMonth)}` : ''}
        </p>
        <Button size="sm" onClick={() => run('update')} disabled={busy} className="shrink-0">
          {busy ? 'Trayendo…' : '🔄 Actualizar'}
        </Button>
      </div>
      {last && !last.ok && <p>Último intento: {last.error}</p>}
      <p>Se actualizan solas de lunes a sábado a las 11:00 p. m. (no domingos ni festivos).</p>
      {msg && <p className="text-foreground">{msg}</p>}
      {held && (
        <div className="space-y-1 rounded-lg border border-border/60 bg-background/60 p-2 text-foreground">
          {held.changed.slice(0, 6).map((c) => (
            <p key={c.month}>
              {monthName(c.month)}: {money(c.before)} → <b>{money(c.after)}</b>
            </p>
          ))}
          <p className="text-muted-foreground">Si en AnaliX esos valores están bien (por ejemplo, se anularon facturas), cárgalos igual.</p>
          <Button size="sm" variant="outline" onClick={() => run('load')} disabled={busy}>
            Cargar de todos modos
          </Button>
        </div>
      )}
    </div>
  );
}

/** AnaliX customers whose sales are not on a WhatsApp contact yet: AnaliX has no NIT or phone, you say who is who once. */
export function SalesLinks({ onOpenCustomer }: { onOpenCustomer: (id: number) => void }) {
  const { data } = useQuery({ queryKey: ['crm-sales-clients'], queryFn: () => api<{ clients: SalesClient[] }>('/api/crm/reports/sales/clients') });
  const [all, setAll] = useState(false);
  if (!data?.clients.length) return null;
  const shown = all ? data.clients : data.clients.slice(0, 15);
  return (
    <section className={card}>
      <h2 className="text-sm font-medium">Clientes de AnaliX sin WhatsApp ({data.clients.length})</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        AnaliX trae solo el nombre del cliente. Si es igual al de la hoja de cartera, se une solo por su NIT; los demás dímelos una vez. Los que más
        compraron en el último año primero. Las sugerencias salen de cómo estaban antes: confírmalas solo si estás seguro.
      </p>
      <ul className="space-y-2">
        {shown.map((c) => (
          <LinkRow key={c.key} client={c} onOpenCustomer={onOpenCustomer} sales />
        ))}
      </ul>
      {data.clients.length > shown.length && (
        <button className="mt-2 text-xs underline" onClick={() => setAll(true)}>
          Ver los {data.clients.length}
        </button>
      )}
    </section>
  );
}
