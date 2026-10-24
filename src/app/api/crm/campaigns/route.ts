import { NextResponse } from 'next/server';
import { createCampaign, listCampaigns, type NewCampaign } from '@/lib/crm/campaigns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (error: unknown, status = 400) =>
  NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status });

export async function GET() {
  try {
    return NextResponse.json({ campaigns: listCampaigns() });
  } catch (e) {
    return fail(e, 500);
  }
}

// POST { name, templateName, language, bodyText, parameterInfo, paramMap: ["{nombre}", "texto fijo"], filter }
// Only builds the recipient list. Nothing is sent until POST /api/crm/campaigns/{id} { action: "send" }.
export async function POST(request: Request) {
  try {
    return NextResponse.json(createCampaign((await request.json()) as NewCampaign), { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
