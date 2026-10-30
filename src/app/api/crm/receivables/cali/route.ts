import { NextResponse } from 'next/server';
import { caliSummary } from '@/lib/crm/cartera-cali';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> the "Cartera Cali" tab's totals, aging and customers without WhatsApp (apart from the CRM's cartera).
export async function GET() {
  try {
    return NextResponse.json(caliSummary());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
