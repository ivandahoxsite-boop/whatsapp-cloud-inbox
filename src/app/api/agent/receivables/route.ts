import { receivablesSummary } from '@/lib/crm/receivables';
import { fail, guardAgent, json } from '@/lib/crm/agent-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?seller=IVAN HOYOS&limit=10 -> totals, aging buckets, by seller and the customers that owe the most (overdue first).
export async function GET(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    const p = new URL(request.url).searchParams;
    const limit = Math.min(100, Math.max(1, Number(p.get('limit')) || 10));
    const s = receivablesSummary({ seller: p.get('seller') || undefined });
    return json({ ...s, debtors: s.debtors.slice(0, limit) });
  } catch (e) {
    return fail(e);
  }
}
