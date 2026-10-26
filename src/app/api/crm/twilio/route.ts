import { NextResponse } from 'next/server';
import { connectCall, twilioConfig } from '@/lib/crm/twilio';
import { listCustomers } from '@/lib/crm/customers';
import { addActivity } from '@/lib/crm/agent-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> { configured, agent: "…4567" } so the screen knows whether "Llamar" goes through Twilio or the phone dialer.
export async function GET() {
  const cfg = twilioConfig();
  return NextResponse.json({ configured: !!cfg, agent: cfg ? `…${cfg.agent.slice(-4)}` : null });
}

// POST { contactId } -> Twilio rings your phone and connects you with the customer.
export async function POST(request: Request) {
  try {
    const { contactId } = (await request.json()) as { contactId: number };
    const c = listCustomers().find((x) => x.id === Number(contactId));
    if (!c) throw new Error('Cliente no encontrado');
    if (!c.hasPhone) throw new Error('Este cliente no tiene teléfono');
    const name = c.name.replace(/[^\p{L}\p{N}\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim();
    const call = await connectCall(c.phone, name);
    addActivity(c.id, 'twilio', 'Llamada por Twilio iniciada', { sid: call.sid });
    return NextResponse.json({ ok: true, ...call });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 400 });
  }
}
