import { NextResponse } from 'next/server';
import { getSyncState, startSync } from '@/lib/crm/kapso-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getSyncState());
}

// Starts importing the WhatsApp history stored in Kapso (read-only, sends nothing).
export async function POST() {
  const phoneNumberId = process.env.PHONE_NUMBER_ID?.trim();
  if (!process.env.KAPSO_API_KEY?.trim()) return NextResponse.json({ error: 'Falta KAPSO_API_KEY en el servidor' }, { status: 503 });
  if (!phoneNumberId) return NextResponse.json({ error: 'Falta PHONE_NUMBER_ID en el servidor' }, { status: 503 });
  return NextResponse.json(startSync(phoneNumberId));
}
