import { requestedCalls } from '@/lib/crm/collections';
import { fail, guardAgent, json } from '@/lib/crm/agent-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The customers the user marked "to call" in the CRM, each with a fresh check. Dial ONLY the ones with allowed: true
// (the hours are checked now) and still ask the user for the OK in Telegram before dialing.
export async function GET(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    return json(requestedCalls());
  } catch (e) {
    return fail(e);
  }
}
