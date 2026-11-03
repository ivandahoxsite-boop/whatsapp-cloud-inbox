import { NextResponse } from 'next/server';
import { carteraClients, linkCarteraClient, rejectCarteraSuggestion, searchContacts, sheetClientInvoices, unlinkCarteraClient } from '@/lib/crm/cartera-sheet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status });

// GET -> the sheet's customers with debt and their WhatsApp contact (or a suggestion). GET ?q=juan -> contacts to pick.
// GET ?facturas=NIT[&tab=cali] -> the open invoices of that customer.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const q = params.get('q');
    if (q !== null) return NextResponse.json({ contacts: searchContacts(q) });
    // ?facturas=NIT (&tab=cali) -> that customer's open invoices, for the customers still without WhatsApp.
    const facturas = params.get('facturas');
    if (facturas !== null) return NextResponse.json({ invoices: sheetClientInvoices(facturas, params.get('tab') === 'cali') });
    return NextResponse.json({ clients: carteraClients() });
  } catch (e) {
    return fail(e, 500);
  }
}

// POST { key, contactId } or { key, phone } -> links. { key, reject: true } -> "no es ese". { key, unlink: true } -> undo.
export async function POST(request: Request) {
  try {
    const b = (await request.json()) as { key?: string; contactId?: number; phone?: string; name?: string; reject?: boolean; unlink?: boolean };
    const key = String(b.key ?? '');
    if (b.reject) rejectCarteraSuggestion(key);
    else if (b.unlink) unlinkCarteraClient(key);
    else return NextResponse.json({ ok: true, contact: linkCarteraClient(key, { contactId: b.contactId, phone: b.phone, name: b.name }) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
