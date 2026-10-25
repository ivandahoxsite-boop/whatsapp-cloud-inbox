import { collectionQueue } from '@/lib/crm/collections';
import { fail, guardAgent, json } from '@/lib/crm/agent-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?minDays=30&minAmount=500000&limit=10
// Customers that may be called about a debt RIGHT NOW. `window.allowed` is false outside the legal hours
// (Mon-Fri 7-19, Sat 8-15, no Sundays or holidays, Colombian time), and then `queue` is empty: do not dial.
export async function GET(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    const p = new URL(request.url).searchParams;
    const num = (k: string) => (p.get(k) && Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : undefined);
    return json(collectionQueue({ minDays: num('minDays'), minAmount: num('minAmount'), limit: num('limit') }));
  } catch (e) {
    return fail(e);
  }
}
