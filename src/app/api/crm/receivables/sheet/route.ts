import { NextResponse } from 'next/server';
import { carteraLast, previewCarteraSheet, syncCarteraSheet } from '@/lib/crm/cartera-sheet';
import { carteraSheetConfigured } from '@/lib/crm/receivables';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status });

// GET -> is the sheet connected, and how did the last reading go.
export async function GET() {
  return NextResponse.json({ configured: carteraSheetConfigured(), last: carteraLast() });
}

// POST { action: "preview" } -> what a load would change (nothing is changed).
// POST { action: "load" } -> loads it now; the user saw the preview, so the "too many closed" check is skipped.
export async function POST(request: Request) {
  try {
    const { action } = (await request.json()) as { action?: string };
    if (action === 'preview') return NextResponse.json({ plan: await previewCarteraSheet() });
    if (action === 'load') {
      const r = await syncCarteraSheet({ trigger: 'manual', force: true });
      return r.ok ? NextResponse.json(r) : NextResponse.json(r, { status: 409 });
    }
    return fail(new Error('Acción desconocida'));
  } catch (e) {
    return fail(e, 502);
  }
}
