import { NextResponse } from 'next/server';
import { caliSummary } from '@/lib/crm/cartera-cali';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> the "Cartera Cali" tab's totals, aging and customers without WhatsApp (apart from the CRM's cartera).
// ?seller=NAME narrows it to one seller.
export async function GET(request: Request) {
  try {
    return NextResponse.json(caliSummary({ seller: new URL(request.url).searchParams.get('seller') || undefined }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
