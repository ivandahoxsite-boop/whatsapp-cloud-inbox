import { NextResponse } from 'next/server';
import { isAgingKey, markReceivablePaid, receivablesSummary } from '@/lib/crm/receivables';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status });

export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const bucket = p.get('bucket');
    return NextResponse.json(receivablesSummary({ seller: p.get('seller') || undefined, bucket: isAgingKey(bucket) ? bucket : undefined }));
  } catch (e) {
    return fail(e, 500);
  }
}

// POST { id } marks one invoice as paid.
export async function POST(request: Request) {
  try {
    const { id } = (await request.json()) as { id: number };
    markReceivablePaid(Number(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
