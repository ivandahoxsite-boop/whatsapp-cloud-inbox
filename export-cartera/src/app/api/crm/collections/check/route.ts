import { NextResponse } from 'next/server';
import { checkCustomers, hoursOffUntil } from '@/lib/crm/collections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?customerId=12 -> { window, checks: [{ allowed, reasons, ... }] } so the CRM can warn before you dial or write.
// &aviso=1: a reminder before the due date ("Por vencer"), which does not need overdue debt.
// While the test switch (hoursOffUntil) is on, the hours do not block the WhatsApp buttons.
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const id = Number(p.get('customerId'));
    return NextResponse.json(checkCustomers({ customerId: id }, new Date(), { ignoreWindow: !!hoursOffUntil(), reminder: p.get('aviso') === '1' }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 400 });
  }
}
