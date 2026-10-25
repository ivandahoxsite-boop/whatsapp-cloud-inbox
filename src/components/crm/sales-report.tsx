'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import type { SalesReport } from '@/lib/crm/reports';
import { api, card, money } from './shared';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(2, 4)}`;
const select = 'h-9 rounded-full border border-border/60 bg-card/50 px-3 text-sm';

/** Horizontal bars; `value` decides the width, `sub` the small grey text. */
function Bars({ rows, onPick }: { rows: { key: string; label: string; value: number; sub?: string }[]; onPick?: (key: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-xs text-muted-foreground">Sin datos en este periodo.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key}>
          <button
            disabled={!onPick}
            onClick={() => onPick?.(r.key)}
            className={cn('block w-full text-left', onPick && 'hover:opacity-80')}
          >
            <div className="flex items-baseline gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span className="shrink-0 tabular-nums">{money(r.value)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-400" style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
            {r.sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{r.sub}</p>}
          </button>
        </li>
      ))}
    </ul>
  );
}

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section className={card}>
    <h2 className="text-sm font-medium">{title}</h2>
    {hint && <p className="mb-3 text-xs text-muted-foreground">{hint}</p>}
    {!hint && <div className="mb-3" />}
    {children}
  </section>
);

export function SalesReportView({ onOpenCustomer }: { onOpenCustomer: (id: number) => void }) {
  const [year, setYear] = useState<string>('');
  const [seller, setSeller] = useState('');
  const [zone, setZone] = useState('');

  const qs = new URLSearchParams();
  if (year) {
    qs.set('from', `${year}-01-01`);
    qs.set('to', `${year}-12-31`);
  }
  if (seller) qs.set('seller', seller);
  if (zone) qs.set('zone', zone);
  const { data, isLoading, error } = useQuery({
    queryKey: ['crm-sales-report', year, seller, zone],
    queryFn: () => api<SalesReport>(`/api/crm/reports/sales?${qs}`),
    placeholderData: (prev) => prev
  });

  const years = data?.years ?? [];
  const monthly = data?.byMonth ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={year} onChange={(e) => setYear(e.target.value)} className={select} aria-label="Año">
          <option value="">Todos los años</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select value={seller} onChange={(e) => setSeller(e.target.value)} className={select} aria-label="Vendedor">
          <option value="">Todos los vendedores</option>
          {(data?.sellers ?? []).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={zone} onChange={(e) => setZone(e.target.value)} className={select} aria-label="Zona">
          <option value="">Todas las zonas</option>
          {(data?.zones ?? []).map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Calculando…</p>}
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Ventas', money(data.totals.amount)],
              ['Unidades', money(data.totals.qty)],
              ['Líneas de venta', money(data.totals.sales)],
              ['Clientes que compraron', money(data.totals.customers)]
            ].map(([label, value]) => (
              <div key={label} className={card}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>

          <Section title="Ventas por mes" hint={monthly.length > 24 ? 'Elige un año para ver el detalle mensual.' : undefined}>
            <Bars
              rows={monthly.slice(-24).map((m) => ({ key: m.month, label: monthLabel(m.month), value: m.amount, sub: `${money(m.qty)} unidades` }))}
            />
          </Section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="Por vendedor" hint="Toca uno para filtrar todo el reporte.">
              <Bars
                rows={data.bySeller.map((s) => ({ key: s.name, label: s.name, value: s.amount, sub: `${s.customers} clientes · ${money(s.qty)} unidades` }))}
                onPick={(k) => k !== 'Sin vendedor' && setSeller(k)}
              />
            </Section>
            <Section title="Por zona" hint="Toca una para filtrar todo el reporte.">
              <Bars
                rows={data.byZone.map((z) => ({ key: z.name, label: z.name, value: z.amount, sub: `${z.customers} clientes · ${money(z.qty)} unidades` }))}
                onPick={(k) => k !== 'Sin zona' && setZone(k)}
              />
            </Section>
          </div>

          <Section title="Productos que más venden">
            <Bars
              rows={data.topProducts.slice(0, 15).map((p) => ({ key: p.product, label: p.product, value: p.amount, sub: `${p.customers} clientes · ${money(p.qty)} unidades` }))}
            />
          </Section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="Se compran juntos" hint="Productos que el mismo cliente llevó en el mismo mes. Sirve para ofrecer el segundo al vender el primero.">
              {data.combos.length ? (
                <ul className="space-y-2 text-sm">
                  {data.combos.map((c) => (
                    <li key={`${c.a}|${c.b}`} className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{c.a}</span>
                        <span className="block truncate text-muted-foreground">+ {c.b}</span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{c.times} veces</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Aún no hay combinaciones que se repitan.</p>
              )}
            </Section>

            <Section title="Dejaron de llevar un producto" hint="Siguen comprando, pero hace más de 6 meses no piden algo que antes llevaban seguido. Buen motivo para escribirles.">
              {data.droppedProducts.length ? (
                <ul className="space-y-2 text-sm">
                  {data.droppedProducts.map((d) => (
                    <li key={`${d.customerId}|${d.product}`}>
                      <button onClick={() => onOpenCustomer(d.customerId)} className="block w-full text-left hover:opacity-80">
                        <span className="block truncate font-medium">{d.customer || `Cliente ${d.customerId}`}</span>
                        <span className="block truncate text-muted-foreground">{d.product}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {d.times} compras · {money(d.amount)} · última {d.lastAt.slice(0, 7)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Nadie en este periodo.</p>
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
