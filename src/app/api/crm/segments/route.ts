import { NextResponse } from 'next/server';
import { createSegment, deleteSegment, listSegments } from '@/lib/crm/segments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (e: unknown) => NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 400 });

export async function GET() {
  return NextResponse.json({ segments: listSegments() });
}

export async function POST(request: Request) {
  try {
    const { name, filter } = (await request.json()) as { name: string; filter: unknown };
    return NextResponse.json({ id: createSegment(String(name ?? ''), filter) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const { id } = (await request.json()) as { id: number };
    deleteSegment(Number(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
