import { getOutbox, listOutbox, markOutbox } from '@/lib/crm/agent-store';
import { approveAndSend } from '@/lib/crm/send';
import { fail, json } from '@/lib/crm/agent-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return json({ messages: listOutbox() });
}

// POST { id, action: 'approve' | 'reject' }  (protected by the inbox Basic Auth)
export async function POST(request: Request) {
  try {
    const { id, action } = (await request.json()) as { id: number; action: 'approve' | 'reject' };
    if (action === 'reject') {
      if (getOutbox(Number(id))?.status !== 'pending') return json({ error: 'El mensaje ya no está pendiente' }, 409);
      markOutbox(Number(id), 'rejected');
      return json({ ok: true });
    }
    const r = await approveAndSend(Number(id));
    return json(r, r.ok ? 200 : 409);
  } catch (e) {
    return fail(e);
  }
}
