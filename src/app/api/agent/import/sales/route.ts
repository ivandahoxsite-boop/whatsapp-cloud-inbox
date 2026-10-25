import { upsertSales, type SaleUpsert, type SalesOptions } from '@/lib/crm/customers';
import { fail, guardAgent, json } from '@/lib/crm/agent-http';

export const runtime = 'nodejs';

const MAX = 2000;

// POST { "sales": [{ "phone": "3001234567", "soldAt": "2026-03-15", "amount": 850000, "product": "Amplificador X",
//                    "externalId": "FE-1234", "name": "Audiolujos", "city": "Medellín" }] }
// externalId (invoice number) makes re-sending the same sales safe: they are stored once.
// Optional top-level: "dryRun": true (nothing is stored; shows created/duplicates/conflicts),
// "onConflict": "skip" (leave out sales whose phone already holds another client) and
// "sharedPhones": ["3001234567"] (phones confirmed as one business with several names),
// "updateExisting": true (sales already stored get their data — seller, zone, qty — completed instead of skipped).
export async function POST(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    const { sales, ...options } = (await request.json()) as { sales?: SaleUpsert[] } & SalesOptions;
    if (!Array.isArray(sales) || sales.length === 0) return json({ error: 'Envía { sales: [...] }' }, 400);
    if (sales.length > MAX) return json({ error: `Máximo ${MAX} por envío; divide en lotes` }, 400);
    const onConflict = options.onConflict === 'skip' ? 'skip' : 'allow';
    const sharedPhones = Array.isArray(options.sharedPhones) ? options.sharedPhones : [];
    return json(
      upsertSales(sales, {
        dryRun: options.dryRun === true,
        onConflict,
        sharedPhones,
        allowNoPhone: options.allowNoPhone === true,
        updateExisting: options.updateExisting === true
      })
    );
  } catch (e) {
    return fail(e);
  }
}
