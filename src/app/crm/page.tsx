'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';
import { ReceivablesView } from '@/components/crm/receivables-view';
import { CaliView } from '@/components/crm/cali-view';
import { ApprovalsView } from '@/components/crm/approvals-view';

/**
 * Export of the cartera module: only the two cartera tabs of the original CRM page ("Cartera" and "Cartera Cali"),
 * with the same links (#por-vencer, #cartera-cali), plus "Aprobaciones" (#aprobaciones) for the reminders queued with "Recordar". The original page also has Resumen, Clientes, Ventas, Pendientes...
 * The customer file (ficha) is another module: plug your own in `openCustomer`.
 */
type Tab = 'cartera' | 'cali' | 'aprobaciones';
const TAB_LABEL: Record<Tab, string> = { cartera: 'Cartera', cali: 'Cartera Cali', aprobaciones: 'Aprobaciones' };

export default function CrmPage() {
  const [tab, setTab] = useState<Tab>('cartera');
  useEffect(() => {
    const go = () => {
      if (window.location.hash === '#por-vencer') setTab('cartera');
      if (window.location.hash === '#cartera-cali') setTab('cali');
      if (window.location.hash === '#aprobaciones') setTab('aprobaciones');
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, []);
  const openCustomer = (id: number) => {
    // The original CRM opens the customer's file here.
    console.info('Abrir ficha del cliente', id);
  };
  return (
    // html/body keep overflow: hidden (globals.css, from the inbox), so the page scrolls inside this box; the header stays
    // sticky inside it. Without it the page cannot be scrolled on a phone at all.
    <div className="h-dvh overflow-y-auto overscroll-contain bg-background" data-testid="crm-scroll">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <h1 className="flex-1 text-xl font-bold tracking-tight">CRM Alfonso</h1>
          <ThemeToggle />
        </div>
        <nav className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 pb-2" aria-label="Secciones">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'h-9 shrink-0 rounded-full px-4 text-sm',
                tab === t ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-4">
        {tab === 'cartera' && <ReceivablesView onOpenCustomer={openCustomer} />}
        {tab === 'cali' && <CaliView onOpenCustomer={openCustomer} />}
        {tab === 'aprobaciones' && <ApprovalsView />}
      </main>
    </div>
  );
}
