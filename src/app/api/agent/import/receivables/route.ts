import { carteraSheetGuard } from '@/lib/crm/cartera-sheet';
import { upsertReceivables, type ReceivableUpsert, type ReceivablesOptions } from '@/lib/crm/receivables';
import { fail, guardAgent, json } from '@/lib/crm/agent-http';

export const runtime = 'nodejs';

const MAX = 2000;

// POST { "receivables": [{ "externalId": "FE-1234", "nit": "900111222-3", "amount": 1500000, "balance": 900000,
//                          "dueAt": "2026-09-30", "seller": "IVAN HOYOS", "name": "Audiolujos" }],
//        "source": "cartera", "dryRun": true, "allowNoPhone": true, "closeMissing": false }
// One row per unpaid invoice. Re-sending the same externalId updates its balance. A balance of 0 marks it paid.
// "closeMissing": true means the request is the COMPLETE current report for that "source": items of that source
// that are no longer in it are marked paid. Always dry-run it first.
export async function POST(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    const { receivables, ...options } = (await request.json()) as { receivables?: ReceivableUpsert[] } & ReceivablesOptions;
    if (!Array.isArray(receivables) || receivables.length === 0) return json({ error: 'Envía { receivables: [...] }' }, 400);
    if (receivables.length > MAX) return json({ error: `Máximo ${MAX} por envío` }, 400);
    const blocked = carteraSheetGuard(options.source);
    if (blocked) return json({ error: blocked }, 409);
    return json(
      upsertReceivables(receivables.map((r) => ({ ...r, contactId: undefined })), {
        dryRun: options.dryRun === true,
        allowNoPhone: options.allowNoPhone === true,
        closeMissing: options.closeMissing === true,
        source: typeof options.source === 'string' ? options.source : ''
      })
    );
  } catch (e) {
    return fail(e, 400);
  }
}
