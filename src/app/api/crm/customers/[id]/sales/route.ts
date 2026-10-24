import { NextResponse } from 'next/server';
import { addSale } from '@/lib/crm/customers';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

// POST { "soldAt": "2026-10-24", "amount": 850000, "product": "Amplificador X", "qty": 2 }
export async function POST(request: Request, { params }: Ctx) {
  try {
    const id = Number((await params).id);
    addSale(id, (await request.json()) as Parameters<typeof addSale>[1]);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 400 });
  }
}
