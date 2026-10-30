'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, TriangleAlert, Users, Wallet } from 'lucide-react';
import type { CaliDebtor, CaliSummary } from '@/lib/crm/cartera-cali';
import { CALI_COMPANY, collectionMessage } from '@/lib/crm/collection-messages';
import { cn } from '@/lib/utils';
import { CarteraExtractView } from './cartera-extract';
import { LinkRow } from './cartera-sheet-panel';
import { DueSoon } from './due-soon';
import { Stat, WhatsAppLink, api, card, checkCollection, cop, formatPhone, money } from './shared';

const AGING_COLOR = ['#34d399', '#fbbf24', '#fb923c', '#f87171', '#e11d48'];

/**
 * The "Cartera Cali" tab of the CRM, apart from the main cartera (user's request, 30-oct-2026): its totals and aging,
 * the "Por vencer" traffic light to send reminders (signed "Xsite Group · sede Cali"), the customers to link to their
 * WhatsApp, and the Excel-like report.
 */
export function CaliView({ onOpenCustomer }: { onOpenCustomer: (id: number) => void }) {
  const { data } = useQuery({ queryKey: ['crm-cali'], queryFn: () => api<CaliSummary>('/api/crm/receivables/cali') });
  const maxAging = Math.max(1, ...(data?.aging ?? []).map((a) => a.amount));
  // Tapping an aging range shows only the customers with invoices in it, with those invoices and their days (as the
  // main cartera does; user's request, 30-oct-2026). -1 = no range chosen.
  const [range, setRange] = useState(-1);
  const debtors = (data?.debtors ?? [])
    .map((d) => (range < 0 ? d : { ...d, invoices: d.invoices.filter((i) => i.range === range) }))
    .filter((d) => d.invoices.length);
  const inRange = debtors.reduce((a, d) => a + d.invoices.reduce((s, i) => s + i.balance, 0), 0);
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
            <h2 className="text-sm font-medium">Antigüedad de la deuda · Cali</h2>
            <p className="mb-2 text-xs text-muted-foreground">Toca un rango para ver solo los clientes que tienen facturas en él.</p>
            <ul className="space-y-1">
              {data.aging.map((a, i) => (
                <li key={a.label}>
                  <button
                    onClick={() => setRange(range === i ? -1 : i)}
                    aria-pressed={range === i}
                    className={cn(
                      'block w-full rounded-lg border border-transparent p-2 text-left transition-colors hover:bg-accent/40',
                      range === i && 'border-emerald-400/60 bg-emerald-400/10',
                      range >= 0 && range !== i && 'opacity-50'
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

          <section id="quien-debe-cali" className={card}>
            <h2 className="text-sm font-medium">{range >= 0 ? `Quién debe · Cali · ${data.aging[range].label}` : 'Quién debe · Cali'}</h2>
            {range >= 0 ? (
              <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1">
                  {debtors.length} cliente{debtors.length === 1 ? '' : 's'} · {money(inRange)} en este rango
                </span>
                <button onClick={() => setRange(-1)} className="shrink-0 underline">
                  Quitar filtro
                </button>
              </p>
            ) : (
              <p className="mb-3 text-xs text-muted-foreground">
                Los que más días llevan primero. <b>WhatsApp</b> abre el chat con el mensaje de cobro de «{CALI_COMPANY}» listo para enviar.
              </p>
            )}
            <ul className="space-y-2">
              {debtors.length === 0 && <li className="text-xs text-muted-foreground">Nadie en este rango.</li>}
              {debtors.map((d) => (
                <DebtorRow key={d.key} d={d} onOpenCustomer={onOpenCustomer} />
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

/** One Cali customer of "Quién debe · Cali": its invoices (of the chosen range) with their days, and WhatsApp. */
function DebtorRow({ d, onOpenCustomer }: { d: CaliDebtor; onOpenCustomer: (id: number) => void }) {
  const total = d.invoices.reduce((a, i) => a + i.balance, 0);
  const oldest = d.invoices[0];
  // The collection message by tiers names the oldest overdue invoice shown (none under 30 days: the chat opens empty).
  const cobro = oldest && oldest.late > 0 ? collectionMessage(d.name, [{ doc: oldest.doc, balance: oldest.balance, daysLate: oldest.late }], CALI_COMPANY)?.text : undefined;
  return (
    <li className="rounded-lg border border-border/60 bg-background/40 p-2">
      <div className="flex items-center gap-2">
        <button onClick={() => d.contactId && onOpenCustomer(d.contactId)} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-medium">{d.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {d.hasPhone ? formatPhone(d.phone) : 'Sin WhatsApp'} · {d.invoices.length} factura{d.invoices.length === 1 ? '' : 's'}
          </p>
        </button>
        <div className="shrink-0 text-right">
          <p className="text-sm font-medium tabular-nums">{money(total)}</p>
          <p className={cn('text-xs', oldest?.late > 0 ? 'text-amber-500' : 'text-muted-foreground')}>{oldest?.late > 0 ? `${oldest.late} días de mora` : 'al día'}</p>
        </div>
      </div>
      <ul className="mt-1 space-y-0.5 text-xs">
        {d.invoices.map((i) => (
          <li key={i.doc} className={cn('flex gap-2', i.late > 0 && 'text-rose-600 dark:text-rose-400')}>
            <span className="flex-1">
              🧾 Fact. {i.doc} · {i.late > 0 ? `${i.late} días` : 'al día'}
            </span>
            <span className="tabular-nums">$ {money(i.balance)}</span>
          </li>
        ))}
      </ul>
      {d.hasPhone ? (
        <div className="mt-2">
          <WhatsAppLink
            phone={d.phone}
            text={cobro}
            // Cali debts are not in the CRM's cartera: the check skips "no overdue debt" and keeps the rest (hours, etc.).
            beforeOpen={cobro && d.contactId ? () => checkCollection(d.contactId!, { reminder: true }) : undefined}
            className="inline-flex h-8 items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
          >
            💬 WhatsApp
          </WhatsAppLink>
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">📵 Únelo con su WhatsApp en «Clientes de Cali sin WhatsApp» para poder escribirle.</p>
      )}
    </li>
  );
}
