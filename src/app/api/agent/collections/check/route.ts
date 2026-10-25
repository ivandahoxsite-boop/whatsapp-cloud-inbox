import { checkCustomers } from '@/lib/crm/collections';
import { fail, guardAgent, json } from '@/lib/crm/agent-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?customerId=12   or   ?q=jaimar
// For customers the user chose by hand: `allowed` says whether each one can be called about a debt right now,
// `reasons` says why not (outside hours, holiday, asked not to be called, already called today, promise pending...).
export async function GET(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    const p = new URL(request.url).searchParams;
    const id = Number(p.get('customerId'));
    return json(checkCustomers({ customerId: Number.isFinite(id) && id > 0 ? id : undefined, q: p.get('q') ?? undefined }));
  } catch (e) {
    return fail(e);
  }
}
