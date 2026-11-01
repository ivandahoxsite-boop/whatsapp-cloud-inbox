// Click-to-call through Twilio: Twilio first rings YOUR phone; when you answer it says who it is calling and dials the
// customer, so you talk normally and the customer sees the company number. No AI, no recording.
// Credentials live only in /etc/crm/crm.env (set with deploy/setup-twilio.sh), never in the code or the chat.

export type TwilioConfig = { sid: string; token: string; from: string; agent: string; callerId: string };

const e164 = (s: string | undefined) => {
  const d = (s ?? '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return d;
  return /^3\d{9}$/.test(d) ? `+57${d}` : `+${d}`;
};

export function twilioConfig(): TwilioConfig | null {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? '';
  const token = process.env.TWILIO_AUTH_TOKEN?.trim() ?? '';
  const from = e164(process.env.TWILIO_FROM);
  const agent = e164(process.env.TWILIO_AGENT_PHONE);
  if (!/^AC[0-9a-f]{32}$/i.test(sid) || !token || !from || !agent) return null;
  return { sid, token, from, agent, callerId: e164(process.env.TWILIO_CALLER_ID) || from };
}

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

// Calls started in the last hour: a safety stop against a stuck button or a script calling in a loop.
const recent: number[] = [];
const MAX_PER_HOUR = Number(process.env.TWILIO_MAX_CALLS_PER_HOUR) || 40;

/**
 * Rings the agent's phone and, when answered, connects with `customerPhone` (digits, e.g. 573001234567).
 * `sayName` is read to the agent before dialing so they know who they are about to talk to.
 */
export async function connectCall(customerPhone: string, sayName: string): Promise<{ sid: string; status: string }> {
  const cfg = twilioConfig();
  if (!cfg) throw new Error('Twilio no está configurado: corre bash /opt/crm/deploy/setup-twilio.sh en el servidor');
  const to = e164(customerPhone);
  if (!/^\+\d{8,15}$/.test(to)) throw new Error('El cliente no tiene un teléfono válido');
  const now = Date.now();
  while (recent.length && now - recent[0] > 3_600_000) recent.shift();
  if (recent.length >= MAX_PER_HOUR) throw new Error(`Límite de ${MAX_PER_HOUR} llamadas por hora alcanzado. Espera un rato.`);

  const twiml =
    `<Response><Say language="es-MX">Conectando con ${xml(sayName.slice(0, 60) || 'el cliente')}.</Say>` +
    `<Dial callerId="${xml(cfg.callerId)}" timeout="30">${xml(to)}</Dial>` +
    `<Say language="es-MX">El cliente no contestó.</Say></Response>`;
  const res = await fetch(`${process.env.TWILIO_API_URL || 'https://api.twilio.com'}/2010-04-01/Accounts/${cfg.sid}/Calls.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.sid}:${cfg.token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ To: cfg.agent, From: cfg.from, Twiml: twiml, Timeout: '25' })
  });
  const body = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string; code?: number };
  if (!res.ok || !body.sid) {
    // Twilio's own reason (e.g. 21219: trial accounts can only call verified numbers).
    throw new Error(`Twilio no pudo llamar${body.code ? ` (código ${body.code})` : ''}: ${body.message ?? res.statusText}`);
  }
  recent.push(now);
  return { sid: body.sid, status: body.status ?? 'queued' };
}
