import { NextResponse } from 'next/server';
import { carteraExtract } from '@/lib/crm/cartera-extract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?seller=IVAN HOYOS -> the cartera like the "Reporte Extracto de Cartera" Excel (grouped by customer).
export async function GET(request: Request) {
  try {
    return NextResponse.json(carteraExtract({ seller: new URL(request.url).searchParams.get('seller') || undefined }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
