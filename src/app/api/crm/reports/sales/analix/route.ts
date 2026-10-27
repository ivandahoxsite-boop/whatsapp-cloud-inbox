import { NextResponse } from 'next/server';
import { analixConfigured, analixLast, syncAnalix } from '@/lib/crm/analix';
import { lockedResponse } from '@/lib/crm/lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> is AnaliX connected, and how did the last load go.
export async function GET(request: Request) {
  const locked = lockedResponse(request);
  if (locked) return locked;
  return NextResponse.json({ configured: analixConfigured(), last: analixLast() });
}

// POST { action: "update" } -> the "Actualizar" button, with the same checks as the nightly load.
// POST { action: "load" } -> loads even if a month drops by half (the user saw why it stopped and confirmed).
export async function POST(request: Request) {
  const locked = lockedResponse(request);
  if (locked) return locked;
  try {
    const { action } = (await request.json()) as { action?: string };
    if (action !== 'update' && action !== 'load') return NextResponse.json({ error: 'Acción desconocida' }, { status: 400 });
    const r = await syncAnalix({ trigger: 'manual', force: action === 'load' });
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 502 });
  }
}
