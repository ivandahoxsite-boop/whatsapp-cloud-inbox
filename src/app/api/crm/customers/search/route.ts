import { NextResponse } from 'next/server';
import { searchContacts } from '@/lib/crm/cartera-sheet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?q=reality -> WhatsApp contacts to pick as the phone of a customer that has none.
export async function GET(request: Request) {
  try {
    return NextResponse.json({ contacts: searchContacts(new URL(request.url).searchParams.get('q') ?? '') });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
