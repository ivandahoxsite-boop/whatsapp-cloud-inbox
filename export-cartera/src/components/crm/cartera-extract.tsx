'use client';

import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CarteraExtract, ExtractBuckets, ExtractGroup, ExtractRow } from '@/lib/crm/cartera-extract';
import { CALI_COMPANY, MAIN_COMPANY, collectionMessage } from '@/lib/crm/collection-messages';
import { WhatsAppLink, api, card, checkCollection, money } from './shared';

/** "2026-10-27" -> "martes, 27 de octubre de 2026", as the Excel report heads it. */
const longDate = (iso: string) => {
  const s = new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const day = (iso: string | null) => (iso ? iso.slice(0, 10).replaceAll('-', '/') : '');
const num = (n: number) => (n < 0 ? `-${money(-n)}` : money(n));
const BUCKETS: [keyof ExtractBuckets, string][] = [
  ['v91', 'Venc_91'],
  ['v61_90', 'Venc_61_90'],
  ['v31_60', 'Venc_31_60'],
  ['v0_30', 'Venc_0_30'],
  ['porVenc', 'Por_Venc']
];
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * The cartera like the billing system's "Reporte Extracto de Cartera": invoices grouped by customer with a total row and
 * the sheet's credit notes subtracted. Days (DiasVc) and aging ranges count from the issue date (the age of the debt).
 * "Solo totales" works like the Excel's outline level 2.
 */
export function CarteraExtractView({ seller, cali, onOpenCustomer }: { seller: string; cali?: boolean; onOpenCustomer: (id: number) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['crm-cartera-extract', seller, !!cali],
    queryFn: () => {
      const q = new URLSearchParams();
      if (seller) q.set('seller', seller);
      if (cali) q.set('tab', 'cali');
      return api<CarteraExtract>(`/api/crm/receivables/extract${q.size ? `?${q}` : ''}`);
    },
    placeholderData: (prev) => prev
  });
  const [q, setQ] = useState('');
  const [onlyTotals, setOnlyTotals] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const s = norm(q.trim());
    const digits = q.replace(/\D/g, '');
    if (!data) return [];
    if (!s) return data.groups;
    return data.groups.filter((g) => norm(g.name).includes(s) || norm(g.cliente).includes(s) || (digits.length >= 3 && g.cliente.replace(/\D/g, '').includes(digits)));
  }, [data, q]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Armando el extracto…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  // With a search, the totals shown are those of the customers found.
  const shown = q.trim()
    ? groups.reduce(
        (t, g) => {
          t.deuda += g.total.deuda;
          t.pagado += g.total.pagado;
          t.saldo += g.total.saldo;
          for (const [k] of BUCKETS) t.buckets[k] += g.total.buckets[k];
          return t;
        },
        { deuda: 0, pagado: 0, saldo: 0, buckets: { v91: 0, v61_90: 0, v31_60: 0, v0_30: 0, porVenc: 0 } }
      )
    : data.grand;
  const isOpen = (k: string) => (onlyTotals ? opened.has(k) : !closed.has(k));
  const flip = (k: string) => {
    const set = onlyTotals ? opened : closed;
    const next = new Set(set);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    (onlyTotals ? setOpened : setClosed)(next);
  };

  const th = 'whitespace-nowrap border-b-2 border-emerald-500/50 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground';
  const td = 'whitespace-nowrap px-2 py-1.5 tabular-nums';
  const right = 'text-right';

  return (
    <section className={cn(card, 'space-y-3 p-0 sm:p-0')}>
      <div className="rounded-t-2xl bg-sky-500/10 px-4 py-3">
        <p className="text-lg font-bold tracking-tight">{cali ? 'Cartera Cali' : 'Reporte Extracto de Cartera'}</p>
        <p className="text-sm font-semibold uppercase">Xsite Group{seller ? ` · ${seller}` : ''}</p>
        <p className="text-xs text-muted-foreground">{longDate(data.date)}</p>
        {cali && (
          <p className="mt-1 text-xs text-muted-foreground">
            {data.sheet
              ? `Pestaña «Cartera Cali» de la hoja${data.sheet.corte ? ` · corte ${day(data.sheet.corte)}` : ''} · leída ${new Date(data.sheet.at).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' })} · va aparte de la cartera principal: no se suma ni se mezcla.`
              : 'Todavía no se ha leído la pestaña «Cartera Cali». Se lee junto con la cartera principal (lun-sáb 10:45, 3:00 y 5:45, o con «Actualizar» en Cartera).'}
          </p>
        )}
        {cali && data.sheet?.error && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">⚠️ La última lectura de Cali tuvo un problema ({data.sheet.error}); se muestra la copia anterior.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 text-sm">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            id="extracto-buscar"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar cliente o NIT"
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
        </label>
        <div className="flex rounded-full border border-border/60 p-0.5 text-xs" role="group" aria-label="Nivel de detalle">
          {[
            [false, 'Ver detalle'],
            [true, 'Solo totales']
          ].map(([v, label]) => (
            <button
              key={String(v)}
              onClick={() => {
                setOnlyTotals(v as boolean);
                setClosed(new Set());
                setOpened(new Set());
              }}
              aria-pressed={onlyTotals === v}
              className={cn('h-8 rounded-full px-3', onlyTotals === v ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {label as string}
            </button>
          ))}
        </div>
      </div>
      <p className="px-3 text-[11px] text-muted-foreground">
        DiasVc = días que lleva la deuda, contados desde la fecha de expedición; el saldo va en el rango de esos días aunque la factura no
        haya vencido. Las notas crédito (en rojo) se restan solo en esta vista.
      </p>

      <div className="overflow-x-auto pb-2">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={cn(th, 'sticky left-0 z-10 bg-card')}>Cliente</th>
              <th className={th}>Nombre_Cliente</th>
              <th className={th}>Documento</th>
              <th className={th}>F_Expedic</th>
              <th className={th}>F_Vencim</th>
              <th className={cn(th, right)}>DiasVc</th>
              <th className={cn(th, right)}>Deuda</th>
              <th className={cn(th, right)}>Pagado</th>
              {BUCKETS.map(([k, label]) => (
                <th key={k} className={cn(th, right)}>
                  {label}
                </th>
              ))}
              <th className={cn(th, right)}>Saldo</th>
              <th className={th}>Cobro</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={15} className="px-3 py-4 text-muted-foreground">
                  {q ? `Ningún cliente coincide con «${q}».` : 'No hay cartera cargada.'}
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <Fragment key={g.key}>
                {isOpen(g.key) &&
                  g.rows.map((r) => <InvoiceRow key={r.doc + (r.credit ? '-nc' : '')} g={g} r={r} td={td} />)}
                <TotalRow g={g} open={isOpen(g.key)} onToggle={() => flip(g.key)} onOpenCustomer={onOpenCustomer} td={td} cali={cali} />
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground/40 bg-emerald-500/10 font-bold">
              <td className={cn(td, 'sticky left-0 bg-card')}>{q ? 'Total búsqueda' : 'Total general'}</td>
              <td className={td}>{groups.length} clientes</td>
              <td className={td} colSpan={4} />
              <td className={cn(td, right)}>{num(shown.deuda)}</td>
              <td className={cn(td, right)}>{num(shown.pagado)}</td>
              {BUCKETS.map(([k]) => (
                <td key={k} className={cn(td, right)}>
                  {num(shown.buckets[k])}
                </td>
              ))}
              <td className={cn(td, right)}>{num(shown.saldo)}</td>
              <td className={td} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function InvoiceRow({ g, r, td }: { g: ExtractGroup; r: ExtractRow; td: string }) {
  return (
    <tr className={cn('border-b border-border/40', r.credit && 'text-rose-600 dark:text-rose-400')}>
      <td className={cn(td, 'sticky left-0 bg-card text-muted-foreground')}>{g.cliente}</td>
      <td className={cn(td, 'max-w-[18rem] truncate')}>{g.name}</td>
      <td className={td}>
        {r.doc}
        {r.credit && <span className="ml-1 rounded bg-rose-500/15 px-1 text-[10px] font-semibold">NC</span>}
      </td>
      <td className={td}>{day(r.issuedAt)}</td>
      <td className={td}>{day(r.dueAt)}</td>
      <td className={cn(td, 'text-right', r.diasVc !== null && r.diasVc > 30 && !r.credit && 'text-amber-600 dark:text-amber-400')}>{r.diasVc ?? ''}</td>
      <td className={cn(td, 'text-right')}>{num(r.deuda)}</td>
      <td className={cn(td, 'text-right')}>{num(r.pagado)}</td>
      {BUCKETS.map(([k]) => (
        <td key={k} className={cn(td, 'text-right', !r.buckets[k] && 'text-muted-foreground/60')}>
          {num(r.buckets[k])}
        </td>
      ))}
      <td className={cn(td, 'text-right font-medium')}>{num(r.saldo)}</td>
      <td className={td} />
    </tr>
  );
}

function TotalRow({
  g,
  open,
  onToggle,
  onOpenCustomer,
  td,
  cali
}: {
  g: ExtractGroup;
  open: boolean;
  onToggle: () => void;
  onOpenCustomer: (id: number) => void;
  td: string;
  cali?: boolean;
}) {
  const cobro = g.oldestDoc
    ? collectionMessage(g.name, [{ doc: g.oldestDoc, balance: g.oldestBalance, daysLate: g.oldestDays }], cali ? CALI_COMPANY : MAIN_COMPANY)?.text
    : undefined;
  return (
    <tr className="border-b border-border bg-muted/50 font-semibold">
      <td className={cn(td, 'sticky left-0 bg-muted')}>
        <button onClick={onToggle} className="flex items-center gap-1" aria-expanded={open} aria-label={open ? 'Cerrar facturas' : 'Ver facturas'}>
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          Total {g.cliente}
        </button>
      </td>
      <td className={cn(td, 'max-w-[18rem] truncate')}>
        {g.contactId ? (
          <button onClick={() => onOpenCustomer(g.contactId!)} className="truncate text-left underline-offset-2 hover:underline">
            {g.name}
          </button>
        ) : (
          g.name
        )}
      </td>
      <td className={cn(td, 'font-normal text-muted-foreground')} colSpan={4}>
        {g.rows.length} doc.
      </td>
      <td className={cn(td, 'text-right')}>{num(g.total.deuda)}</td>
      <td className={cn(td, 'text-right')}>{num(g.total.pagado)}</td>
      {BUCKETS.map(([k]) => (
        <td key={k} className={cn(td, 'text-right', !g.total.buckets[k] && 'font-normal text-muted-foreground/60')}>
          {num(g.total.buckets[k])}
        </td>
      ))}
      <td className={cn(td, 'text-right')}>{num(g.total.saldo)}</td>
      <td className={td}>
        {g.hasPhone ? (
          <WhatsAppLink
            phone={g.phone}
            text={cobro}
            // Cali debts are not in the CRM's cartera, so its check does not ask for overdue debt there (only hours, etc.).
            beforeOpen={cobro && g.contactId ? () => checkCollection(g.contactId!, { reminder: !!cali }) : undefined}
            className="inline-flex h-7 items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 text-[11px] font-medium text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
          >
            💬 WhatsApp
          </WhatsAppLink>
        ) : (
          <span className="font-normal text-muted-foreground">Sin WhatsApp</span>
        )}
      </td>
    </tr>
  );
}
