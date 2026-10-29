'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
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
import { PendingView } from '@/components/crm/pending-view';
import { tasksQuery } from '@/components/crm/task-list';
import type { PendingChat } from '@/lib/crm/pending-info';
import { api, useCrmData, useLiveSync } from '@/components/crm/shared';
import type { CustomerFilter } from '@/lib/crm/filters';

const TAB_LABEL: Record<CrmTab, string> = {
  resumen: 'Resumen',
  clientes: 'Clientes',
  ventas: 'Ventas',
  cartera: 'Cartera',
  pendientes: 'Pendientes',
  segmentos: 'Segmentos',
  campanas: 'Campañas',
  aprobaciones: 'Aprobaciones',
  importar: 'Importar',
  estructura: 'Estructura'
};

export default function CrmPage() {
  const [tab, setTab] = useState<CrmTab>('resumen');
  // A notification opens /crm#por-vencer (straight to Cartera, where that list is) or /crm#pendientes (to-dos).
  useEffect(() => {
    const go = () => {
      if (window.location.hash === '#por-vencer') setTab('cartera');
      if (window.location.hash === '#pendientes') setTab('pendientes');
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, []);
  const [filter, setFilter] = useState<CustomerFilter>({});
  const [draft, setDraft] = useState<CustomerFilter>({});
  const [openId, setOpenId] = useState<number | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { data, error, isLoading } = useCrmData();
  const { newBuild } = useLiveSync();
  // Red number on "Pendientes": detected chats to attend + your own to-dos due today or overdue.
  const { data: pend } = useQuery({ queryKey: ['crm-pending'], queryFn: () => api<{ chats: PendingChat[] }>('/api/crm/pending') });
  const { data: tasks } = useQuery(tasksQuery());
  const pendingCount = (pend?.chats.length ?? 0) + (tasks?.tasks.filter((t) => t.dueDate && t.dueDate <= tasks.today).length ?? 0);

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
        <div className="absolute -left-40 -top-40 h-[30rem] w-[30rem] rounded-full bg-emerald-500/20 blur-[120px] dark:bg-[#00e05a]/15" />
        <div className="absolute -right-40 top-20 h-[26rem] w-[26rem] rounded-full bg-fuchsia-500/15 blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 h-[24rem] w-[24rem] rounded-full bg-sky-500/10 blur-[120px]" />
      </div>

      {/* Green Lantern header: deep green band, neon green line and active tab (the user's choice). */}
      <header className="sticky top-0 z-20 border-b border-emerald-500/30 bg-gradient-to-b from-emerald-100/90 to-emerald-50/80 shadow-[0_6px_24px_-12px_rgba(0,224,90,0.45)] backdrop-blur-xl dark:border-[#00e05a]/40 dark:from-[#03301a]/95 dark:to-[#06200f]/90">
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
                'h-8 shrink-0 rounded-full px-3 text-sm transition-all',
                tab === t
                  ? 'bg-[#00c853] font-semibold text-white shadow-[0_0_16px_rgba(0,200,83,0.55)] dark:bg-[#00e05a] dark:text-[#022c14] dark:shadow-[0_0_20px_rgba(0,224,90,0.65)]'
                  : 'text-emerald-900/75 hover:bg-emerald-500/15 hover:text-emerald-950 dark:text-emerald-100/80 dark:hover:bg-[#00e05a]/15 dark:hover:text-white'
              )}
            >
              {TAB_LABEL[t]}
              {t === 'pendientes' && pendingCount > 0 && (
                <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-medium text-white">{pendingCount}</span>
              )}
            </button>
          ))}
        </nav>
      </header>

      {newBuild && (
        <div className="relative z-20 mx-auto flex max-w-6xl items-center gap-3 px-4 pt-3">
          <p className="min-w-0 flex-1 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">
            Hay una versión nueva del CRM.
          </p>
          <button onClick={() => window.location.reload()} className="h-9 shrink-0 rounded-full bg-primary px-4 text-sm text-primary-foreground">
            Actualizar
          </button>
        </div>
      )}

      <main className="relative z-10 mx-auto max-w-6xl p-3 sm:p-4">
        {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {data && tab === 'resumen' && <Overview data={data} onFilter={showCustomers} onPending={() => setTab('pendientes')} onOpenCustomer={setOpenId} />}
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
        {data && tab === 'cartera' && <ReceivablesView onOpenCustomer={setOpenId} />}
        {tab === 'pendientes' && <PendingView onOpenCustomer={setOpenId} />}
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
