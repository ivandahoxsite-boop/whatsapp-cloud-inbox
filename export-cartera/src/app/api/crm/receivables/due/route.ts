import { NextResponse } from 'next/server';
import { caliDueBetween, caliSearch } from '@/lib/crm/cartera-cali';
import { dueBetween, noticeDays, searchDue } from '@/lib/crm/push';
import { addDays, todayCo } from '@/lib/crm/tasks-info';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?days=1 -> invoices that fall due next: 1 = the next working day (as the morning warning), 3 or 7 = that many days.
// ?q=text searches any customer instead. A negative number looks back: -15 = invoices whose due date was in the last 15 days (yesterday included, today not).
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const n = Number(params.get('days')) || 1;
    const today = todayCo();
    // ?q= -> the search box: any customer, whatever the range (the range stays chosen for when the search is cleared).
    const q = params.get('q')?.trim();
    // ?tab=cali -> the same from the "Cartera Cali" tab, kept apart from the CRM's cartera.
    const cali = params.get('tab') === 'cali';
    if (q) return NextResponse.json({ from: today, to: today, customers: cali ? caliSearch(q, today) : searchDue(q, today), search: true });
    const days = n < 0 ? [addDays(today, Math.max(-90, n)), addDays(today, -1)] : n <= 1 ? noticeDays(today) : [addDays(today, 1), addDays(today, Math.min(30, n))];
    const [from, to] = [days[0], days[days.length - 1]];
    return NextResponse.json({ from, to, customers: cali ? caliDueBetween(from, to, today) : dueBetween(from, to) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
