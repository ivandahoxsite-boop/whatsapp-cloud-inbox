'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, card } from './shared';

type LockState = { hasPin: boolean; unlocked: boolean };

/**
 * Keeps the money figures behind a key. Locked, the screen shows XXXX; the server refuses to send the numbers
 * without the unlock cookie, so this is not just a cover. It locks again by itself after 30 minutes.
 */
export function LockGate({ what, tiles, children }: { what: string; tiles: string[]; children: React.ReactNode }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['crm-lock'], queryFn: () => api<LockState>('/api/crm/lock'), refetchInterval: 20_000, staleTime: 0 });
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [err, setErr] = useState('');
  const [changing, setChanging] = useState(false);

  const call = async (body: Record<string, unknown>) => {
    setErr('');
    try {
      await api('/api/crm/lock', 'POST', body);
      setPin('');
      setPin2('');
      setChanging(false);
      await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('crm') });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (!data) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  if (data.unlocked && !changing)
    return (
      <div className="space-y-3">
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setChanging(true)}>
            Cambiar clave
          </Button>
          <Button size="sm" variant="outline" onClick={() => call({ action: 'lock' })}>
            <Lock className="mr-1.5 h-4 w-4" /> Ocultar
          </Button>
        </div>
        {children}
      </div>
    );

  const setup = !data.hasPin;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((label) => (
          <div key={label} className={card}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-semibold tracking-widest">XXXX</p>
          </div>
        ))}
      </div>
      <form
        className={`${card} space-y-3`}
        onSubmit={(e) => {
          e.preventDefault();
          if (changing) return call({ action: 'change', pin, newPin: pin2 });
          if (setup) return pin === pin2 ? call({ action: 'setup', pin }) : setErr('Las dos claves no coinciden');
          return call({ action: 'unlock', pin });
        }}
      >
        <p className="flex items-center gap-2 text-sm font-medium">
          <Lock className="h-4 w-4" />
          {changing ? 'Cambiar clave' : setup ? `Crea una clave para ver ${what}` : `Ingresa tu clave para ver ${what}`}
        </p>
        {setup && <p className="text-xs text-muted-foreground">4 números.</p>}
        <Input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          placeholder={changing ? 'Clave actual' : setup ? 'Nueva clave' : 'Clave'}
          aria-label="Clave"
        />
        {(setup || changing) && (
          <Input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="off"
            value={pin2}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
            placeholder={changing ? 'Clave nueva' : 'Repite la clave'}
            aria-label="Clave nueva"
          />
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={pin.length !== 4}>
            <Unlock className="mr-1.5 h-4 w-4" /> {changing ? 'Guardar' : setup ? 'Crear y ver' : 'Ver'}
          </Button>
          {changing && (
            <Button type="button" variant="ghost" onClick={() => setChanging(false)}>
              Cancelar
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
