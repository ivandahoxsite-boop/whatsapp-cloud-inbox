import { upsertCustomers, type CustomerUpsert } from '@/lib/crm/customers';
import { fail, guardAgent, json } from '@/lib/crm/agent-http';

export const runtime = 'nodejs';

const MAX = 2000;

// POST { "customers": [{ "phone": "3001234567", "name": "Audiolujos", "city": "Medellín", "tags": ["Mayorista"] }] }
export async function POST(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    const { customers, allowNoPhone } = (await request.json()) as { customers?: CustomerUpsert[]; allowNoPhone?: boolean };
    if (!Array.isArray(customers) || customers.length === 0) return json({ error: 'Envía { customers: [...] }' }, 400);
    if (customers.length > MAX) return json({ error: `Máximo ${MAX} por envío; divide en lotes` }, 400);
    return json(upsertCustomers(customers, { allowNoPhone: allowNoPhone === true }));
  } catch (e) {
    return fail(e);
  }
}
