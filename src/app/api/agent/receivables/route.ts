import { isAgingKey, receivablesSummary } from '@/lib/crm/receivables';
import { fail, guardAgent, json } from '@/lib/crm/agent-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?seller=IVAN HOYOS&bucket=d90&limit=10 (bucket: current | d1_30 | d31_60 | d61_90 | d90) -> totals, aging buckets, by seller and the customers that owe the most (overdue first).
export async function GET(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    const p = new URL(request.url).searchParams;
    const limit = Math.min(100, Math.max(1, Number(p.get('limit')) || 10));
    const bucket = p.get('bucket');
    const s = receivablesSummary({ seller: p.get('seller') || undefined, bucket: isAgingKey(bucket) ? bucket : undefined });
    return json({ ...s, debtors: s.debtors.slice(0, limit) });
  } catch (e) {
    return fail(e);
  }
}
