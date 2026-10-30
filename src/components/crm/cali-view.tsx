'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, TriangleAlert, Users, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CaliDebtor, CaliSummary } from '@/lib/crm/cartera-cali';
import { CALI_COMPANY, collectionMessage } from '@/lib/crm/collection-messages';
import { cn } from '@/lib/utils';
import { CarteraExtractView } from './cartera-extract';
import { CarteraSheetBox, LinkRow } from './cartera-sheet-panel';
import { DueSoon } from './due-soon';
import { AGING_COLOR, CallLog, ScheduleCall, select } from './receivables-view';
import { Stat, WhatsAppLink, api, card, checkCollection, cop, formatPhone, money, twilioCall, useTwilio } from './shared';

const VIEW_KEY = 'crm-cali-view';

/**
 * The "Cartera Cali" tab of the CRM, apart from the main cartera and laid out like it (user's request, 30-oct-2026:
 * "lo mismo que haga cartera que es de Medellín sea igual al de Cali"): Resumen or Extracto, seller filter, "Por
 * vencer", totals, aging (tap a range to filter), by seller, customers to link to their WhatsApp, and "Quién debe" with
 * WhatsApp, Recordar, Llamar and Programar. Every message is signed "Xsite Group · sede Cali".
 */
export function CaliView({ onOpenCustomer }: { onOpenCustomer: (id: number) => void }) {
  const qc = useQueryClient();
  const [seller, setSeller] = useState('');
  const [range, setRange] = useState(-1); // the aging range chosen (-1 = all)
  const [note, setNote] = useState('');
  const [calling, setCalling] = useState<number | null>(null);
  const [scheduling, setScheduling] = useState<number | null>(null);
  const [view, setView] = useState<'resumen' | 'extracto'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'extracto' ? 'extracto' : 'resumen';
    } catch {
      return 'resumen';
    }
  });
  const pickView = (v: 'resumen' | 'extracto') => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* the choice just is not remembered */
    }
  };
  const twilio = useTwilio();
  const { data: sched } = useQuery({
    queryKey: ['crm-call-requests'],
    queryFn: () => api<{ requests: { contactId: number; scheduledAt: string | null; label: string | null }[] }>('/api/crm/collections/call-requests')
  });
  const scheduledOf = new Map((sched?.requests ?? []).map((r) => [r.contactId, r]));
  const { data } = useQuery({
    queryKey: ['crm-cali', seller],
    queryFn: () => api<CaliSummary>(`/api/crm/receivables/cali${seller ? `?seller=${encodeURIComponent(seller)}` : ''}`),
    placeholderData: (prev) => prev
  });

  const remind = async (contactId: number, name: string) => {
    setNote('');
    try {
      await api('/api/crm/receivables/remind', 'POST', { contactId, cali: true });
      qc.invalidateQueries({ queryKey: ['crm-outbox'] });
      setNote(`Recordatorio de ${CALI_COMPANY} para ${name || 'el cliente'} listo en la pestaña Aprobaciones. No se envía hasta que lo apruebes.`);
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  // As in the main cartera; the check does not ask for overdue debt there (`aviso=1`): Cali debts are not in it.
  const dial = async (contactId: number, name: string, phone: string) => {
    setNote('');
    try {
      const r = await api<{ checks: { allowed: boolean; reasons: string[] }[] }>(`/api/crm/collections/check?customerId=${contactId}&aviso=1`);
      const c = r.checks[0];
      if (c && !c.allowed && !confirm(`No es buen momento para cobrar a ${name || 'este cliente'}:\n\n• ${c.reasons.join('\n• ')}\n\n¿Llamar de todos modos?`)) return;
    } catch {
      /* if the check fails, do not stop the call */
    }
    setCalling(contactId);
    if (twilio.configured) {
      try {
        setNote(await twilioCall(contactId, name, twilio.agent));
        return;
      } catch (e) {
        if (!confirm(`${(e as Error).message}\n\n¿Llamar desde tu celular?`)) return;
      }
    }
    window.location.href = `tel:+${phone}`;
  };

  const maxAging = Math.max(1, ...(data?.aging ?? []).map((a) => a.amount));
  const maxSeller = Math.max(1, ...(data?.bySeller ?? []).map((s) => s.balance));
  const debtors = (data?.debtors ?? [])
    .map((d) => (range < 0 ? d : { ...d, invoices: d.invoices.filter((i) => i.range === range) }))
    .filter((d) => d.invoices.length);
  const inRange = debtors.reduce((a, d) => a + d.invoices.reduce((s, i) => s + i.balance, 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">¿Cómo quieres ver la cartera de Cali?</span>
        <div className="flex rounded-full border border-border/60 bg-card/60 p-0.5 text-xs" role="group" aria-label="Vista de la cartera de Cali">
          {(
            [
              ['resumen', 'Resumen'],
              ['extracto', 'Extracto (como el Excel)']
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => pickView(v)}
              aria-pressed={view === v}
              className={cn('h-8 rounded-full px-3', view === v ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {label}
            </button>
          ))}
        </div>
        <select value={seller} onChange={(e) => setSeller(e.target.value)} className={select} aria-label="Vendedor">
          <option value="">Todos los vendedores</option>
          {(data?.sellers ?? []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* The same sheet: Cali is read with "Cartera por vendedor", at the same times and with the same button. */}
      <CarteraSheetBox freshness={null} />

      {view === 'extracto' ? (
        <CarteraExtractView seller={seller} cali onOpenCustomer={onOpenCustomer} />
      ) : (
        <>
          <DueSoon cali onOpenCustomer={onOpenCustomer} />

          {data && data.invoices === 0 && (
            <p className={cn(card, 'text-sm text-muted-foreground')}>Todavía no hay facturas de la pestaña «Cartera Cali». Toca «🔄 Actualizar» arriba.</p>
          )}
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

              {!seller && data.bySeller.length > 1 && (
                <section className={card}>
                  <h2 className="mb-3 text-sm font-medium">Por vendedor · Cali</h2>
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
            </>
          )}

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

          {data && data.invoices > 0 && (
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
                  Los que más días llevan primero. <b>WhatsApp</b> abre el chat con el mensaje de cobro de «{CALI_COMPANY}» listo para enviar. El recordatorio queda en
                  Aprobaciones; no sale solo. <b>Llamar</b> abre el marcador de tu celular y después te deja anotar cómo te fue. <b>Programar</b> deja la llamada para
                  una fecha y hora.
                </p>
              )}
              {note && <p className="mb-3 rounded-md border bg-background/40 p-2 text-xs">{note}</p>}
              <ul className="space-y-2">
                {debtors.length === 0 && <li className="text-xs text-muted-foreground">Nadie en este rango.</li>}
                {debtors.map((d) => (
                  <DebtorRow
                    key={d.key}
                    d={d}
                    onOpenCustomer={onOpenCustomer}
                    scheduled={d.contactId ? scheduledOf.get(d.contactId)?.label ?? null : null}
                    onUnschedule={async () => {
                      await api('/api/crm/collections/call-requests', 'DELETE', { contactId: d.contactId });
                      qc.invalidateQueries({ queryKey: ['crm-call-requests'] });
                    }}
                    onRemind={() => remind(d.contactId!, d.name)}
                    onDial={() => dial(d.contactId!, d.name, d.phone)}
                    onSchedule={() => setScheduling(scheduling === d.contactId ? null : d.contactId)}
                  >
                    {d.contactId && scheduling === d.contactId && (
                      <ScheduleCall
                        contactId={d.contactId}
                        name={d.name}
                        onClose={() => setScheduling(null)}
                        onSaved={(m) => {
                          setScheduling(null);
                          setNote(m);
                          qc.invalidateQueries({ queryKey: ['crm-call-requests'] });
                        }}
                      />
                    )}
                    {d.contactId && calling === d.contactId && (
                      <CallLog
                        contactId={d.contactId}
                        name={d.name}
                        onClose={() => setCalling(null)}
                        onSaved={(m) => {
                          setCalling(null);
                          setNote(m);
                          qc.invalidateQueries({ queryKey: ['crm'] });
                        }}
                      />
                    )}
                  </DebtorRow>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** One Cali customer of "Quién debe · Cali": its invoices (of the chosen range) with their days, and the buttons. */
function DebtorRow({
  d,
  onOpenCustomer,
  scheduled,
  onUnschedule,
  onRemind,
  onDial,
  onSchedule,
  children
}: {
  d: CaliDebtor;
  onOpenCustomer: (id: number) => void;
  scheduled: string | null;
  onUnschedule: () => void;
  onRemind: () => void;
  onDial: () => void;
  onSchedule: () => void;
  children?: React.ReactNode;
}) {
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
      {d.hasPhone && d.contactId ? (
        <>
          {scheduled && (
            <p className="mt-2 flex items-center gap-2 text-xs text-sky-400">
              <span className="min-w-0 flex-1">📅 Llamada programada: {scheduled}</span>
              <button className="shrink-0 underline" onClick={onUnschedule}>
                Quitar
              </button>
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <WhatsAppLink
              phone={d.phone}
              text={cobro}
              // Cali debts are not in the CRM's cartera: the check skips "no overdue debt" and keeps the rest (hours, etc.).
              beforeOpen={cobro ? () => checkCollection(d.contactId!, { reminder: true }) : undefined}
              className="inline-flex h-8 items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
            >
              💬 WhatsApp
            </WhatsAppLink>
            <Button size="sm" variant="outline" onClick={onRemind}>
              Recordar
            </Button>
            <Button size="sm" variant="outline" onClick={onDial}>
              📞 Llamar
            </Button>
            <Button size="sm" variant="outline" onClick={onSchedule}>
              📅 Programar
            </Button>
          </div>
        </>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">📵 Únelo con su WhatsApp en «Clientes de Cali sin WhatsApp» para poder escribirle o llamarlo.</p>
      )}
      {children}
    </li>
  );
}
