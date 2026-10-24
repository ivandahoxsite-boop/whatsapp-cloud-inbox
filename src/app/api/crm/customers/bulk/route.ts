import { NextResponse } from 'next/server';
import { updateCustomer } from '@/lib/crm/customers';
import { addTags, ensureTag, removeTags } from '@/lib/crm/tags';
import { getDb } from '@/lib/crm/db';

export const runtime = 'nodejs';

// POST { ids, addTags?: string[], removeTagIds?: number[], city?: string, stageId?: number | null }
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      ids: number[];
      addTags?: string[];
      removeTagIds?: number[];
      city?: string;
      stageId?: number | null;
    };
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isFinite).slice(0, 5000);
    if (ids.length === 0) throw new Error('No hay clientes seleccionados');

    const d = getDb();
    d.exec('BEGIN');
    try {
      if (body.addTags?.length) addTags(ids, body.addTags.filter((t) => t.trim()).map(ensureTag));
      if (body.removeTagIds?.length) removeTags(ids, body.removeTagIds.map(Number));
      for (const id of ids) {
        if (body.city !== undefined) updateCustomer(id, { city: body.city });
        if (body.stageId !== undefined) updateCustomer(id, { stageId: body.stageId });
      }
      d.exec('COMMIT');
    } catch (e) {
      d.exec('ROLLBACK');
      throw e;
    }
    return NextResponse.json({ ok: true, updated: ids.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 400 });
  }
}
