import { reportFilterFrom, salesReport } from '@/lib/crm/reports';
import { fail, guardAgent, json } from '@/lib/crm/agent-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?from=2025-01-01&to=2025-12-31&seller=IVAN HOYOS&zone=ANTIOQUIA
// Totals, by month / seller / zone, top products, products bought together and products customers stopped buying.
export async function GET(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    return json(salesReport(reportFilterFrom(request.url)));
  } catch (e) {
    return fail(e);
  }
}
