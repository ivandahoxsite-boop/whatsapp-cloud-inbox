import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Errors that happen in the browser (the white "Application error" page) are otherwise invisible on the server.
// They go to the service log: journalctl -u crm --since today | grep CLIENT-ERROR
export async function POST(request: Request) {
  const raw = (await request.text().catch(() => '')).slice(0, 2000);
  console.error('[CLIENT-ERROR]', raw.replace(/[\r\n]+/g, ' '));
  return new NextResponse(null, { status: 204 });
}
