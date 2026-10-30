'use client';

import { useQuery } from '@tanstack/react-query';
import { FileText, TriangleAlert, Users, Wallet } from 'lucide-react';
import type { CaliSummary } from '@/lib/crm/cartera-cali';
import { CarteraExtractView } from './cartera-extract';
import { LinkRow } from './cartera-sheet-panel';
import { DueSoon } from './due-soon';
import { Stat, api, card, cop, money } from './shared';

const AGING_COLOR = ['#34d399', '#fbbf24', '#fb923c', '#f87171', '#e11d48'];

/**
 * The "Cartera Cali" tab of the CRM, apart from the main cartera (user's request, 30-oct-2026): its totals and aging,
 * the "Por vencer" traffic light to send reminders (signed "Xsite Group · sede Cali"), the customers to link to their
 * WhatsApp, and the Excel-like report.
 */
export function CaliView({ onOpenCustomer }: { onOpenCustomer: (id: number) => void }) {
  const { data } = useQuery({ queryKey: ['crm-cali'], queryFn: () => api<CaliSummary>('/api/crm/receivables/cali') });
  const maxAging = Math.max(1, ...(data?.aging ?? []).map((a) => a.amount));
  return (
    <div className="space-y-4">
      {data && data.invoices > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat tone="blue" icon={Wallet} label="Por cobrar · Cali" value={cop(data.total)} />
            <Stat tone="amber" icon={TriangleAlert} label="Vencida" value={cop(data.overdue)} colorValue={data.overdue > 0} />
            <Stat tone="slate" icon={FileText} label="Facturas abiertas" value={money(data.invoices)} />
            <Stat tone="violet" icon={Users} label="Clientes que deben" value={money(data.customers)} />
          </div>
          <section className={card}>
            <h2 className="mb-2 text-sm font-medium">Antigüedad de la deuda · Cali</h2>
            <ul className="space-y-1">
              {data.aging.map((a, i) => (
                <li key={a.label} className="p-2">
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="flex-1">{a.label}</span>
                    <span className="text-muted-foreground">{a.invoices} facturas</span>
                    <span className="tabular-nums">{money(a.amount)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${(a.amount / maxAging) * 100}%`, background: AGING_COLOR[i] }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <DueSoon cali onOpenCustomer={onOpenCustomer} />

      {data && data.unlinked.length > 0 && (
        <section className={card}>
          <h2 className="text-sm font-medium">📵 Clientes de Cali sin WhatsApp ({data.unlinked.length})</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Sin su WhatsApp no se les puede escribir. Toca «Buscar su WhatsApp», escribe su nombre o celular y elige «Es este».
          </p>
          <ul className="space-y-2">
            {data.unlinked.map((c) => (
              <LinkRow
                key={c.key}
                client={{ key: c.key, name: c.name, contactId: c.contactId ?? 0, balance: c.balance, invoices: c.invoices, linked: null, suggestion: null }}
                onOpenCustomer={onOpenCustomer}
              />
            ))}
          </ul>
        </section>
      )}

      <CarteraExtractView seller="" cali onOpenCustomer={onOpenCustomer} />
    </div>
  );
}
