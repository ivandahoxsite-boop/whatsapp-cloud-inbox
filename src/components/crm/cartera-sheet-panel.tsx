'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CarteraClient, CarteraLast, CarteraPlan } from '@/lib/crm/cartera-sheet';
import type { ReceivablesFreshness } from '@/lib/crm/receivables';
import { coDateTime, dayWord } from '@/lib/crm/tasks-info';
import { api, card, formatPhone, money } from './shared';

type SheetStatus = { configured: boolean; last: CarteraLast | null };

const shortDay = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

export function useCarteraSheet() {
  return useQuery({ queryKey: ['crm-cartera-sheet'], queryFn: () => api<SheetStatus>('/api/crm/receivables/sheet') });
}

/**
 * When the cartera was last brought in and, with the Google Sheet connected, a button to read it now: it first shows
 * what would change (invoices that move to another customer, invoices taken as paid) and loads only on confirm.
 */
export function CarteraSheetBox({ freshness }: { freshness: ReceivablesFreshness | null }) {
  const qc = useQueryClient();
  const { data: sheet } = useCarteraSheet();
  const [plan, setPlan] = useState<CarteraPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const configured = !!sheet?.configured;
  const last = sheet?.last;

  const preview = async () => {
    setBusy(true);
    setMsg('');
    setPlan(null);
    try {
      setPlan((await api<{ plan: CarteraPlan }>('/api/crm/receivables/sheet', 'POST', { action: 'preview' })).plan);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['crm-receivables'] });
    qc.invalidateQueries({ queryKey: ['crm-cartera-sheet'] });
    qc.invalidateQueries({ queryKey: ['crm-cartera-links'] });
  };
  const done = (p: CarteraPlan) =>
    `✅ Cartera actualizada: ${p.invoices} facturas por ${money(p.total)}` +
    `${p.created ? ` · ${p.created} nuevas` : ''}${p.closed ? ` · ${p.closed} pagadas` : ''}${p.moves.length ? ` · ${p.moves.length} cambiaron de cliente` : ''}.`;
  // One tap: reads the sheet and loads it with the same safety checks as the scheduled loads. If a check stops it,
  // the preview opens so you can look and confirm.
  const update = async () => {
    setBusy(true);
    setMsg('');
    setPlan(null);
    try {
      const r = await api<{ plan: CarteraPlan }>('/api/crm/receivables/sheet', 'POST', { action: 'update' });
      setMsg(done(r.plan));
    } catch (e) {
      const body = (e as { body?: { plan?: CarteraPlan } }).body;
      setMsg((e as Error).message);
      if (body?.plan) setPlan(body.plan);
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const load = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await api<{ plan: CarteraPlan }>('/api/crm/receivables/sheet', 'POST', { action: 'load' });
      setPlan(null);
      setMsg(done(r.plan));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  if (!freshness && !configured) return null;
  const stale = !!freshness?.stale || (configured && last?.ok === false);
  return (
    <div
      className={cn(
        'space-y-1 rounded-xl border px-3 py-2 text-xs',
        stale ? 'border-amber-500/40 bg-amber-500/10 text-amber-500' : 'border-border/60 text-muted-foreground'
      )}
    >
      {freshness && (
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1">
            {stale ? '⚠️ ' : '🔄 '}
            {configured ? 'Última carga de la hoja de cartera' : 'Última vez que OpenClaw trajo la cartera'}:{' '}
            <b>
              {dayWord(freshness.loadedAt)}
              {coDateTime(freshness.loadedAt)}
            </b>
            {configured && last?.ok && last.corte ? ` · corte de la hoja ${shortDay(last.corte)}` : ''}
          </p>
          {configured && (
            <Button size="sm" onClick={update} disabled={busy} className="shrink-0">
              {busy ? 'Actualizando…' : '🔄 Actualizar'}
            </Button>
          )}
        </div>
      )}
      {configured && last && !last.ok && (
        <p>
          Último intento ({coDateTime(last.at)}): {last.error}
        </p>
      )}
      {freshness &&
        (freshness.stale ? (
          <p>
            Faltaron {freshness.missed} actualizaci{freshness.missed === 1 ? 'ón' : 'ones'}: los saldos pueden estar viejos.
            {configured ? '' : ' Revisa las cargas de OpenClaw.'}
          </p>
        ) : (
          <p>
            Próxima: {dayWord(freshness.nextAt)}
            {coDateTime(freshness.nextAt)} · se actualiza {freshness.schedule}
          </p>
        ))}
      {configured && !freshness && (
        <Button size="sm" onClick={update} disabled={busy}>
          {busy ? 'Actualizando…' : '🔄 Actualizar ahora'}
        </Button>
      )}
      {configured && !plan && (
        <button className="underline" onClick={preview} disabled={busy}>
          Ver qué cambia antes de cargar
        </button>
      )}
      {msg && <p className="text-foreground">{msg}</p>}
      {plan && <PlanPreview plan={plan} busy={busy} onLoad={load} onCancel={() => setPlan(null)} />}
    </div>
  );
}

function PlanPreview({ plan, busy, onLoad, onCancel }: { plan: CarteraPlan; busy: boolean; onLoad: () => void; onCancel: () => void }) {
  const hard = plan.blockers.filter((b) => !b.startsWith('Se darían por pagadas'));
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border/60 bg-background/60 p-2 text-foreground">
      <p className="font-medium">
        La hoja{plan.corte ? ` (corte ${shortDay(plan.corte)})` : ''} trae {plan.invoices} facturas de {plan.customers} clientes por {money(plan.total)}.
      </p>
      <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
        <li>Nuevas en el CRM: {plan.created}</li>
        <li>Se actualizan: {plan.updated}</li>
        <li>
          Se dan por pagadas (ya no están en la hoja): {plan.closed}
          {plan.closed ? ` · ${money(plan.closedAmount)}` : ''}
        </li>
        {plan.creditNotes > 0 && <li>Notas crédito que no se cargan (las cruzas tú): {plan.creditNotes}</li>}
        <li>Clientes sin WhatsApp vinculado: {plan.unlinked}</li>
      </ul>
      {plan.moves.length > 0 && (
        <div>
          <p className="font-medium text-amber-500">Facturas que cambian de cliente ({plan.moves.length}):</p>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto text-muted-foreground">
            {plan.moves.map((m) => (
              <li key={m.doc}>
                {m.doc} · {money(m.balance)} · {m.from} → <b className="text-foreground">{m.to}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.blockers.map((b) => (
        <p key={b} className="text-amber-500">
          ⚠️ {b}
        </p>
      ))}
      <div className="flex gap-2">
        <Button size="sm" onClick={onLoad} disabled={busy || hard.length > 0}>
          {busy ? 'Cargando…' : 'Confirmar y cargar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/**
 * The sheet's customers whose WhatsApp is not known yet. The CRM never guesses it: you say who is who once, and from
 * then on every load puts their invoices (and the collection buttons) on that contact.
 */
export function CarteraLinks({ onOpenCustomer }: { onOpenCustomer: (id: number) => void }) {
  const { data: sheet } = useCarteraSheet();
  const { data } = useQuery({
    queryKey: ['crm-cartera-links'],
    queryFn: () => api<{ clients: CarteraClient[] }>('/api/crm/receivables/links'),
    enabled: !!sheet?.configured
  });
  const [showLinked, setShowLinked] = useState(false);
  if (!sheet?.configured || !data) return null;
  const pending = data.clients.filter((c) => !c.linked);
  const linked = data.clients.filter((c) => c.linked);
  if (!pending.length && !linked.length) return null;
  return (
    <section className={card}>
      <h2 className="text-sm font-medium">Clientes de la hoja sin WhatsApp ({pending.length})</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        La hoja trae NIT, no celular. Dime una sola vez quién es cada uno y sus facturas quedarán en su chat. Las sugerencias salen de cómo estaban
        antes; confírmalas solo si estás seguro.
      </p>
      <ul className="space-y-2">
        {pending.map((c) => (
          <LinkRow key={c.key} client={c} onOpenCustomer={onOpenCustomer} />
        ))}
      </ul>
      {linked.length > 0 && (
        <div className="mt-3">
          <button className="text-xs underline" onClick={() => setShowLinked(!showLinked)}>
            {showLinked ? 'Ocultar' : 'Ver'} vinculados ({linked.length})
          </button>
          {showLinked && (
            <ul className="mt-2 space-y-1">
              {linked.map((c) => (
                <LinkedRow key={c.key} client={c} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function useLinkAction() {
  const qc = useQueryClient();
  const [err, setErr] = useState('');
  const run = async (body: Record<string, unknown>) => {
    setErr('');
    try {
      await api('/api/crm/receivables/links', 'POST', body);
      qc.invalidateQueries({ queryKey: ['crm-cartera-links'] });
      qc.invalidateQueries({ queryKey: ['crm-sales-clients'] });
      qc.invalidateQueries({ queryKey: ['crm-sales-report'] });
      qc.invalidateQueries({ queryKey: ['crm-receivables'] });
      qc.invalidateQueries({ queryKey: ['crm'] });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return { run, err };
}

/** One billing customer to link to its WhatsApp contact. `sales`: the amount is what they bought (last 12 months). */
export function LinkRow({ client: c, onOpenCustomer, sales }: { client: CarteraClient; onOpenCustomer: (id: number) => void; sales?: boolean }) {
  const { run, err } = useLinkAction();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const { data: found } = useQuery({
    queryKey: ['crm-cartera-search', q],
    queryFn: () => api<{ contacts: { id: number; name: string; phone: string }[] }>(`/api/crm/receivables/links?q=${encodeURIComponent(q)}`),
    enabled: open && q.trim().length >= 2
  });
  const digits = q.replace(/\D/g, '');
  return (
    <li className="rounded-lg border border-border/60 bg-background/40 p-2 text-xs">
      <div className="flex items-center gap-2">
        <button onClick={() => onOpenCustomer(c.contactId)} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-medium">{c.name}</p>
          <p className="text-muted-foreground">
            {c.key.startsWith('NOM:') ? 'Sin NIT en AnaliX' : `NIT/código ${c.key}`} · {c.invoices}{' '}
            {sales ? `línea${c.invoices === 1 ? '' : 's'} de venta · últimos 12 meses` : `factura${c.invoices === 1 ? '' : 's'}`}
          </p>
        </button>
        <span className="shrink-0 font-medium tabular-nums">{money(c.balance)}</span>
      </div>
      {c.suggestion && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1">
            ¿Es <b>{c.suggestion.name || 'sin nombre'}</b> · {formatPhone(c.suggestion.phone)}?
          </span>
          <Button size="sm" variant="outline" onClick={() => run({ key: c.key, contactId: c.suggestion!.id })}>
            Sí, es él
          </Button>
          <Button size="sm" variant="outline" onClick={() => run({ key: c.key, reject: true })}>
            No
          </Button>
        </div>
      )}
      {!open ? (
        <button className="mt-2 underline" onClick={() => setOpen(true)}>
          Buscar su WhatsApp
        </button>
      ) : (
        <div className="mt-2 space-y-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nombre del contacto o su celular"
            className="w-full rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-primary/60"
            autoFocus
          />
          <ul className="space-y-1">
            {(found?.contacts ?? []).map((x) => (
              <li key={x.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {x.name || 'Sin nombre'} · {formatPhone(x.phone)}
                </span>
                <Button size="sm" variant="outline" onClick={() => run({ key: c.key, contactId: x.id })}>
                  Es este
                </Button>
              </li>
            ))}
          </ul>
          {digits.length >= 10 && !(found?.contacts ?? []).length && (
            <Button size="sm" variant="outline" onClick={() => run({ key: c.key, phone: digits })}>
              Usar el celular {digits}
            </Button>
          )}
        </div>
      )}
      {err && <p className="mt-1 text-destructive">{err}</p>}
    </li>
  );
}

function LinkedRow({ client: c }: { client: CarteraClient }) {
  const { run, err } = useLinkAction();
  return (
    <li className="flex items-center gap-2 text-xs">
      <span className="min-w-0 flex-1 truncate">
        {c.name} → <b>{c.linked!.name || 'sin nombre'}</b> · {formatPhone(c.linked!.phone)}
      </span>
      <button
        className="shrink-0 underline"
        onClick={() => confirm(`¿Desvincular ${c.name} de ${c.linked!.name}? Sus facturas quedarán sin WhatsApp hasta que elijas el correcto.`) && run({ key: c.key, unlink: true })}
      >
        Desvincular
      </button>
      {err && <span className="text-destructive">{err}</span>}
    </li>
  );
}
