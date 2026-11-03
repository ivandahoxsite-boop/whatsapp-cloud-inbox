import { NextResponse } from 'next/server';
import { carteraLast, chosenSellers, knownSellers, previewCarteraSheet, setChosenSeller, syncCarteraSheet } from '@/lib/crm/cartera-sheet';
import { carteraSheetConfigured } from '@/lib/crm/receivables';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status });

// GET -> is the sheet connected, how did the last reading go, and the seller this CRM loads (and the ones to pick).
export async function GET() {
  return NextResponse.json({ configured: carteraSheetConfigured(), last: carteraLast(), seller: chosenSellers(), sellers: knownSellers() });
}

// POST { action: "preview" } -> what a load would change (nothing is changed).
// POST { action: "update" } -> the "Actualizar" button: loads now with the same safety checks as the scheduled loads.
// POST { action: "load" } -> loads it now; the user saw the preview, so the "too many closed" check is skipped.
export async function POST(request: Request) {
  try {
    const { action, seller, cali } = (await request.json()) as { action?: string; seller?: string; cali?: boolean };
    // POST { action: "seller", seller, cali? } -> which seller this CRM loads (nothing is loaded until the user confirms).
    if (action === 'seller') {
      setChosenSeller(String(seller ?? ''), !!cali);
      return NextResponse.json({ ok: true, seller: chosenSellers() });
    }
    if (action === 'preview') return NextResponse.json({ plan: await previewCarteraSheet() });
    if (action === 'load' || action === 'update') {
      const r = await syncCarteraSheet({ trigger: 'manual', force: action === 'load' });
      return r.ok ? NextResponse.json(r) : NextResponse.json(r, { status: 409 });
    }
    return fail(new Error('Acción desconocida'));
  } catch (e) {
    return fail(e, 502);
  }
}
