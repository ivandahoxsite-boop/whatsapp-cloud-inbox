import { NextResponse } from 'next/server';
import { markReceivablePaid, receivablesSummary } from '@/lib/crm/receivables';
import { lockedResponse } from '@/lib/crm/lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status });

export async function GET(request: Request) {
  const locked = lockedResponse(request);
  if (locked) return locked;
  try {
    return NextResponse.json(receivablesSummary({ seller: new URL(request.url).searchParams.get('seller') || undefined }));
  } catch (e) {
    return fail(e, 500);
  }
}

// POST { id } marks one invoice as paid.
export async function POST(request: Request) {
  const locked = lockedResponse(request);
  if (locked) return locked;
  try {
    const { id } = (await request.json()) as { id: number };
    markReceivablePaid(Number(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
