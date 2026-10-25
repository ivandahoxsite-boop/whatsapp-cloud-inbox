import { NextResponse } from 'next/server';
import { checkCustomers } from '@/lib/crm/collections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?customerId=12 -> { window, checks: [{ allowed, reasons, ... }] } so the CRM can warn before you dial.
export async function GET(request: Request) {
  try {
    const id = Number(new URL(request.url).searchParams.get('customerId'));
    return NextResponse.json(checkCustomers({ customerId: id }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 400 });
  }
}
