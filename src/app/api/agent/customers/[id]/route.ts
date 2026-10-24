import { listCustomers, setCustomerPhone, updateCustomer } from '@/lib/crm/customers';
import { addActivity, listActivities } from '@/lib/crm/agent-store';
import { getDb, listStages } from '@/lib/crm/db';
import { fail, guardAgent, json } from '@/lib/crm/agent-http';
import { addTags, ensureTag } from '@/lib/crm/tags';

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

// PATCH { "stage": "Interesado", "note": "Pidió cotización", "city": "Cali", "addTags": ["VIP"], "phone": "3001234567" }
// "phone" gives a customer loaded without one its number (merging into the WhatsApp contact if that exists).
export async function PATCH(request: Request, { params }: Ctx) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    const id = Number((await params).id);
    if (!listCustomers().some((c) => c.id === id)) return json({ error: 'Cliente no encontrado' }, 404);
    const { stage, note, city, phone, addTags: tagNames } = (await request.json()) as {
      phone?: string;
      stage?: string;
      note?: string;
      city?: string;
      addTags?: string[];
    };
    let merged: { contactId: number; merged: boolean } | undefined;
    if (phone) merged = setCustomerPhone(id, String(phone));
    if (city !== undefined) updateCustomer(id, { city: String(city) });
    if (Array.isArray(tagNames) && tagNames.length) {
      addTags([id], tagNames.map(String).filter((t) => t.trim()).map(ensureTag));
      addActivity(id, 'tags', `Etiquetas + ${tagNames.join(', ')}`, { by: 'agent' });
    }
    if (stage !== undefined) {
      const found = listStages().find((s) => s.name.toLowerCase() === stage.toLowerCase());
      if (!found) return json({ error: `Etapa inválida. Opciones: ${listStages().map((s) => s.name).join(', ')}` }, 400);
      updateCustomer(id, { stageId: found.id });
      addActivity(id, 'stage', `Etapa → ${found.name}`, { by: 'agent' });
    }
    if (note?.trim()) addActivity(id, 'note', note.trim().slice(0, 1000), { by: 'agent' });
    return json({ ok: true, ...(merged ? { contactId: merged.contactId, merged: merged.merged } : {}) });
  } catch (e) {
    return fail(e);
  }
}
