'use client';

import { useEffect } from 'react';

const isChunk = (e: Error) => /ChunkLoadError|Loading chunk|dynamically imported module/i.test(`${e.name} ${e.message}`);

/** Shown instead of Next's white "Application error" page. A stale-code error reloads by itself once. */
export function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    try {
      navigator.sendBeacon(
        '/api/client-error',
        JSON.stringify({ kind: 'boundary', msg: `${error.name}: ${error.message}`.slice(0, 600), digest: error.digest, url: location.pathname })
      );
    } catch {}
    if (!isChunk(error)) return;
    try {
      if (Date.now() - Number(sessionStorage.getItem('crm-reloaded') || 0) < 30_000) return;
      sessionStorage.setItem('crm-reloaded', String(Date.now()));
    } catch {}
    location.reload();
  }, [error]);

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <p style={{ fontSize: 18, fontWeight: 600 }}>Algo falló al cargar el CRM</p>
      <p style={{ fontSize: 14, opacity: 0.7, maxWidth: 340 }}>
        Suele pasar justo después de una actualización. Tus datos están bien. Toca Recargar; si vuelve a pasar, avísale a quien administra el CRM.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => location.reload()} style={{ padding: '10px 20px', borderRadius: 999, background: '#16a34a', color: '#fff', border: 0, fontSize: 15 }}>
          Recargar
        </button>
        <button onClick={reset} style={{ padding: '10px 20px', borderRadius: 999, border: '1px solid #888', background: 'transparent', fontSize: 15 }}>
          Reintentar
        </button>
      </div>
    </div>
  );
}
