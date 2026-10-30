import { NextResponse } from 'next/server';
import { caliExtract, carteraExtract } from '@/lib/crm/cartera-extract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?seller=IVAN HOYOS -> the cartera like the "Reporte Extracto de Cartera" Excel (grouped by customer).
// ?tab=cali -> the same for the "Cartera Cali" tab of the sheet, kept apart from the CRM's cartera.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const filter = { seller: params.get('seller') || undefined };
    return NextResponse.json(params.get('tab') === 'cali' ? caliExtract(filter) : carteraExtract(filter));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
