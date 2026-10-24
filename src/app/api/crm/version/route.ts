import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { dataVersion } from '@/lib/crm/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Which build of the app is running (empty in development).
let build: string | null = null;
function buildId(): string {
  if (build === null) {
    try {
      build = fs.readFileSync(path.join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim();
    } catch {
      build = '';
    }
  }
  return build;
}

// Tiny "has anything changed?" check the CRM polls every few seconds to stay live.
// `build` lets an open page notice that the server was updated and offer to reload.
export async function GET() {
  return NextResponse.json({ version: dataVersion(), build: buildId() });
}
