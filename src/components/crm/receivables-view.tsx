'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ReceivablesSummary } from '@/lib/crm/receivables';
import { api, card, formatPhone, money } from './shared';

const select = 'h-9 rounded-full border border-border/60 bg-card/50 px-3 text-sm';
const AGING_COLOR = ['#34d399', '#fbbf24', '#fb923c', '#f87171', '#e11d48'];

export function ReceivablesView({ onOpenCustomer }: { onOpenCustomer: (id: number) => void }) {
  const qc = useQueryClient();
  const [seller, setSeller] = useState('');
  const [bucket, setBucket] = useState<string>('');
  const [note, setNote] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['crm-receivables', seller, bucket],
    queryFn: () => {
      const q = new URLSearchParams();
      if (seller) q.set('seller', seller);
      if (bucket) q.set('bucket', bucket);
      return api<ReceivablesSummary>(`/api/crm/receivables${q.size ? `?${q}` : ''}`);
    },
    placeholderData: (prev) => prev
  });

  const remind = async (contactId: number, name: string) => {
    setNote('');
    try {
      await api('/api/crm/receivables/remind', 'POST', { contactId });
      qc.invalidateQueries({ queryKey: ['crm-outbox'] });
      setNote(`Recordatorio para ${name || 'el cliente'} listo en la pestaña Aprobaciones. No se envía hasta que lo apruebes.`);
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Calculando…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;
  if (data.totals.invoices === 0 && !seller)
    return (
      <div className={cn(card, 'space-y-2 text-sm')}>
        <p className="font-medium">Aún no hay cartera cargada.</p>
        <p className="text-muted-foreground">
          Pídele a OpenClaw que cargue el reporte de cartera por vendedor (facturas con saldo pendiente). Después verás aquí cuánto te deben, quién está
          en mora y desde cuándo.
        </p>
      </div>
    );

  const maxAging = Math.max(1, ...data.aging.map((a) => a.amount));
  const maxSeller = Math.max(1, ...data.bySeller.map((s) => s.balance));
  return (
    <div className="space-y-4">
      <select value={seller} onChange={(e) => setSeller(e.target.value)} className={select} aria-label="Vendedor">
        <option value="">Todos los vendedores</option>
        {data.sellers.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Por cobrar', money(data.totals.balance), ''],
          ['Vencida', money(data.totals.overdue), data.totals.overdue > 0 ? 'text-amber-500' : ''],
          ['Facturas abiertas', money(data.totals.invoices), ''],
          ['Clientes que deben', money(data.totals.debtors), '']
        ].map(([label, value, color]) => (
          <div key={label} className={card}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={cn('mt-1 text-xl font-semibold tabular-nums', color)}>{value}</p>
          </div>
        ))}
      </div>

      <section className={card}>
        <h2 className="text-sm font-medium">Antigüedad de la deuda</h2>
        <p className="mb-3 text-xs text-muted-foreground">Toca un rango para ver solo los clientes que tienen facturas en él.</p>
        <ul className="space-y-2">
          {data.aging.map((a, i) => (
            <li key={a.key}>
              <button
                onClick={() => setBucket(bucket === a.key ? '' : a.key)}
                aria-pressed={bucket === a.key}
                className={cn(
                  'block w-full rounded-lg border border-transparent p-2 text-left transition-colors hover:bg-accent/40',
                  bucket === a.key && 'border-emerald-400/60 bg-emerald-400/10',
                  bucket && bucket !== a.key && 'opacity-50'
                )}
              >
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="flex-1">{a.label}</span>
                  <span className="text-muted-foreground">{a.invoices} facturas</span>
                  <span className="tabular-nums">{money(a.amount)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${(a.amount / maxAging) * 100}%`, background: AGING_COLOR[i] }} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {!seller && data.bySeller.length > 1 && (
        <section className={card}>
          <h2 className="mb-3 text-sm font-medium">Por vendedor</h2>
          <ul className="space-y-2">
            {data.bySeller.map((s) => (
              <li key={s.name}>
                <button className="block w-full text-left" onClick={() => s.name !== 'Sin vendedor' && setSeller(s.name)}>
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="text-amber-500">{s.overdue > 0 ? `${money(s.overdue)} vencido` : ''}</span>
                    <span className="tabular-nums">{money(s.balance)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${(s.balance / maxSeller) * 100}%` }} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card}>
        <h2 className="text-sm font-medium">{bucket ? `Quién debe · ${data.aging.find((a) => a.key === bucket)?.label ?? ''}` : 'Quién debe'}</h2>
        {bucket ? (
          <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1">
              {data.listed.customers} cliente{data.listed.customers === 1 ? '' : 's'} · {money(data.listed.amount)} en este rango
            </span>
            <button onClick={() => setBucket('')} className="shrink-0 underline">
              Quitar filtro
            </button>
          </p>
        ) : (
          <p className="mb-3 text-xs text-muted-foreground">Los que más tienen vencido primero. El recordatorio queda en Aprobaciones; no sale solo.</p>
        )}
        {note && <p className="mb-3 rounded-md border bg-background/40 p-2 text-xs">{note}</p>}
        <ul className="space-y-2">
          {data.debtors.length === 0 && <li className="text-xs text-muted-foreground">Nadie en este rango.</li>}
          {data.debtors.map((d) => (
            <li key={d.contactId} className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 p-2">
              <button onClick={() => onOpenCustomer(d.contactId)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium">{d.name || formatPhone(d.phone)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {d.hasPhone ? formatPhone(d.phone) : 'Sin teléfono'} · {d.invoices} factura{d.invoices === 1 ? '' : 's'}
                  {d.seller ? ` · ${d.seller}` : ''}
                </p>
              </button>
              <div className="shrink-0 text-right">
                <p className="text-sm font-medium tabular-nums">{money(d.balance)}</p>
                <p className={cn('text-xs', d.oldestDays > 0 ? 'text-amber-500' : 'text-muted-foreground')}>
                  {d.oldestDays > 0 ? `${d.oldestDays} días de mora` : 'al día'}
                </p>
              </div>
              {d.hasPhone && d.overdue > 0 && (
                <Button size="sm" variant="outline" onClick={() => remind(d.contactId, d.name)}>
                  Recordar
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
