import { NextResponse } from 'next/server';
import { getDb } from '@/lib/crm/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type MonthlyRevenue = { month: string; revenue: number; sales: number; newRevenue: number; repeatRevenue: number };
export type ProductRevenue = { product: string; revenue: number; sales: number; customers: number };
export type Summary = {
  months: MonthlyRevenue[];
  products: ProductRevenue[];
  last30: number;
  prev30: number;
};

export async function GET() {
  const d = getDb();
  // A sale is "new" when it is the customer's first purchase ever; everything after counts as repeat revenue.
  const months = d
    .prepare(
      `WITH ranked AS (
         SELECT amount, substr(sold_at, 1, 7) AS month,
                ROW_NUMBER() OVER (PARTITION BY contact_id ORDER BY sold_at, id) AS n
         FROM sales
       )
       SELECT month, SUM(amount) AS revenue, COUNT(*) AS sales,
              SUM(CASE WHEN n = 1 THEN amount ELSE 0 END) AS newRevenue,
              SUM(CASE WHEN n > 1 THEN amount ELSE 0 END) AS repeatRevenue
       FROM ranked GROUP BY month ORDER BY month DESC LIMIT 12`
    )
    .all() as unknown as MonthlyRevenue[];
  const products = d
    .prepare(
      `SELECT CASE WHEN trim(product) = '' THEN 'Sin producto' ELSE product END AS product,
              SUM(amount) AS revenue, COUNT(*) AS sales, COUNT(DISTINCT contact_id) AS customers
       FROM sales GROUP BY 1 ORDER BY revenue DESC LIMIT 8`
    )
    .all() as unknown as ProductRevenue[];
  const window = d
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN sold_at > date('now', '-30 day') THEN amount END), 0) AS last30,
         COALESCE(SUM(CASE WHEN sold_at > date('now', '-60 day') AND sold_at <= date('now', '-30 day') THEN amount END), 0) AS prev30
       FROM sales`
    )
    .get() as { last30: number; prev30: number };
  const body: Summary = { months: months.reverse(), products, ...window };
  return NextResponse.json(body);
}
