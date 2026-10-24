import { NextResponse } from 'next/server';
import { reportFilterFrom, salesReport } from '@/lib/crm/reports';
import { lockedResponse } from '@/lib/crm/lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?from=2025-01-01&to=2025-12-31&seller=IVAN HOYOS&zone=ANTIOQUIA
export async function GET(request: Request) {
  const locked = lockedResponse(request);
  if (locked) return locked;
  try {
    return NextResponse.json(salesReport(reportFilterFrom(request.url)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 });
  }
}
