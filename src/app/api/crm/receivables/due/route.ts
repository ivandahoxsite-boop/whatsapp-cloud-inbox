import { NextResponse } from 'next/server';
import { dueBetween, noticeDays } from '@/lib/crm/push';
import { addDays, todayCo } from '@/lib/crm/tasks-info';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?days=1 -> invoices that fall due next: 1 = the next working day (as the morning warning), 3 or 7 = that many days.
// A negative number looks back: -15 = invoices whose due date was in the last 15 days (yesterday included, today not).
export async function GET(request: Request) {
  try {
    const n = Number(new URL(request.url).searchParams.get('days')) || 1;
    const today = todayCo();
    const days = n < 0 ? [addDays(today, Math.max(-90, n)), addDays(today, -1)] : n <= 1 ? noticeDays(today) : [addDays(today, 1), addDays(today, Math.min(30, n))];
    return NextResponse.json({ from: days[0], to: days[days.length - 1], customers: dueBetween(days[0], days[days.length - 1]) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
