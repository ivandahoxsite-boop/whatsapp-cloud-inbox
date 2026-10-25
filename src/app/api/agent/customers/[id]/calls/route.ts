import { recordCall, type CallInput } from '@/lib/crm/collections';
import { fail, guardAgent, json } from '@/lib/crm/agent-http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

// POST { "outcome": "promesa_pago", "summary": "Contestó Carlos. Dice que paga el viernes.", "promiseDate": "2026-10-30",
//        "promiseAmount": 1500000, "durationSec": 84 }
// outcome: promesa_pago | ya_pago | sin_respuesta | buzon | rechaza | pide_humano | numero_equivocado | no_llamar | otro
export async function POST(request: Request, { params }: Ctx) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    return json(recordCall(Number((await params).id), (await request.json()) as CallInput), 201);
  } catch (e) {
    return fail(e);
  }
}
