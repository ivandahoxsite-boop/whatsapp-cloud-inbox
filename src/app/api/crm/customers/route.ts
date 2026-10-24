import { NextResponse } from 'next/server';
import { createCustomer, deleteCustomer, listCustomers, updateCustomer } from '@/lib/crm/customers';
import { listFields, listStages } from '@/lib/crm/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status });
}

export async function GET() {
  try {
    return NextResponse.json({ customers: listCustomers(), fields: listFields(), stages: listStages() });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json({ id: createCustomer(body) });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { id, ...patch } = await request.json();
    updateCustomer(Number(id), patch);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { id } = await request.json();
    deleteCustomer(Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
