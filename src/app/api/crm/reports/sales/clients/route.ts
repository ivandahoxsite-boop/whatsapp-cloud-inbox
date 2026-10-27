import { NextResponse } from 'next/server';
import { analixUnlinked } from '@/lib/crm/analix';
import { lockedResponse } from '@/lib/crm/lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> AnaliX customers whose sales are not on a WhatsApp contact yet. Linking goes through /api/crm/receivables/links.
export async function GET(request: Request) {
  const locked = lockedResponse(request);
  if (locked) return locked;
  try {
    return NextResponse.json({ clients: analixUnlinked() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
