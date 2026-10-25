import { NextResponse } from 'next/server';
import { recordCall, type CallInput } from '@/lib/crm/collections';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

// POST { outcome, summary, promiseDate?, promiseAmount? }: the user logs a call they made from their phone.
export async function POST(request: Request, { params }: Ctx) {
  try {
    const body = (await request.json()) as CallInput;
    return NextResponse.json(recordCall(Number((await params).id), { ...body, by: 'user' }), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 400 });
  }
}
