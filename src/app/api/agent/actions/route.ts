import { listCustomers } from '@/lib/crm/customers';
import { buildActions } from '@/lib/crm/actions';
import { guardAgent, json } from '@/lib/crm/agent-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Today's recommended actions, with a suggested message for each.
export async function GET(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  return json({
    actions: buildActions(listCustomers()).map((a) => ({
      customerId: a.customer.id,
      name: a.customer.name,
      phone: a.customer.phone,
      segment: a.customer.segment,
      title: a.title,
      reason: a.reason,
      suggestedMessage: a.message
    }))
  });
}
