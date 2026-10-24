import { NextResponse } from 'next/server';
import { addStage, deleteStage, listStages, renameStage } from '@/lib/crm/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 400 });
}

export async function GET() {
  return NextResponse.json({ stages: listStages() });
}

export async function POST(request: Request) {
  try {
    const { name } = await request.json();
    if (!String(name ?? '').trim()) throw new Error('Falta el nombre');
    return NextResponse.json({ stage: addStage(String(name).trim()) });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { id, name } = await request.json();
    renameStage(Number(id), String(name).trim());
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { id } = await request.json();
    deleteStage(Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
