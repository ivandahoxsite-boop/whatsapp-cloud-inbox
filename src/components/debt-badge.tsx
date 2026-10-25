'use client';

import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import type { DebtFlag } from '@/lib/crm/receivables';

const money = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

/** "573001234567" for any spelling of a number; Colombian mobiles without 57 get it added. */
export const phoneKey = (phone?: string) => {
  const d = (phone ?? '').replace(/\D/g, '');
  return /^3\d{9}$/.test(d) ? `57${d}` : d;
};

/** Debts by WhatsApp number, refreshed every few minutes (the inbox does not poll the CRM). */
export function useDebts() {
  const { data } = useQuery({
    queryKey: ['crm-debts'],
    queryFn: async () => {
      const r = await fetch('/api/crm/debts');
      if (!r.ok) return {} as Record<string, DebtFlag>;
      return ((await r.json()) as { debts: Record<string, DebtFlag> }).debts;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000
  });
  return data ?? {};
}

/** "⚠️ Debe $1.200.000 · 45 días de mora" (amber/red when overdue, grey when the debt is not due yet). */
export function DebtBadge({ debt, className }: { debt?: DebtFlag; className?: string }) {
  if (!debt) return null;
  const late = debt.overdue > 0;
  return (
    <span
      className={cn(
        'inline-block truncate rounded-full px-2 py-0.5 text-[11px] font-medium leading-4',
        late ? (debt.days > 60 ? 'bg-rose-500/15 text-rose-500' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400') : 'bg-muted text-muted-foreground',
        className
      )}
    >
      {late ? `⚠️ Debe ${money(debt.overdue)} · ${debt.days} días de mora` : `Debe ${money(debt.balance)} · al día`}
    </span>
  );
}
