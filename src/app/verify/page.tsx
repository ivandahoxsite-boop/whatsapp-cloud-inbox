'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Delete, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Key } from '@/components/crm/lock-gate';

// Second step of the login: the 6-digit code from the authenticator app.
function VerifyForm() {
  const params = useSearchParams();
  const [digits, setDigits] = useState('');
  const [code, setCode] = useState(''); // the 6-digit code, kept while the 4-digit key is typed
  const [needPin, setNeedPin] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);

  // Whether a 4-digit key exists decides if a second pad follows the code.
  useEffect(() => {
    fetch('/api/auth/verify')
      .then((r) => r.json())
      .then((d: { needPin?: boolean }) => setNeedPin(!!d.needPin))
      .catch(() => setNeedPin(false));
  }, []);

  const asking = needPin && code ? 'pin' : 'code';
  const length = asking === 'pin' ? 4 : 6;

  const submit = useCallback(
    async (otp: string, pin?: string) => {
      setBusy(true);
      try {
        const res = await fetch('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: otp, pin }) });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error || 'Código incorrecto');
        const next = params.get('next') ?? '/crm';
        window.location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/crm';
      } catch (e) {
        setError((e as Error).message);
        setShake((n) => n + 1);
        setDigits('');
        setCode('');
        setBusy(false);
      }
    },
    [params]
  );

  const press = useCallback(
    (d: string) => {
      if (busy || needPin === null) return;
      setError('');
      setDigits((cur) => {
        if (cur.length >= length) return cur;
        const next = cur + d;
        if (next.length === length) {
          setTimeout(() => {
            if (asking === 'pin') submit(code, next);
            else if (needPin) {
              setCode(next);
              setDigits('');
            } else submit(next);
          }, 120);
        }
        return next;
      });
    },
    [busy, needPin, length, asking, code, submit]
  );
  const back = useCallback(() => !busy && setDigits((c) => c.slice(0, -1)), [busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, back]);

  return (
    <div className="w-full max-w-xs rounded-3xl border border-border/60 bg-background/85 p-5 shadow-2xl backdrop-blur-xl">
      <div className="flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <h1 className="mt-3 text-base font-semibold">{asking === 'pin' ? 'Ahora tu clave' : 'Verificación en dos pasos'}</h1>
        <p className="text-xs text-muted-foreground">
          {asking === 'pin' ? 'Escribe tu clave de 4 números' : 'Escribe el código de 6 números de tu app de autenticación'}
        </p>
      </div>

      <div key={shake} className={cn('mt-5 flex justify-center gap-3', shake > 0 && error && 'pin-shake')} role="status" aria-label={`${digits.length} de ${length} números`}>
        {Array.from({ length }, (_, i) => i).map((i) => (
          <span
            key={i}
            className={cn(
              'h-3.5 w-3.5 rounded-full border transition-all duration-150',
              i < digits.length ? 'scale-110 border-emerald-400 bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]' : 'border-muted-foreground/40'
            )}
          />
        ))}
      </div>
      <p className="mt-3 h-4 text-center text-xs text-destructive" aria-live="polite">
        {error}
      </p>

      <div className="mt-2 grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} label={d} onClick={() => press(d)} />
        ))}
        <span />
        <Key label="0" onClick={() => press('0')} />
        <button onClick={back} aria-label="Borrar" className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-muted-foreground active:scale-95 active:opacity-60">
          <Delete className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center bg-background p-4 text-foreground">
      <div aria-hidden className="pointer-events-none fixed inset-0 opacity-60 dark:opacity-100">
        <div className="absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-emerald-500/15 blur-[120px]" />
        <div className="absolute -right-40 top-20 h-[26rem] w-[26rem] rounded-full bg-fuchsia-500/15 blur-[120px]" />
      </div>
      <div className="relative z-10 flex w-full justify-center">
        <Suspense fallback={null}>
          <VerifyForm />
        </Suspense>
      </div>
    </main>
  );
}
