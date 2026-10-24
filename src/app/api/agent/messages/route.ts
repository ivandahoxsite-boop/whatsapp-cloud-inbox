import { listCustomers } from '@/lib/crm/customers';
import { listOutbox, proposeMessage } from '@/lib/crm/agent-store';
import { fail, guardAgent, json } from '@/lib/crm/agent-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  const status = new URL(request.url).searchParams.get('status') as 'pending' | 'sent' | 'rejected' | 'failed' | null;
  return json({ messages: listOutbox(status ?? undefined) });
}

// POST { "customerId": 12, "body": "Hola Ana..." } -> queued as pending; it is NOT sent.
export async function POST(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    const { customerId, body } = (await request.json()) as { customerId: number; body: string };
    if (!listCustomers().some((c) => c.id === Number(customerId))) return json({ error: 'Cliente no encontrado' }, 404);
    const id = proposeMessage(Number(customerId), String(body ?? ''));
    return json({ id, status: 'pending', note: 'Pendiente de aprobación humana. No se ha enviado.' }, 201);
  } catch (e) {
    return fail(e);
  }
}
