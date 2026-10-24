import { NextResponse } from 'next/server';
import { deleteField, listFields, updateField, upsertField } from '@/lib/crm/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 400 });
}

export async function GET() {
  return NextResponse.json({ fields: listFields() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.entity !== 'contact' && body.entity !== 'sale') throw new Error('entity inválida');
    if (!String(body.label ?? '').trim()) throw new Error('Falta el nombre del campo');
    return NextResponse.json({ field: upsertField(body) });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { id, ...patch } = await request.json();
    updateField(Number(id), patch);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { id } = await request.json();
    deleteField(Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
