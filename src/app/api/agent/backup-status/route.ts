import { fail, guardAgent, json } from '@/lib/crm/agent-http';
import { offsiteStatus, recordOffsiteReport } from '@/lib/crm/offsite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST { ok: true, file: "crm-2026-10-26-0315.db.gz.gpg", bytes: 9118653 }   after a backup was uploaded and checked
// POST { ok: false, error: "no se pudo subir a Drive" }                        when it failed
// The CRM keeps the time; the morning brief warns when no good copy was reported for 36 h.
export async function POST(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    const b = (await request.json()) as { ok?: unknown; error?: unknown; file?: unknown; bytes?: unknown };
    if (typeof b.ok !== 'boolean') throw new Error('Falta "ok" (true o false)');
    return json({ saved: recordOffsiteReport({ ok: b.ok, error: typeof b.error === 'string' ? b.error : undefined, file: typeof b.file === 'string' ? b.file : undefined, bytes: Number(b.bytes) }), status: offsiteStatus() });
  } catch (e) {
    return fail(e);
  }
}

export async function GET(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  return json({ status: offsiteStatus() });
}
