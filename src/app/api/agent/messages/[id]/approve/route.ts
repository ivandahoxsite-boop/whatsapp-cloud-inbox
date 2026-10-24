import { bearerOk } from '@/lib/crm/auth';
import { approveAndSend } from '@/lib/crm/send';
import { json } from '@/lib/crm/agent-http';

export const runtime = 'nodejs';

// Needs CRM_APPROVER_TOKEN, a different secret from CRM_AGENT_TOKEN. Give it only to the
// Telegram button handler you trust; if unset, messages can only be approved in the CRM web UI.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.CRM_APPROVER_TOKEN?.trim()) return json({ error: 'Aprobación remota desactivada (CRM_APPROVER_TOKEN no definido)' }, 403);
  if (!bearerOk(request, 'CRM_APPROVER_TOKEN')) return json({ error: 'Unauthorized' }, 401);
  const r = await approveAndSend(Number((await params).id));
  return json(r, r.ok ? 200 : 409);
}
