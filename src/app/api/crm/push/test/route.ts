import { NextResponse } from 'next/server';
import { dueNotice, sendPush } from '@/lib/crm/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST -> sends now the warning of what falls due next (or a test message when nothing does), to check the phone.
export async function POST() {
  try {
    const msg = dueNotice() ?? { title: '🔔 Avisos del CRM activados', body: 'Mañana no vence ninguna factura. Así se verán los avisos.', url: '/crm#por-vencer', tag: 'prueba' };
    return NextResponse.json(await sendPush(msg));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
