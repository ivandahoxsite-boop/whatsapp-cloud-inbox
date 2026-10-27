'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ReceivablesSummary } from '@/lib/crm/receivables';
import { FileText, TriangleAlert, Users, Wallet } from 'lucide-react';
import { Stat, WhatsAppLink, api, card, checkCollection, cop, formatPhone, money, twilioCall, useTwilio } from './shared';
import { collectionMessage } from '@/lib/crm/collection-messages';
import { CarteraLinks, CarteraSheetBox, useCarteraSheet } from './cartera-sheet-panel';
import { CarteraExtractView } from './cartera-extract';

const select = 'h-9 rounded-full border border-border/60 bg-card/50 px-3 text-sm';
/** The tiered payment reminder for a debtor (oldest overdue invoice), or undefined under 30 days: then the chat opens empty. */
const cobroText = (d: { name: string; oldestDoc: string; oldestBalance: number; oldestDays: number }) =>
  d.oldestDoc ? collectionMessage(d.name, [{ doc: d.oldestDoc, balance: d.oldestBalance, daysLate: d.oldestDays }])?.text : undefined;

const AGING_COLOR = ['#34d399', '#fbbf24', '#fb923c', '#f87171', '#e11d48'];

export function ReceivablesView({ onOpenCustomer }: { onOpenCustomer: (id: number) => void }) {
  const qc = useQueryClient();
  const [seller, setSeller] = useState('');
  const [bucket, setBucket] = useState<string>('');
  const [note, setNote] = useState('');
  // How the user wants to see the cartera: the summary, or laid out like the billing system's Excel report.
  const [view, setView] = useState<'resumen' | 'extracto'>(() => {
    try {
      return localStorage.getItem('crm-cartera-view') === 'extracto' ? 'extracto' : 'resumen';
    } catch {
      return 'resumen';
    }
  });
  const pickView = (v: 'resumen' | 'extracto') => {
    setView(v);
    try {
      localStorage.setItem('crm-cartera-view', v);
    } catch {
      /* the choice just is not remembered */
    }
  };
  const twilio = useTwilio();
  const { data: sheet } = useCarteraSheet();
  const [calling, setCalling] = useState<number | null>(null); // the customer whose call result is being typed
  const [scheduling, setScheduling] = useState<number | null>(null); // the customer whose call time is being picked
  const { data: sched } = useQuery({
    queryKey: ['crm-call-requests'],
    queryFn: () => api<{ requests: { contactId: number; scheduledAt: string | null; label: string | null }[] }>('/api/crm/collections/call-requests')
  });
  const scheduledOf = new Map((sched?.requests ?? []).map((r) => [r.contactId, r]));
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

  // Opens the phone's dialer. Before that the CRM checks the collection rules (hours, holidays, asked not to be called...)
  // and warns; the decision to call anyway is yours.
  const dial = async (contactId: number, name: string, phone: string) => {
    setNote('');
    try {
      const r = await api<{ checks: { allowed: boolean; reasons: string[] }[] }>(`/api/crm/collections/check?customerId=${contactId}`);
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

  if (isLoading) return <p className="text-sm text-muted-foreground">Calculando…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;
  if (data.totals.invoices === 0 && !seller)
    return (
      <div className={cn(card, 'space-y-2 text-sm')}>
        <p className="font-medium">Aún no hay cartera cargada.</p>
        <p className="text-muted-foreground">
          {sheet?.configured
            ? 'Toca «🔄 Actualizar ahora» para leer la pestaña «Cartera por vendedor».'
            : 'Pídele a OpenClaw que cargue el reporte de cartera por vendedor (facturas con saldo pendiente).'}{' '}
          Después verás aquí cuánto te deben, quién está en mora y desde cuándo.
        </p>
        <CarteraSheetBox freshness={null} />
      </div>
    );

  const maxAging = Math.max(1, ...data.aging.map((a) => a.amount));
  const maxSeller = Math.max(1, ...data.bySeller.map((s) => s.balance));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">¿Cómo quieres ver la cartera?</span>
        <div className="flex rounded-full border border-border/60 bg-card/60 p-0.5 text-xs" role="group" aria-label="Vista de la cartera">
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
          {data.sellers.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <CarteraSheetBox freshness={data.freshness} />

      {view === 'extracto' ? (
        <CarteraExtractView seller={seller} onOpenCustomer={onOpenCustomer} />
      ) : (
      <>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat tone="blue" icon={Wallet} label="Por cobrar" value={cop(data.totals.balance)} />
        <Stat tone="amber" icon={TriangleAlert} label="Vencida" value={cop(data.totals.overdue)} colorValue={data.totals.overdue > 0} />
        <Stat tone="slate" icon={FileText} label="Facturas abiertas" value={money(data.totals.invoices)} />
        <Stat tone="violet" icon={Users} label="Clientes que deben" value={money(data.totals.debtors)} />
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

      <CarteraLinks onOpenCustomer={onOpenCustomer} />

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
          <p className="mb-3 text-xs text-muted-foreground">Los que más tienen vencido primero. <b>WhatsApp</b> abre el chat con el mensaje de cobro listo para enviar. El recordatorio queda en Aprobaciones; no sale solo. <b>Llamar</b> abre el marcador de tu celular y después te deja anotar cómo te fue. <b>Programar</b> deja la llamada para una fecha y hora.</p>
        )}
        {note && <p className="mb-3 rounded-md border bg-background/40 p-2 text-xs">{note}</p>}
        <ul className="space-y-2">
          {data.debtors.length === 0 && <li className="text-xs text-muted-foreground">Nadie en este rango.</li>}
          {data.debtors.map((d) => (
            <li key={d.contactId} className="rounded-lg border border-border/60 bg-background/40 p-2">
              <div className="flex items-center gap-2">
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
              </div>
              {d.hasPhone && d.overdue > 0 && (
                <>
                  {scheduledOf.get(d.contactId)?.label && (
                    <p className="mt-2 flex items-center gap-2 text-xs text-sky-400">
                      <span className="min-w-0 flex-1">📅 Llamada programada: {scheduledOf.get(d.contactId)!.label}</span>
                      <button
                        className="shrink-0 underline"
                        onClick={async () => {
                          await api('/api/crm/collections/call-requests', 'DELETE', { contactId: d.contactId });
                          qc.invalidateQueries({ queryKey: ['crm-call-requests'] });
                        }}
                      >
                        Quitar
                      </button>
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <WhatsAppLink
                      phone={d.phone}
                      text={cobroText(d)}
                      beforeOpen={cobroText(d) ? () => checkCollection(d.contactId) : undefined}
                      className="inline-flex h-8 items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-500 hover:bg-emerald-500/20"
                    >
                      💬 WhatsApp
                    </WhatsAppLink>
                    <Button size="sm" variant="outline" onClick={() => remind(d.contactId, d.name)}>
                      Recordar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => dial(d.contactId, d.name, d.phone)}>
                      📞 Llamar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setScheduling(scheduling === d.contactId ? null : d.contactId)}>
                      📅 Programar
                    </Button>
                  </div>
                </>
              )}
              {scheduling === d.contactId && (
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
              {calling === d.contactId && (
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
          <p className="mb-3 text-xs text-muted-foreground">Los que más tienen vencido primero. <b>WhatsApp</b> abre el chat con el mensaje de cobro listo para enviar. El recordatorio queda en Aprobaciones; no sale solo. <b>Llamar</b> abre el marcador de tu celular y después te deja anotar cómo te fue.</p>
        )}
        {note && <p className="mb-3 rounded-md border bg-background/40 p-2 text-xs">{note}</p>}
        <ul className="space-y-2">
          {data.debtors.length === 0 && <li className="text-xs text-muted-foreground">Nadie en este rango.</li>}
          {data.debtors.map((d) => (
            <li key={d.contactId} className="rounded-lg border border-border/60 bg-background/40 p-2">
              <div className="flex items-center gap-2">
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
                <div className="flex shrink-0 flex-col gap-1">
                  <WhatsAppLink
                    phone={d.phone}
                    text={cobroText(d)}
                    beforeOpen={cobroText(d) ? () => checkCollection(d.contactId) : undefined}
                    className="inline-flex h-8 items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-500 hover:bg-emerald-500/20"
                  >
                    💬 WhatsApp
                  </WhatsAppLink>
                  <Button size="sm" variant="outline" onClick={() => remind(d.contactId, d.name)}>
                    Recordar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => dial(d.contactId, d.name, d.phone)}>
                    📞 Llamar
                  </Button>
                </div>
              )}
              </div>
              {calling === d.contactId && (
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
            </li>
          ))}
        </ul>
      </section>
      </>
      )}
    </div>
  );
}

const OUTCOMES: [string, string][] = [
  ['promesa_pago', 'Prometió pagar'],
  ['ya_pago', 'Dice que ya pagó'],
  ['sin_respuesta', 'No contestó'],
  ['buzon', 'Buzón de voz'],
  ['rechaza', 'No quiso hablar'],
  ['numero_equivocado', 'Número equivocado'],
  ['no_llamar', 'Pidió que no lo llamen'],
  ['otro', 'Otro']
];

/** Short form to leave what happened on a call; it lands in the customer's timeline as "Llamada de cobro". */
function CallLog({ contactId, name, onClose, onSaved }: { contactId: number; name: string; onClose: () => void; onSaved: (msg: string) => void }) {
  const [outcome, setOutcome] = useState('promesa_pago');
  const [summary, setSummary] = useState('');
  const [promiseDate, setPromiseDate] = useState('');
  const [promiseAmount, setPromiseAmount] = useState('');
  const [err, setErr] = useState('');
  const save = async () => {
    setErr('');
    try {
      await api(`/api/crm/customers/${contactId}/calls`, 'POST', {
        outcome,
        summary,
        promiseDate: outcome === 'promesa_pago' ? promiseDate : undefined,
        promiseAmount: outcome === 'promesa_pago' && promiseAmount ? Number(promiseAmount.replace(/\D/g, '')) : undefined
      });
      onSaved(`Llamada a ${name || 'el cliente'} guardada en su ficha.`);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const field = 'mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-primary/60';
  return (
    <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
      <p className="text-xs font-medium">¿Cómo te fue con {name || 'el cliente'}?</p>
      <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={cn(field, 'h-9')} aria-label="Resultado">
        {OUTCOMES.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {outcome === 'promesa_pago' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">
            Pagará el
            <input type="date" value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)} className={field} />
          </label>
          <label className="text-xs text-muted-foreground">
            Monto (opcional)
            <input inputMode="numeric" value={promiseAmount} onChange={(e) => setPromiseAmount(e.target.value)} placeholder="1500000" className={field} />
          </label>
        </div>
      )}
      <textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        rows={2}
        placeholder="Resumen: con quién hablaste y qué dijo"
        className={field}
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={!summary.trim()}>
          Guardar llamada
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Ahora no
        </Button>
      </div>
    </div>
  );
}

/** Picks a date and time (Colombian time) for a call. The CRM refuses hours when collecting is not allowed and suggests the next slot. */
function ScheduleCall({ contactId, name, onClose, onSaved }: { contactId: number; name: string; onClose: () => void; onSaved: (msg: string) => void }) {
  const [when, setWhen] = useState('');
  const [err, setErr] = useState('');
  const [suggest, setSuggest] = useState<{ value: string; label: string } | null>(null);
  // Colombian "now" for the picker's minimum (UTC-5, no daylight saving).
  const min = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 16);

  const save = async (value = when) => {
    setErr('');
    setSuggest(null);
    try {
      const r = await api<{ label: string }>('/api/crm/collections/call-requests', 'POST', { contactId, scheduledFor: value });
      onSaved(`Llamada a ${name || 'el cliente'} programada: ${r.label}. Te la recordaré en el resumen de las 8:00 de ese día.`);
    } catch (e) {
      setErr((e as Error).message);
      // when the hours are the problem, the answer carries the next allowed slot
      const body = (e as { body?: { suggest?: string; suggestLabel?: string } }).body;
      if (body?.suggest && body.suggestLabel) setSuggest({ value: body.suggest, label: body.suggestLabel });
    }
  };
  const field = 'mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-primary/60';
  return (
    <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
      <p className="text-xs font-medium">¿Cuándo quieres llamar a {name || 'el cliente'}?</p>
      <label className="block text-xs text-muted-foreground">
        Fecha y hora (hora de Colombia)
        <input type="datetime-local" value={when} min={min} onChange={(e) => setWhen(e.target.value)} className={field} />
      </label>
      <p className="text-[11px] text-muted-foreground">Solo se puede cobrar de lunes a viernes de 7 a. m. a 7 p. m. y sábados de 8 a. m. a 3 p. m., sin domingos ni festivos.</p>
      {err && <p className="text-xs text-destructive">{err}</p>}
      {suggest && (
        <Button size="sm" variant="outline" onClick={() => { setWhen(suggest.value); save(suggest.value); }}>
          Usar {suggest.label}
        </Button>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => save()} disabled={!when}>
          Programar
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
