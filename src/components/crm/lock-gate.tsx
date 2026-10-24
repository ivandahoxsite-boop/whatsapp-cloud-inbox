'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Delete, Lock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api, card } from './shared';

type LockState = { hasPin: boolean; unlocked: boolean };
type Step = 'enter' | 'create' | 'repeat' | 'current' | 'new' | 'repeatNew';

const TITLE: Record<Step, [string, string]> = {
  enter: ['Ventas protegidas', 'Escribe tu clave de 4 números'],
  create: ['Crea tu clave', 'Elige 4 números que recuerdes'],
  repeat: ['Repite la clave', 'Para confirmar que la escribiste bien'],
  current: ['Cambiar clave', 'Primero escribe tu clave actual'],
  new: ['Clave nueva', 'Elige los 4 números nuevos'],
  repeatNew: ['Repite la clave nueva', 'Una vez más para confirmar']
};

/**
 * Keeps the sales figures behind a 4-digit key. Locked, the screen shows a blurred preview with XXXX and a PIN pad;
 * the server refuses to send the numbers without the unlock cookie, so this is not just a cover. It locks again
 * by itself after 30 minutes.
 */
export function LockGate({ what, tiles, children }: { what: string; tiles: string[]; children: React.ReactNode }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['crm-lock'], queryFn: () => api<LockState>('/api/crm/lock'), refetchInterval: 20_000, staleTime: 0 });
  const [changing, setChanging] = useState(false);

  // A request answered "locked" (the 30 minutes ran out): look again right away instead of waiting for the next poll.
  useEffect(() => {
    const again = () => qc.invalidateQueries({ queryKey: ['crm-lock'] });
    window.addEventListener('crm-locked', again);
    return () => window.removeEventListener('crm-locked', again);
  }, [qc]);

  const refresh = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('crm') });

  if (!data) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  if (data.unlocked && !changing)
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-end gap-1">
          <span className="mr-auto flex items-center gap-1.5 text-xs text-emerald-500">
            <ShieldCheck className="h-4 w-4" /> Desbloqueado
          </span>
          <Button size="sm" variant="ghost" onClick={() => setChanging(true)}>
            Cambiar clave
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={async () => {
              await api('/api/crm/lock', 'POST', { action: 'lock' });
              refresh();
            }}
          >
            <Lock className="h-4 w-4" /> Ocultar
          </Button>
        </div>
        {children}
      </div>
    );

  return (
    <div className="relative">
      {/* Blurred preview of the dashboard, so the screen still looks like the one that is waiting behind the key. */}
      <div aria-hidden className="pointer-events-none select-none space-y-4 blur-[3px] opacity-60">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((label) => (
            <div key={label} className={card}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-xl font-semibold tracking-[0.3em]">XXXX</p>
            </div>
          ))}
        </div>
        <div className={cn(card, 'space-y-3')}>
          <div className="h-3 w-28 rounded bg-muted" />
          {[78, 52, 91, 40, 66].map((w, i) => (
            <div key={i} className="h-1.5 rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-400/70" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      </div>

      <div className="absolute inset-0 flex items-start justify-center px-1 pt-2 sm:items-center sm:pt-0">
        <PinPad
          what={what}
          hasPin={data.hasPin}
          changing={changing}
          onCancel={() => setChanging(false)}
          onDone={async () => {
            setChanging(false);
            await refresh();
          }}
        />
      </div>
    </div>
  );
}

function PinPad({ what, hasPin, changing, onCancel, onDone }: { what: string; hasPin: boolean; changing: boolean; onCancel: () => void; onDone: () => void }) {
  const [step, setStep] = useState<Step>(changing ? 'current' : hasPin ? 'enter' : 'create');
  const [pin, setPin] = useState('');
  const [saved, setSaved] = useState<string[]>([]); // PINs already typed in earlier steps
  const [error, setError] = useState('');
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const stepRef = useRef(step);
  stepRef.current = step;

  const fail = useCallback((msg: string, back: Step) => {
    setError(msg);
    setShake((n) => n + 1);
    setPin('');
    setSaved([]);
    setStep(back);
    if ('vibrate' in navigator) navigator.vibrate?.(60);
  }, []);

  const submit = useCallback(
    async (value: string) => {
      const s = stepRef.current;
      setError('');
      try {
        if (s === 'enter') {
          setBusy(true);
          await api('/api/crm/lock', 'POST', { action: 'unlock', pin: value });
          return onDone();
        }
        if (s === 'create' || s === 'new' || s === 'current') {
          setSaved((p) => [...p, value]);
          setPin('');
          return setStep(s === 'create' ? 'repeat' : s === 'current' ? 'new' : 'repeatNew');
        }
        // repeat / repeatNew: compare with what was typed before
        const first = saved[saved.length - 1];
        if (first !== value) return fail('No coinciden. Intenta de nuevo.', s === 'repeat' ? 'create' : 'new');
        setBusy(true);
        if (s === 'repeat') await api('/api/crm/lock', 'POST', { action: 'setup', pin: value });
        else await api('/api/crm/lock', 'POST', { action: 'change', pin: saved[0], newPin: value });
        return onDone();
      } catch (e) {
        fail((e as Error).message, s === 'enter' ? 'enter' : s === 'repeatNew' ? 'current' : 'create');
      } finally {
        setBusy(false);
      }
    },
    [saved, fail, onDone]
  );

  const press = useCallback(
    (d: string) => {
      if (busy) return;
      setError('');
      setPin((p) => {
        if (p.length >= 4) return p;
        const next = p + d;
        if (next.length === 4) setTimeout(() => submit(next), 120); // let the 4th dot fill before moving on
        return next;
      });
    },
    [busy, submit]
  );
  const back = useCallback(() => !busy && setPin((p) => p.slice(0, -1)), [busy]);

  // Physical keyboard (desktop): digits and backspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, back]);

  const [title, hint] = TITLE[step];
  return (
    <div className="w-full max-w-xs rounded-3xl border border-border/60 bg-background/85 p-5 shadow-2xl backdrop-blur-xl">
      <div className="flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30">
          <Lock className="h-5 w-5" />
        </span>
        <h2 className="mt-3 text-base font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
        {(step === 'enter' || step === 'create') && <p className="mt-0.5 text-[11px] text-muted-foreground/70">Para ver {what}</p>}
      </div>

      <div key={shake} className={cn('mt-5 flex justify-center gap-4', shake > 0 && error && 'pin-shake')} role="status" aria-label={`${pin.length} de 4 números`}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              'h-3.5 w-3.5 rounded-full border transition-all duration-150',
              i < pin.length ? 'scale-110 border-emerald-400 bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]' : 'border-muted-foreground/40'
            )}
          />
        ))}
      </div>
      <p className="mt-3 h-4 text-center text-xs text-destructive" aria-live="polite">
        {error}
      </p>

      <div className="mt-2 grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} onClick={() => press(d)} label={d} />
        ))}
        {changing || step === 'repeat' || step === 'repeatNew' ? (
          <button
            onClick={() => (changing ? onCancel() : fail('', 'create'))}
            className="mx-auto h-16 w-16 rounded-full text-xs text-muted-foreground active:opacity-60"
          >
            {changing ? 'Cancelar' : 'Atrás'}
          </button>
        ) : (
          <span />
        )}
        <Key onClick={() => press('0')} label="0" />
        <button onClick={back} aria-label="Borrar" className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-muted-foreground active:scale-95 active:opacity-60">
          <Delete className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

function Key({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mx-auto h-16 w-16 touch-manipulation rounded-full border border-border/60 bg-card/70 text-xl font-medium tabular-nums transition active:scale-90 active:bg-emerald-500/20 hover:bg-card"
    >
      {label}
    </button>
  );
}
