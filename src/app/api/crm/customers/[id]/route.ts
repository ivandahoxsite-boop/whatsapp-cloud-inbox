import { NextResponse } from 'next/server';
import { getCustomerSales, listCustomers } from '@/lib/crm/customers';
import { addActivity, listActivities } from '@/lib/crm/agent-store';
import { customerReceivables } from '@/lib/crm/receivables';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// Detail for the customer sheet: purchase history and activity timeline.
export async function GET(_request: Request, { params }: Ctx) {
  const id = Number((await params).id);
  if (!listCustomers().some((c) => c.id === id)) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
  return NextResponse.json({ sales: getCustomerSales(id), activities: listActivities(id, 50), receivables: customerReceivables(id) });
}

// POST { note } adds a note to the timeline.
export async function POST(request: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const { note } = (await request.json()) as { note?: string };
  if (!note?.trim()) return NextResponse.json({ error: 'La nota está vacía' }, { status: 400 });
  if (!listCustomers().some((c) => c.id === id)) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
  addActivity(id, 'note', note.trim().slice(0, 2000), { by: 'user' });
  return NextResponse.json({ ok: true });
}
