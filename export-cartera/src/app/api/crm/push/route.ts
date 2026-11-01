import { NextResponse } from 'next/server';
import { deletePushSubscription, pushCount, pushPublicKey, savePushSubscription, type PushSubscriptionJson } from '@/lib/crm/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status });

// GET -> the key a browser needs to subscribe, and how many devices get notifications.
export async function GET() {
  try {
    return NextResponse.json({ publicKey: pushPublicKey(), devices: pushCount() });
  } catch (e) {
    return fail(e, 500);
  }
}

// POST { subscription, device } -> this browser gets notifications. DELETE { endpoint } -> it stops.
export async function POST(request: Request) {
  try {
    const { subscription, device } = (await request.json()) as { subscription: PushSubscriptionJson; device?: string };
    savePushSubscription(subscription, String(device ?? ''));
    return NextResponse.json({ ok: true, devices: pushCount() });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const { endpoint } = (await request.json()) as { endpoint: string };
    deletePushSubscription(endpoint);
    return NextResponse.json({ ok: true, devices: pushCount() });
  } catch (e) {
    return fail(e);
  }
}
