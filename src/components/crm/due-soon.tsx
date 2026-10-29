'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, BellOff, CalendarClock } from 'lucide-react';
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

/**
 * Invoices that fall due next. You tick the customers and the CRM walks you through them one by one: WhatsApp opens
 * with the reminder written, you send it, then "Siguiente". Nothing is sent on its own.
 */
export function DueSoon({ onOpenCustomer }: { onOpenCustomer: (id: number) => void }) {
  const [days, setDays] = useState(1);
  const { data } = useQuery({ queryKey: ['crm-due', days], queryFn: () => api<Due>(`/api/crm/receivables/due?days=${days}`) });
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const [queue, setQueue] = useState<DueCustomer[] | null>(null);
  const [pos, setPos] = useState(0);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (window.location.hash === '#por-vencer') ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  useEffect(() => setPicked(null), [days]);

  const list = data?.customers ?? [];
  const chosen = picked ?? new Set(list.filter((c) => c.hasPhone).map((c) => c.contactId));
  const flip = (id: number) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const total = list.reduce((a, c) => a + c.total, 0);
  const current = queue?.[pos];

  return (
    <section ref={ref} id="por-vencer" className={cn(card, 'scroll-mt-28 space-y-3')}>
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock className="size-5 text-sky-600 dark:text-sky-400" />
        <h2 className="text-sm font-medium">Por vencer</h2>
        <div className="ml-auto flex rounded-full border border-border/60 p-0.5 text-xs" role="group" aria-label="Rango">
          {[
            [1, 'Mañana'],
            [3, '3 días'],
            [7, '7 días']
          ].map(([n, label]) => (
            <button
              key={n}
              onClick={() => setDays(n as number)}
              aria-pressed={days === n}
              className={cn('h-7 rounded-full px-3', days === n ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <PushToggle />

      {data && (
        <p className="text-xs text-muted-foreground">
          {data.from === data.to ? `Vencen el ${shortDay(data.from)}` : `Vencen del ${shortDay(data.from)} al ${shortDay(data.to)}`}:{' '}
          {list.length ? `${list.reduce((a, c) => a + c.invoices.length, 0)} facturas de ${list.length} clientes · $ ${money(total)}` : 'ninguna factura.'}
        </p>
      )}

      {queue && current ? (
        <div className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3">
          <p className="text-xs text-muted-foreground">
            Cliente {pos + 1} de {queue.length}
          </p>
          <p className="font-medium">{current.name}</p>
          <pre className="whitespace-pre-wrap rounded-lg bg-background/70 p-2 font-sans text-xs">{preDueMessage(current.name, current.invoices)}</pre>
          <div className="flex flex-wrap gap-2">
            <WhatsAppLink
              phone={current.phone}
              text={preDueMessage(current.name, current.invoices)}
              beforeOpen={() => checkCollection(current.contactId)}
              className="inline-flex h-8 items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
            >
              💬 Abrir WhatsApp con el mensaje
            </WhatsAppLink>
            <Button size="sm" onClick={() => setPos(pos + 1)}>
              {pos + 1 < queue.length ? 'Siguiente ›' : 'Terminar'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setQueue(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : queue ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
          <span className="flex-1">✅ Recorriste los {queue.length} clientes.</span>
          <Button size="sm" variant="outline" onClick={() => setQueue(null)}>
            Cerrar
          </Button>
        </div>
      ) : (
        list.length > 0 && (
          <>
            <ul className="space-y-1.5">
              {list.map((c) => (
                <li key={c.contactId} className="flex items-start gap-2 rounded-lg border border-border/60 bg-background/40 p-2 text-sm">
                  <input
                    type="checkbox"
                    id={`vence-${c.contactId}`}
                    checked={chosen.has(c.contactId)}
                    disabled={!c.hasPhone}
                    onChange={() => flip(c.contactId)}
                    className="mt-1 size-4 accent-emerald-600"
                  />
                  <div className="min-w-0 flex-1">
                    <button onClick={() => onOpenCustomer(c.contactId)} className="block max-w-full truncate text-left font-medium hover:underline">
                      {c.name || formatPhone(c.phone)}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {c.invoices.map((i) => `${i.doc} · vence ${shortDay(i.dueAt)} · $ ${money(i.balance)}`).join('  |  ')}
                      {!c.hasPhone && ' · Sin WhatsApp'}
                    </p>
                  </div>
                  <span className="shrink-0 font-medium tabular-nums">$ {money(c.total)}</span>
                </li>
              ))}
            </ul>
            <Button
              disabled={!chosen.size}
              onClick={() => {
                setQueue(list.filter((c) => chosen.has(c.contactId)));
                setPos(0);
              }}
            >
              Enviar recordatorio a {chosen.size} cliente{chosen.size === 1 ? '' : 's'}
            </Button>
          </>
        )
      )}
    </section>
  );
}
