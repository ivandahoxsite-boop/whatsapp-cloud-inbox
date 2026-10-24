import { upsertSales, type SaleUpsert } from '@/lib/crm/customers';
import { fail, guardAgent, json } from '@/lib/crm/agent-http';

export const runtime = 'nodejs';

const MAX = 2000;

// POST { "sales": [{ "phone": "3001234567", "soldAt": "2026-03-15", "amount": 850000, "product": "Amplificador X",
//                    "externalId": "FE-1234", "name": "Audiolujos", "city": "Medellín" }] }
// externalId (invoice number) makes re-sending the same sales safe: they are stored once.
export async function POST(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    const { sales } = (await request.json()) as { sales?: SaleUpsert[] };
    if (!Array.isArray(sales) || sales.length === 0) return json({ error: 'Envía { sales: [...] }' }, 400);
    if (sales.length > MAX) return json({ error: `Máximo ${MAX} por envío; divide en lotes` }, 400);
    return json(upsertSales(sales));
  } catch (e) {
    return fail(e);
  }
}
