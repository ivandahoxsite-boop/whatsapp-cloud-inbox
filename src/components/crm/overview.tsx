'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, MapPin, MessageCircle, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RECURRENCE_INFO, SEGMENT_INFO, type Recurrence, type Segment } from '@/lib/crm/scoring';
import { buildActions } from '@/lib/crm/actions';
import { cityKey, type CustomerFilter } from '@/lib/crm/filters';
import type { Summary } from '@/app/api/crm/summary/route';
import { RECURRENCE_COLOR, SEGMENT_COLOR, TagPill, ago, api, card, cityOptions, money, type CrmData } from './shared';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(2, 4)}`;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function Overview({ data, onFilter }: { data: CrmData; onFilter: (f: CustomerFilter) => void }) {
  const [city, setCity] = useState('');
  const { data: summary } = useQuery({
    queryKey: ['crm-summary', data.customers.length],
    queryFn: () => api<Summary>('/api/crm/summary')
  });

  const customers = useMemo(
    () => (city ? data.customers.filter((c) => cityKey(c.city) === cityKey(city)) : data.customers),
    [data.customers, city]
  );
  // Every drill-down keeps the dashboard's city filter.
  const go = (f: CustomerFilter) => onFilter(city ? { ...f, cities: [city] } : f);

  const s = useMemo(() => {
    const buyers = customers.filter((c) => c.salesCount > 0);
    const repeaters = buyers.filter((c) => c.avgIntervalDays != null);
    const revenue = buyers.reduce((a, c) => a + c.totalSpent, 0);
    const salesCount = buyers.reduce((a, c) => a + c.salesCount, 0);
    const due = customers.filter((c) => c.recurrence === 'por_recomprar');
    const rec = new Map<Recurrence, number>();
    const seg = new Map<Segment, number>();
    customers.forEach((c) => {
      rec.set(c.recurrence, (rec.get(c.recurrence) ?? 0) + 1);
      seg.set(c.segment, (seg.get(c.segment) ?? 0) + 1);
    });
    return {
      total: customers.length,
      buyers: buyers.length,
      prospects: customers.length - buyers.length,
      repeaters: repeaters.length,
      revenue,
      avgTicket: salesCount ? revenue / salesCount : 0,
      due: due.length,
      dueValue: due.reduce((a, c) => a + c.avgTicket, 0),
      awaiting: customers
        .filter((c) => c.awaitingReply)
        .sort((a, b) => (a.lastInboundAt ?? '').localeCompare(b.lastInboundAt ?? '')),
      rec,
      seg,
      actions: buildActions(customers)
    };
  }, [customers]);

  const cities = useMemo(() => {
    return cityOptions(data.customers)
      .slice(0, 8)
      .map((o) => {
        const list = data.customers.filter((c) => cityKey(c.city) === cityKey(o.name));
        const buyers = list.filter((c) => c.salesCount > 0);
        return {
          name: o.name,
          customers: list.length,
          revenue: list.reduce((a, c) => a + c.totalSpent, 0),
          repeatRate: pct(buyers.filter((c) => c.avgIntervalDays != null).length, buyers.length)
        };
      });
  }, [data.customers]);
  const noCity = data.customers.filter((c) => !c.city).length;
  const maxCityRevenue = Math.max(1, ...cities.map((c) => c.revenue));

  const months = summary?.months ?? [];
  const maxMonth = Math.max(1, ...months.map((m) => m.revenue));
  const delta = summary && summary.prev30 > 0 ? ((summary.last30 - summary.prev30) / summary.prev30) * 100 : null;
  const recOrder = (Object.keys(RECURRENCE_INFO) as Recurrence[]).filter((r) => s.rec.get(r));
  const segOrder = (Object.keys(SEGMENT_INFO) as Segment[]).filter((x) => s.seg.get(x));
  const maxProduct = Math.max(1, ...(summary?.products ?? []).map((p) => p.revenue));

  if (data.customers.length === 0) {
    return (
      <div className={cn(card, 'space-y-2 text-sm')}>
        <p className="font-medium">Tu CRM está vacío.</p>
        <p className="text-muted-foreground">
          Ve a <b>Importar</b>: trae tu historial de WhatsApp desde Kapso y sube tus ventas pasadas (CSV). Con eso verás aquí quién espera tu
          respuesta, quién es recurrente, a quién le toca comprar y qué ciudades te compran más.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-muted-foreground" />
        <select value={city} onChange={(e) => setCity(e.target.value)} className="h-9 rounded-full border border-border/60 bg-card/50 px-3 text-sm">
          <option value="">Todas las ciudades</option>
          {cityOptions(data.customers).map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.count})
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Clientes" value={String(s.buyers)} sub={`${s.prospects} prospectos sin compra`} onClick={() => go({})} />
        <Kpi
          label="Tasa de recompra"
          value={`${pct(s.repeaters, s.buyers)}%`}
          sub={`${s.repeaters} compraron 2+ veces`}
          onClick={() => go({ recurrence: ['recurrente', 'por_recomprar', 'recurrente_perdido'] })}
        />
        <Kpi
          label="Ventas 30 días"
          value={money(summary?.last30 ?? 0)}
          sub={delta == null ? 'todas las ciudades' : `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}% vs 30 días antes`}
          trend={delta}
        />
        <Kpi label="Ticket promedio" value={money(s.avgTicket)} sub={`${money(s.revenue)} en total`} />
        <Kpi
          label="Les toca recomprar"
          value={String(s.due)}
          sub={s.due ? `≈ ${money(s.dueValue)} si vuelven hoy` : 'nadie atrasado'}
          glow={s.due > 0}
          onClick={() => go({ recurrence: ['por_recomprar'] })}
          className="col-span-2 lg:col-span-1"
        />
      </div>

      {s.awaiting.length > 0 && (
        <section className={cn(card, 'border-amber-400/40')}>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-medium">⏳ Esperan tu respuesta</h2>
            <span className="rounded-full bg-amber-400/20 px-2 text-xs tabular-nums text-amber-500">{s.awaiting.length}</span>
            <button onClick={() => go({ awaiting: true })} className="ml-auto text-xs text-muted-foreground underline">
              Ver todos
            </button>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {s.awaiting.slice(0, 6).map((c) => (
              <li key={c.id} className="flex flex-col gap-1 rounded-xl border border-border/60 bg-background/40 p-3">
                <div className="flex items-baseline gap-2">
                  <p className="truncate text-sm font-medium">{c.name || `+${c.phone}`}</p>
                  <span className="ml-auto shrink-0 text-[11px] text-amber-500">{ago(c.lastInboundAt)}</span>
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">“{c.lastInboundText}”</p>
                <a
                  href={`https://wa.me/${c.phone}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-500 hover:bg-emerald-500/25"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> Responder
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* grid-cols-1 = minmax(0,1fr): lets wide content (the chart) shrink instead of overflowing on phones */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
        <section className={cn(card, 'md:col-span-4')}>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            <h2 className="text-sm font-medium text-muted-foreground">Ingresos por mes</h2>
            <Legend color="#38bdf8" label="Primera compra" />
            <Legend color="#34d399" label="Recompras" />
          </div>
          {months.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ventas todavía.</p>
          ) : (
            <div className="flex h-44 items-end gap-1.5">
              {months.map((m, i) => (
                <div
                  key={m.month}
                  // Phones show the last 6 months so labels stay readable.
                  className={cn('group h-full min-w-0 flex-1 flex-col items-center gap-1', i < months.length - 6 ? 'hidden sm:flex' : 'flex')}
                  title={`${monthLabel(m.month)}: ${money(m.revenue)} (${money(m.repeatRevenue)} recompras) · ${m.sales} ventas`}
                >
                  <div className="flex w-full flex-1 flex-col justify-end overflow-hidden rounded-t-md">
                    <div className="w-full bg-emerald-400/90" style={{ height: `${(m.repeatRevenue / maxMonth) * 100}%` }} />
                    <div className="w-full bg-sky-400/80" style={{ height: `${(m.newRevenue / maxMonth) * 100}%` }} />
                  </div>
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">{monthLabel(m.month)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={cn(card, 'md:col-span-2')}>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Tipo de cliente</h2>
          <StackBar parts={recOrder.map((r) => ({ value: s.rec.get(r) ?? 0, color: RECURRENCE_COLOR[r] }))} />
          <ul className="mt-3 space-y-0.5">
            {recOrder.map((r) => (
              <Row
                key={r}
                color={RECURRENCE_COLOR[r]}
                label={RECURRENCE_INFO[r].label}
                value={s.rec.get(r) ?? 0}
                hint={RECURRENCE_INFO[r].hint}
                onClick={() => go({ recurrence: [r] })}
              />
            ))}
          </ul>
        </section>

        <section className={cn(card, 'md:col-span-6')}>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Sparkles className="h-4 w-4 text-fuchsia-400" /> Acciones recomendadas para hoy
          </h2>
          {s.actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin acciones pendientes. Importa más ventas para recibir recomendaciones.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {s.actions.map((a) => (
                <li key={a.customer.id} className="flex flex-col gap-2 rounded-xl border border-border/60 bg-background/40 p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: RECURRENCE_COLOR[a.customer.recurrence] }} />
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
                    className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-500 hover:bg-emerald-500/25"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> Escribir con mensaje sugerido
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={cn(card, 'md:col-span-3')}>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Ciudades</h2>
          {cities.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay ciudades. Agrégalas en la ficha del cliente, en lote desde Clientes, o al importar.</p>
          ) : (
            <ul className="space-y-2">
              {cities.map((c) => (
                <li key={c.name}>
                  <button onClick={() => onFilter({ cities: [c.name] })} className="w-full rounded-lg p-1 text-left hover:bg-accent/50">
                    <div className="flex items-baseline gap-2 text-sm">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.customers} clientes · {c.repeatRate}% recompra
                      </span>
                      <span className="ml-auto tabular-nums">{money(c.revenue)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-sky-400" style={{ width: `${(c.revenue / maxCityRevenue) * 100}%` }} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {noCity > 0 && <p className="mt-2 text-xs text-muted-foreground">{noCity} clientes sin ciudad.</p>}
        </section>

        <section className={cn(card, 'md:col-span-3')}>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Productos más vendidos</h2>
          {(summary?.products ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin productos todavía.</p>
          ) : (
            <ul className="space-y-2">
              {summary!.products.map((p) => (
                <li key={p.product}>
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="truncate font-medium">{p.product}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.sales} ventas · {p.customers} clientes
                    </span>
                    <span className="ml-auto tabular-nums">{money(p.revenue)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${(p.revenue / maxProduct) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={cn(card, 'md:col-span-3')}>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Valor del cliente (RFM)</h2>
          <StackBar parts={segOrder.map((x) => ({ value: s.seg.get(x) ?? 0, color: SEGMENT_COLOR[x] }))} />
          <ul className="mt-3 space-y-0.5">
            {segOrder.map((x) => (
              <Row key={x} color={SEGMENT_COLOR[x]} label={SEGMENT_INFO[x].label} value={s.seg.get(x) ?? 0} hint={SEGMENT_INFO[x].hint} onClick={() => go({ rfm: [x] })} />
            ))}
          </ul>
        </section>

        <section className={cn(card, 'md:col-span-3')}>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Etiquetas</h2>
          {data.tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aún no tienes etiquetas. Ábrelas desde la ficha de un cliente o selecciona varios en <b>Clientes</b> y usa “Etiquetar”. Ideas: VIP,
              Mayorista, Referido, Instagram.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.tags.map((t) => (
                <button key={t.id} onClick={() => go({ tags: [t.id] })} className="rounded-full hover:opacity-80">
                  <TagPill tag={{ ...t, name: `${t.name} · ${t.count}` }} />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  trend,
  glow,
  onClick,
  className
}: {
  label: string;
  value: string;
  sub: string;
  trend?: number | null;
  glow?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={cn(
        card,
        'p-3 text-left sm:p-4',
        onClick && 'transition-colors hover:border-primary/50',
        glow && 'border-amber-400/50 shadow-[0_0_40px_-14px_rgba(251,191,36,0.6)]',
        className
      )}
    >
      <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
      <p className="mt-1 flex items-center gap-1 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">
        {value}
        {trend != null && (trend >= 0 ? <ArrowUpRight className="h-5 w-5 text-emerald-400" /> : <ArrowDownRight className="h-5 w-5 text-orange-400" />)}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground sm:text-xs">{sub}</p>
    </Tag>
  );
}

function StackBar({ parts }: { parts: { value: number; color: string }[] }) {
  const total = Math.max(1, parts.reduce((a, p) => a + p.value, 0));
  return (
    <div className="flex h-3 overflow-hidden rounded-full bg-muted">
      {parts.map((p, i) => (
        <div key={i} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
      ))}
    </div>
  );
}

function Row({ color, label, value, hint, onClick }: { color: string; label: string; value: number; hint: string; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} title={hint} className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        {label}
        <span className="ml-auto tabular-nums text-muted-foreground">{value}</span>
      </button>
    </li>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
