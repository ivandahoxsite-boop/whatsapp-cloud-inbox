'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, MessageCircle, Sparkles } from 'lucide-react';
import { SEGMENT_INFO, type Segment } from '@/lib/crm/scoring';
import type { Customer } from '@/lib/crm/customers';
import type { MonthlyRevenue } from '@/app/api/crm/summary/route';
import { cn } from '@/lib/utils';

const money = (n: number) => n.toLocaleString('es', { maximumFractionDigits: 0, useGrouping: 'always' });
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(2, 4)}`;
const card = 'rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl';

const SEGMENT_COLOR: Record<Segment, string> = {
  campeon: '#34d399',
  leal: '#38bdf8',
  potencial: '#fbbf24',
  en_riesgo: '#fb923c',
  dormido_valioso: '#e879f9',
  perdido: '#71717a',
  sin_compras: '#52525b'
};

type Action = { customer: Customer; title: string; reason: string; message: string; priority: number };

// Rule-based "next best action" list. No external AI: it ranks customers by
// the money and urgency behind each segment so the day starts with a clear queue.
export function buildActions(customers: Customer[]): Action[] {
  const first = (c: Customer) => (c.name || 'hola').split(' ')[0];
  const out: Action[] = [];
  for (const c of customers) {
    if (c.segment === 'dormido_valioso')
      out.push({
        customer: c,
        title: 'Reactivar cliente valioso',
        reason: `Gastó ${money(c.totalSpent)} y lleva ${c.daysSinceLastSale} días sin comprar`,
        message: `Hola ${first(c)}, hace tiempo que no hablamos. Tenemos novedades que creemos que te van a gustar. ¿Te cuento?`,
        priority: c.totalSpent
      });
    else if (c.segment === 'en_riesgo')
      out.push({
        customer: c,
        title: 'Evitar que se enfríe',
        reason: `${c.salesCount} compras, la última hace ${c.daysSinceLastSale} días`,
        message: `Hola ${first(c)}, ¿cómo te fue con tu última compra? Me encantaría ayudarte con lo siguiente.`,
        priority: c.totalSpent * 0.8
      });
    else if (c.segment === 'potencial' && (c.daysSinceLastSale ?? 99) <= 30)
      out.push({
        customer: c,
        title: 'Seguimiento de compra reciente',
        reason: `Compró hace ${c.daysSinceLastSale} días: buen momento para ofrecer algo más`,
        message: `Hola ${first(c)}, gracias por tu compra. ¿Quieres que te muestre algo que combina con ella?`,
        priority: c.avgTicket
      });
    else if (c.segment === 'campeon')
      out.push({
        customer: c,
        title: 'Ofrecer algo premium',
        reason: `Tus mejores clientes: ${c.salesCount} compras, ${money(c.totalSpent)} en total`,
        message: `Hola ${first(c)}, queremos darte acceso anticipado a lo nuevo. ¿Te interesa?`,
        priority: c.totalSpent * 0.5
      });
  }
  return out.sort((a, b) => b.priority - a.priority).slice(0, 6);
}

export function Overview({
  customers,
  onSegment
}: {
  customers: Customer[];
  onSegment: (s: Segment) => void;
}) {
  const { data } = useQuery({
    queryKey: ['crm-summary', customers.length],
    queryFn: async () => (await (await fetch('/api/crm/summary')).json()) as { months: MonthlyRevenue[] }
  });
  const months = data?.months ?? [];

  const stats = useMemo(() => {
    const withSales = customers.filter((c) => c.salesCount > 0);
    const revenue = withSales.reduce((a, c) => a + c.totalSpent, 0);
    const atRisk = customers.filter((c) => c.segment === 'dormido_valioso' || c.segment === 'en_riesgo');
    const counts = new Map<Segment, number>();
    customers.forEach((c) => counts.set(c.segment, (counts.get(c.segment) ?? 0) + 1));
    return {
      customers: customers.length,
      revenue,
      avgTicket: withSales.length ? revenue / withSales.reduce((a, c) => a + c.salesCount, 0) : 0,
      recoverable: atRisk.reduce((a, c) => a + c.avgTicket, 0),
      atRisk: atRisk.length,
      counts,
      actions: buildActions(customers)
    };
  }, [customers]);

  const last = months[months.length - 1];
  const prev = months[months.length - 2];
  const delta = last && prev && prev.revenue > 0 ? ((last.revenue - prev.revenue) / prev.revenue) * 100 : null;
  const max = Math.max(1, ...months.map((m) => m.revenue));
  const order = (Object.keys(SEGMENT_INFO) as Segment[]).filter((s) => stats.counts.get(s));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
      <Kpi className="md:col-span-2" label="Ingresos históricos" value={money(stats.revenue)} sub={`${stats.customers} clientes${delta === null ? '' : ` · ${delta >= 0 ? '+' : ''}${delta.toFixed(0)}% último mes vs anterior`}`} trend={delta} />
      <Kpi
        className="md:col-span-2"
        label="Ticket promedio"
        value={money(stats.avgTicket)}
        sub="por venta" />
      <Kpi
        className="md:col-span-2"
        label="Ingreso recuperable"
        value={money(stats.recoverable)}
        sub={`${stats.atRisk} clientes dormidos o en riesgo (estimado: 1 compra de ticket promedio c/u)`}
        glow
      />

      <section className={cn(card, 'md:col-span-4')}>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Ingresos por mes</h2>
        {months.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin datos todavía.</p>
        ) : (
          <div className="flex h-40 items-end gap-2">
            {months.map((m) => (
              <div key={m.month} className="group flex h-full min-w-0 flex-1 flex-col items-center gap-1" title={`${m.month}: ${money(m.revenue)} · ${m.sales} ventas`}>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t-md bg-gradient-to-t from-emerald-500/30 to-emerald-400 transition-opacity group-hover:opacity-80"
                    style={{ height: `${Math.max(3, (m.revenue / max) * 100)}%` }}
                  />
                </div>
                <span className="whitespace-nowrap text-[10px] text-muted-foreground">{monthLabel(m.month)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={cn(card, 'md:col-span-2')}>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Tu base por segmento</h2>
        <div className="mb-3 flex h-3 overflow-hidden rounded-full bg-muted">
          {order.map((s) => (
            <div key={s} style={{ width: `${((stats.counts.get(s) ?? 0) / Math.max(1, stats.customers)) * 100}%`, background: SEGMENT_COLOR[s] }} />
          ))}
        </div>
        <ul className="space-y-1">
          {order.map((s) => (
            <li key={s}>
              <button onClick={() => onSegment(s)} className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-accent">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: SEGMENT_COLOR[s] }} />
                {SEGMENT_INFO[s].label}
                <span className="ml-auto tabular-nums text-muted-foreground">{stats.counts.get(s)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className={cn(card, 'md:col-span-6')}>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Sparkles className="h-4 w-4 text-fuchsia-400" /> Acciones recomendadas para hoy
        </h2>
        {stats.actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Importa tus ventas para recibir recomendaciones.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {stats.actions.map((a) => (
              <li key={a.customer.id} className="flex flex-col gap-2 rounded-xl border border-border/60 bg-background/40 p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SEGMENT_COLOR[a.customer.segment] }} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.customer.name || `+${a.customer.phone}`}</p>
                    <p className="text-xs font-medium text-foreground/80">{a.title}</p>
                    <p className="text-xs text-muted-foreground">{a.reason}</p>
                  </div>
                </div>
                <a
                  href={`https://wa.me/${a.customer.phone}?text=${encodeURIComponent(a.message)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-500 hover:bg-emerald-500/25"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> Escribir con mensaje sugerido
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, sub, trend, glow, className }: { label: string; value: string; sub: string; trend?: number | null; glow?: boolean; className?: string }) {
  return (
    <section className={cn(card, glow && 'border-fuchsia-500/40 shadow-[0_0_40px_-12px_rgba(217,70,239,0.55)]', className)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-3xl font-semibold tabular-nums tracking-tight">
        {value}
        {trend != null && (trend >= 0 ? <ArrowUpRight className="h-5 w-5 text-emerald-400" /> : <ArrowDownRight className="h-5 w-5 text-orange-400" />)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </section>
  );
}
