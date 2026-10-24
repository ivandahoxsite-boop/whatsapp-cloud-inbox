import { NextResponse } from 'next/server';
import { deleteTag, ensureTag, listTags, updateTag } from '@/lib/crm/tags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (e: unknown) => NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 400 });

export async function GET() {
  return NextResponse.json({ tags: listTags() });
}

export async function POST(request: Request) {
  try {
    const { name } = (await request.json()) as { name: string };
    return NextResponse.json({ id: ensureTag(String(name ?? '')) });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(request: Request) {
  try {
    const { id, name, color } = (await request.json()) as { id: number; name?: string; color?: string };
    updateTag(Number(id), { name, color });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const { id } = (await request.json()) as { id: number };
    deleteTag(Number(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
