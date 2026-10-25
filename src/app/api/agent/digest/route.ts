import { buildDigest } from '@/lib/crm/digest';
import { fail, guardAgent, json } from '@/lib/crm/agent-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?limit=5 -> { quiet, reason, text, counts, ... }. `text` is ready to post in Telegram as is.
// `quiet: true` (Sunday or Colombian holiday): post NOTHING.
export async function GET(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    const limit = Math.min(10, Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 5));
    return json(buildDigest(limit));
  } catch (e) {
    return fail(e);
  }
}
