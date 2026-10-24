import { listCustomers, updateCustomer } from '@/lib/crm/customers';
import { addActivity, listActivities } from '@/lib/crm/agent-store';
import { getDb, listStages } from '@/lib/crm/db';
import { fail, guardAgent, json } from '@/lib/crm/agent-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const denied = guardAgent(request);
  if (denied) return denied;
  const id = Number((await params).id);
  const customer = listCustomers().find((c) => c.id === id);
  if (!customer) return json({ error: 'Cliente no encontrado' }, 404);
  const sales = getDb()
    .prepare('SELECT sold_at AS soldAt, amount, product FROM sales WHERE contact_id = ? ORDER BY sold_at DESC LIMIT 20')
    .all(id);
  return json({ customer, sales, activities: listActivities(id), stages: listStages() });
}

// PATCH { "stage": "Interesado", "note": "Pidió cotización" }
export async function PATCH(request: Request, { params }: Ctx) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    const id = Number((await params).id);
    if (!listCustomers().some((c) => c.id === id)) return json({ error: 'Cliente no encontrado' }, 404);
    const { stage, note } = (await request.json()) as { stage?: string; note?: string };
    if (stage !== undefined) {
      const found = listStages().find((s) => s.name.toLowerCase() === stage.toLowerCase());
      if (!found) return json({ error: `Etapa inválida. Opciones: ${listStages().map((s) => s.name).join(', ')}` }, 400);
      updateCustomer(id, { stageId: found.id });
      addActivity(id, 'stage', `Etapa → ${found.name}`, { by: 'agent' });
    }
    if (note?.trim()) addActivity(id, 'note', note.trim().slice(0, 1000), { by: 'agent' });
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
