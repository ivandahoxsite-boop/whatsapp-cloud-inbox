import { NextResponse } from 'next/server';
import { dataVersion } from '@/lib/crm/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Tiny "has anything changed?" check the CRM polls every few seconds to stay live.
export async function GET() {
  return NextResponse.json({ version: dataVersion() });
}
