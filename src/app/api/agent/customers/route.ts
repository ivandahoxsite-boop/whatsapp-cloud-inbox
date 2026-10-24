import { listCustomers } from '@/lib/crm/customers';
import { fail, guardAgent, json } from '@/lib/crm/agent-http';
import { SEGMENT_INFO } from '@/lib/crm/scoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/agent/customers?segment=dormido_valioso&q=ana&limit=20
export async function GET(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const segment = url.searchParams.get('segment');
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    if (segment && !(segment in SEGMENT_INFO)) return json({ error: `segment inválido. Opciones: ${Object.keys(SEGMENT_INFO).join(', ')}` }, 400);

    const customers = listCustomers()
      .filter((c) => !segment || c.segment === segment)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ id, name, phone, stageId, segment, score, salesCount, totalSpent, daysSinceLastSale, data }) => ({
        id, name, phone, stageId, segment, score, salesCount, totalSpent, daysSinceLastSale, data
      }));
    return json({ customers });
  } catch (e) {
    return fail(e, 500);
  }
}
