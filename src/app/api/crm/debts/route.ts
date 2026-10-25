import { NextResponse } from 'next/server';
import { debtsByPhone } from '@/lib/crm/receivables';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> { debts: { "573001234567": { contactId, balance, overdue, days } } } for the debt warning in the inbox.
export async function GET() {
  try {
    return NextResponse.json({ debts: debtsByPhone() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
