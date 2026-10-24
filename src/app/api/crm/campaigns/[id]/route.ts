import { NextResponse } from 'next/server';
import { cancelCampaign, getCampaign, listItems, sendBatch, setItemExcluded } from '@/lib/crm/campaigns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const fail = (error: unknown, status = 400) =>
  NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status });

export async function GET(_request: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const campaign = getCampaign(id);
  if (!campaign) return fail(new Error('Campaña no encontrada'), 404);
  return NextResponse.json({ campaign, items: listItems(id) });
}

// PATCH { itemId, excluded } removes or restores one recipient before it is sent.
export async function PATCH(request: Request) {
  try {
    const { itemId, excluded } = (await request.json()) as { itemId: number; excluded: boolean };
    setItemExcluded(Number(itemId), !!excluded);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

// POST { action: "send" | "cancel" }. "send" sends what the hourly limit allows; press it again later for the rest.
export async function POST(request: Request, { params }: Ctx) {
  try {
    const id = Number((await params).id);
    const { action } = (await request.json()) as { action: 'send' | 'cancel' };
    if (action === 'cancel') {
      cancelCampaign(id);
      return NextResponse.json({ ok: true });
    }
    if (action === 'send') return NextResponse.json(await sendBatch(id));
    return fail(new Error('action debe ser send o cancel'));
  } catch (e) {
    return fail(e);
  }
}
