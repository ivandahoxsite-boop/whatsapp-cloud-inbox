import { NextResponse } from 'next/server';
import { getDb } from '@/lib/crm/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type MonthlyRevenue = { month: string; revenue: number; sales: number };

export async function GET() {
  const rows = getDb()
    .prepare(
      `SELECT substr(sold_at, 1, 7) AS month, SUM(amount) AS revenue, COUNT(*) AS sales
       FROM sales GROUP BY month ORDER BY month DESC LIMIT 12`
    )
    .all() as unknown as MonthlyRevenue[];
  return NextResponse.json({ months: rows.reverse() });
}
