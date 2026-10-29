'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, BellOff, CalendarClock, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DueCustomer } from '@/lib/crm/push';
import { preDueMessage } from '@/lib/crm/collection-messages';
import { WhatsAppLink, api, card, checkCollection, formatPhone, money } from './shared';

type Due = { from: string; to: string; customers: DueCustomer[] };

const shortDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
};

const base64ToBytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/**
 * Notifications on this phone or computer (Web Push). The CRM sends, Monday to Saturday at 8:00, what falls due on the
 * next working day; tapping it opens this list.
 */
function PushToggle() {
  const [state, setState] = useState<'checking' | 'unsupported' | 'off' | 'on' | 'blocked'>('checking');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return setState('unsupported');
      if (Notification.permission === 'denied') return setState('blocked');
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      setState((await reg?.pushManager.getSubscription()) ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
  }, []);

  const turnOn = async () => {
    setBusy(true);
    setMsg('');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setState(perm === 'denied' ? 'blocked' : 'off');
        return;
      }
      const { publicKey } = await api<{ publicKey: string }>('/api/crm/push');
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(publicKey) }));
      const ua = navigator.userAgent;
      const device = /Android/i.test(ua) ? 'Celular Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : 'Computador';
      await api('/api/crm/push', 'POST', { subscription: sub.toJSON(), device });
      setState('on');
      setMsg('Listo: este equipo recibirá el aviso de lunes a sábado a las 8:00 a. m. Toca «Probar» para ver cómo llega.');
    } catch (e) {
      setMsg(`No se pudieron activar los avisos: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api('/api/crm/push', 'DELETE', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState('off');
      setMsg('Avisos apagados en este equipo.');
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setMsg('');
    try {
      const r = await api<{ sent: number; failed: number }>('/api/crm/push/test', 'POST');
      setMsg(r.sent ? 'Aviso enviado: debe llegarte en unos segundos.' : 'No se pudo enviar el aviso de prueba.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  if (state === 'checking') return null;
  return (
    <div className="space-y-1 text-xs">
      {state === 'unsupported' && <p className="text-muted-foreground">Este navegador no permite avisos. En Android usa Chrome.</p>}
      {state === 'blocked' && (
        <p className="text-amber-600 dark:text-amber-400">
          Bloqueaste las notificaciones del CRM. Actívalas en Chrome: candado junto a la dirección → Permisos → Notificaciones → Permitir.
        </p>
      )}
      {state === 'off' && (
        <Button size="sm" onClick={turnOn} disabled={busy}>
          <Bell className="size-4" /> Avisarme en este equipo
        </Button>
      )}
      {state === 'on' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-emerald-600 dark:text-emerald-400">🔔 Avisos activos en este equipo</span>
          <Button size="sm" variant="outline" onClick={test}>
            Probar
          </Button>
          <Button size="sm" variant="ghost" onClick={turnOff} disabled={busy}>
            <BellOff className="size-4" /> Apagar
          </Button>
        </div>
      )}
      {msg && <p className="text-muted-foreground">{msg}</p>}
    </div>
  );
}

type Light = 'rojo' | 'naranja' | 'verde' | 'pasado';
const LIGHTS: { key: Light; dot: string; label: (days: number) => string; ring: string; bg: string }[] = [
  { key: 'rojo', dot: '🔴', label: () => 'Con facturas vencidas', ring: 'border-rose-500/50', bg: 'bg-rose-500/10' },
  { key: 'naranja', dot: '🟠', label: () => 'Vence hoy', ring: 'border-amber-500/50', bg: 'bg-amber-500/10' },
  { key: 'verde', dot: '🟢', label: (days) => (days <= 1 ? 'Vence mañana' : 'Vence en los próximos días'), ring: 'border-emerald-500/50', bg: 'bg-emerald-500/10' },
  { key: 'pasado', dot: '🔴', label: (days) => `Vencidas en los últimos ${-days} días`, ring: 'border-rose-500/50', bg: 'bg-rose-500/10' }
];
// Range buttons: positive = what falls due next; negative = what fell due in the last days (user's request, 29-oct-2026).
const RANGES: [number, string][] = [
  [1, 'Hoy y mañana'],
  [3, '3 días'],
  [7, '7 días'],
  [-15, 'Vencidas 15 días']
];
/** Lowercase without accents, so "garcia" finds "García". */
const plain = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const SENT_KEY = 'crm-cobro-avisados';

/** Customers already sent a reminder today from this screen (only this browser remembers it; it resets every day). */
function useSentToday(today: string) {
  const [sent, setSent] = useState<Set<number>>(new Set());
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(SENT_KEY) ?? '{}') as { day?: string; ids?: number[] };
      setSent(new Set(v.day === today ? v.ids ?? [] : []));
    } catch {
      /* nothing remembered */
    }
  }, [today]);
  const mark = (id: number) =>
    setSent((prev) => {
      const next = new Set(prev).add(id);
      try {
        localStorage.setItem(SENT_KEY, JSON.stringify({ day: today, ids: [...next] }));
      } catch {
        /* only this session remembers it */
      }
      return next;
    });
  return { sent, mark };
}

/** A ring that fills with the money already reminded out of everything that falls due. */
function Ring({ done, total }: { done: number; total: number }) {
  const share = total > 0 ? Math.min(1, done / total) : 0;
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true" className="shrink-0 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="7" className="text-muted" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - share)}
          className="text-emerald-500 transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="min-w-0">
        <p className="text-lg font-semibold tabular-nums">{Math.round(share * 100)}% avisado</p>
        <p className="text-xs text-muted-foreground">
          $ {money(done)} de $ {money(total)}
        </p>
      </div>
    </div>
  );
}

/**
 * What falls due next, as a traffic light: red = customers who also have older overdue invoices, orange = due today,
 * green = due later. Each customer is a bubble; tapping it shows the invoices and the reminder, and "Cobrar" opens
 * WhatsApp with it written (nothing is sent on its own). Customers reminded today get a ✅ and the ring fills up.
 */
export function DueSoon({ onOpenCustomer }: { onOpenCustomer: (id: number) => void }) {
  const [days, setDays] = useState(1);
  const { data } = useQuery({ queryKey: ['crm-due', days], queryFn: () => api<Due>(`/api/crm/receivables/due?days=${days}`) });
  const [open, setOpen] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  // Customers whose older overdue invoices the user took out of the message (by default they go in).
  const [noOld, setNoOld] = useState<Set<number>>(new Set());
  const today = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
  const { sent, mark } = useSentToday(today);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (window.location.hash === '#por-vencer') ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const past = days < 0;
  const all = data?.customers ?? [];
  // The search filters the bubbles by name, phone or invoice number; every word must match.
  const words = plain(query).split(/\s+/).filter(Boolean);
  const list = words.length
    ? all.filter((c) => {
        const hay = plain([c.name, c.phone, ...c.invoices.map((i) => i.doc), ...c.overdue.map((o) => o.doc)].join(' '));
        return words.every((w) => hay.includes(w));
      })
    : all;
  const amount = (c: DueCustomer) => c.total + (noOld.has(c.contactId) ? 0 : c.overdueTotal);
  const light = (c: DueCustomer): Light => (past ? 'pasado' : c.overdue.length ? 'rojo' : c.invoices.some((i) => i.dueAt <= today) ? 'naranja' : 'verde');
  const total = list.reduce((a, c) => a + amount(c), 0);
  const done = list.filter((c) => sent.has(c.contactId)).reduce((a, c) => a + amount(c), 0);
  const textFor = (c: DueCustomer) => preDueMessage(c.name, c.invoices, noOld.has(c.contactId) ? [] : c.overdue);

  return (
    <section ref={ref} id="por-vencer" className={cn(card, 'scroll-mt-28 space-y-4')}>
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock className="size-5 text-sky-600 dark:text-sky-400" />
        <h2 className="text-sm font-medium">Por vencer</h2>
        <div className="flex w-full rounded-full border border-border/60 p-0.5 text-xs sm:ml-auto sm:w-auto" role="group" aria-label="Rango">
          {RANGES.map(([n, label]) => (
            <button
              key={n}
              onClick={() => {
                setDays(n);
                setOpen(null);
              }}
              aria-pressed={days === n}
              className={cn(
                'h-7 flex-1 whitespace-nowrap rounded-full px-2 sm:flex-none sm:px-3',
                days === n ? (n < 0 ? 'bg-rose-600 font-semibold text-white' : 'bg-primary font-semibold text-primary-foreground') : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <PushToggle />

      <label className="flex h-9 items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 text-sm">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(null);
          }}
          placeholder="Buscar cliente, teléfono o factura"
          aria-label="Buscar cliente"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
      </label>

      {data && words.length > 0 && !list.length && all.length > 0 && (
        <p className="text-sm text-muted-foreground">Ningún cliente de esta lista coincide con «{query.trim()}». Prueba otro rango arriba.</p>
      )}
      {data && !all.length && (
        <p className="text-sm text-muted-foreground">
          🎉 {past ? 'No se venció nada' : 'No vence nada'} {data.from === data.to ? `el ${shortDay(data.from)}` : `entre el ${shortDay(data.from)} y el ${shortDay(data.to)}`}.
        </p>
      )}
      {list.length > 0 && <Ring done={done} total={total} />}

      {LIGHTS.map((L) => {
        const group = list.filter((c) => light(c) === L.key);
        if (!group.length) return null;
        const opened = group.find((c) => c.contactId === open);
        return (
          <div key={L.key} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {L.dot} {L.label(days)} ({group.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {group.map((c) => (
                <button
                  key={c.contactId}
                  onClick={() => setOpen(open === c.contactId ? null : c.contactId)}
                  aria-expanded={open === c.contactId}
                  className={cn(
                    'flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-left text-sm transition-transform active:scale-95',
                    L.ring,
                    L.bg,
                    open === c.contactId && 'ring-2 ring-primary',
                    sent.has(c.contactId) && 'opacity-60'
                  )}
                >
                  <span className="max-w-[11rem] truncate font-medium">{c.name || formatPhone(c.phone)}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">$ {money(amount(c))}</span>
                  <span className="shrink-0">{sent.has(c.contactId) ? '✅' : c.hasPhone ? '💬' : '📵'}</span>
                </button>
              ))}
            </div>
            {opened && (
              <div className={cn('space-y-2 rounded-xl border p-3 text-sm', L.ring)}>
                <div className="flex items-start gap-2">
                  <button onClick={() => onOpenCustomer(opened.contactId)} className="min-w-0 flex-1 truncate text-left font-semibold hover:underline">
                    {opened.name || formatPhone(opened.phone)}
                  </button>
                  <span className="shrink-0 font-semibold tabular-nums">$ {money(amount(opened))}</span>
                </div>
                <ul className="space-y-0.5 text-xs">
                  {opened.invoices.map((i) => (
                    <li key={i.id} className="flex gap-2">
                      <span className="flex-1">
                        🧾 {i.doc} · {i.dueAt < today ? `venció ${shortDay(i.dueAt)}` : `vence ${i.dueAt === today ? 'hoy' : shortDay(i.dueAt)}`}
                      </span>
                      <span className="tabular-nums">$ {money(i.balance)}</span>
                    </li>
                  ))}
                  {opened.overdue.map((o) => (
                    <li key={o.doc} className="flex gap-2 text-rose-600 dark:text-rose-400">
                      <span className="flex-1">
                        ⚠️ {o.doc} · {o.daysLate} días
                      </span>
                      <span className="tabular-nums">$ {money(o.balance)}</span>
                    </li>
                  ))}
                </ul>
                {opened.overdue.length > 0 && (
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      id={`viejas-${opened.contactId}`}
                      checked={!noOld.has(opened.contactId)}
                      onChange={() => {
                        const next = new Set(noOld);
                        if (next.has(opened.contactId)) next.delete(opened.contactId);
                        else next.add(opened.contactId);
                        setNoOld(next);
                      }}
                      className="size-3.5 accent-rose-600"
                    />
                    Incluir las vencidas en el mensaje
                  </label>
                )}
                {opened.hasPhone ? (
                  <>
                    <pre className="whitespace-pre-wrap rounded-lg bg-background/70 p-2 font-sans text-xs">{textFor(opened)}</pre>
                    <WhatsAppLink
                      phone={opened.phone}
                      text={textFor(opened)}
                      beforeOpen={async () => {
                        const r = await checkCollection(opened.contactId, { reminder: true });
                        // ✅ only when the reminder goes; opening the chat without it (outside collection hours) does not count.
                        if (r === true) mark(opened.contactId);
                        return r;
                      }}
                      className="inline-flex h-9 items-center rounded-full bg-emerald-600 px-4 text-sm font-semibold text-white shadow-[0_0_16px_rgba(0,200,83,0.45)] hover:bg-emerald-500"
                    >
                      💬 Cobrar por WhatsApp
                    </WhatsAppLink>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">📵 Sin WhatsApp: búscalo desde su ficha para poder cobrarle.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
