'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';
import { CommandPalette, type CrmTab } from '@/components/crm/command-palette';
import { Overview } from '@/components/crm/overview';
import { CustomersView } from '@/components/crm/customers-view';
import { CustomerSheet } from '@/components/crm/customer-sheet';
import { LockGate } from '@/components/crm/lock-gate';
import { ReceivablesView } from '@/components/crm/receivables-view';
import { SalesReportView } from '@/components/crm/sales-report';
import { Campaigns } from '@/components/crm/campaigns';
import { SegmentsView } from '@/components/crm/segments-view';
import { Importer } from '@/components/crm/importer';
import { Structure } from '@/components/crm/structure';
import { Approvals } from '@/components/crm/approvals';
import { useCrmData, useLiveSync } from '@/components/crm/shared';
import type { CustomerFilter } from '@/lib/crm/filters';

const TAB_LABEL: Record<CrmTab, string> = {
  resumen: 'Resumen',
  clientes: 'Clientes',
  ventas: 'Ventas',
  cartera: 'Cartera',
  segmentos: 'Segmentos',
  campanas: 'Campañas',
  aprobaciones: 'Aprobaciones',
  importar: 'Importar',
  estructura: 'Estructura'
};

export default function CrmPage() {
  const [tab, setTab] = useState<CrmTab>('resumen');
  const [filter, setFilter] = useState<CustomerFilter>({});
  const [draft, setDraft] = useState<CustomerFilter>({});
  const [openId, setOpenId] = useState<number | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { data, error, isLoading } = useCrmData();
  useLiveSync();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const showCustomers = (f: CustomerFilter) => {
    setFilter(f);
    setTab('clientes');
    scrollRef.current?.scrollTo({ top: 0 });
  };

  return (
    // The inbox locks html/body scrolling for its full-screen layout, so the CRM scrolls inside its own
    // full-height container; that works regardless of the global styles or the browser.
    <div
      ref={scrollRef}
      data-crm-page
      className="relative h-[100dvh] overflow-y-auto overflow-x-clip overscroll-y-contain bg-background text-foreground"
    >
      <div aria-hidden className="pointer-events-none fixed inset-0 opacity-60 dark:opacity-100">
        <div className="absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-emerald-500/15 blur-[120px]" />
        <div className="absolute -right-40 top-20 h-[26rem] w-[26rem] rounded-full bg-fuchsia-500/15 blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 h-[24rem] w-[24rem] rounded-full bg-sky-500/10 blur-[120px]" />
      </div>

      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pt-3">
          <Link href="/" className="text-muted-foreground hover:text-foreground" aria-label="Volver a la bandeja">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">CRM</h1>
          <button
            onClick={() => setPaletteOpen(true)}
            className="ml-auto flex h-9 items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3 text-sm text-muted-foreground hover:text-foreground"
          >
            <Search className="h-4 w-4" />
            <span className="hidden sm:inline">Pregunta o busca…</span>
            <kbd className="hidden rounded border px-1.5 text-[10px] sm:inline">⌘K</kbd>
          </button>
          <ThemeToggle />
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-2 [scrollbar-width:none]">
          {(Object.keys(TAB_LABEL) as CrmTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'h-8 shrink-0 rounded-full px-3 text-sm transition-colors',
                tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </nav>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl p-3 sm:p-4">
        {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {data && tab === 'resumen' && <Overview data={data} onFilter={showCustomers} />}
        {data && tab === 'clientes' && (
          <CustomersView
            data={data}
            filter={filter}
            setFilter={setFilter}
            onOpen={setOpenId}
            onSaveSegment={(f) => {
              setDraft(f);
              setTab('segmentos');
            }}
          />
        )}
        {data && tab === 'ventas' && (
          <LockGate what="las ventas" tiles={['Ventas', 'Unidades', 'Líneas de venta', 'Clientes que compraron']}>
            <SalesReportView onOpenCustomer={setOpenId} />
          </LockGate>
        )}
        {data && tab === 'cartera' && (
          <LockGate what="la cartera" tiles={['Por cobrar', 'Vencida', 'Facturas abiertas', 'Clientes que deben']}>
            <ReceivablesView onOpenCustomer={setOpenId} />
          </LockGate>
        )}
        {data && tab === 'segmentos' && <SegmentsView data={data} draft={draft} setDraft={setDraft} onOpen={showCustomers} />}
        {data && tab === 'campanas' && <Campaigns data={data} />}
        {tab === 'aprobaciones' && <Approvals />}
        {data && tab === 'importar' && <Importer data={data} onDone={() => setTab('resumen')} />}
        {data && tab === 'estructura' && <Structure data={data} />}
      </main>

      {data && <CustomerSheet customerId={openId} data={data} onClose={() => setOpenId(null)} />}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        customers={data?.customers ?? []}
        onTab={setTab}
        onFilter={showCustomers}
        onOpenCustomer={setOpenId}
      />
    </div>
  );
}
