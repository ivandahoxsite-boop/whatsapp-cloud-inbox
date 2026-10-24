import { getDb } from './db';
import { listCustomers, type Customer } from './customers';
import { matchesFilter, sanitizeFilter, type CustomerFilter } from './filters';
import { addActivity, lastPhoneNumberId } from './agent-store';
import { getWhatsAppClient } from '@/lib/whatsapp-client';
import { buildTemplatePayload } from './template-payload';
import { fillTemplate } from './campaigns-text';
import type { TemplateParameterInfo } from '@/types/whatsapp';

export type CampaignStatus = 'draft' | 'running' | 'done' | 'cancelled';
export type ItemStatus = 'pending' | 'sent' | 'failed' | 'excluded';

export type Campaign = {
  id: number;
  name: string;
  templateName: string;
  language: string;
  bodyText: string;
  paramMap: string[];
  paramInfo: TemplateParameterInfo;
  filter: CustomerFilter;
  status: CampaignStatus;
  createdAt: string;
  counts: Record<ItemStatus, number>;
};

export type CampaignItem = { id: number; contactId: number; name: string; phone: string; params: string[]; status: ItemStatus; error: string; sentAt: string | null };

/** Sends per hour across all campaigns. Meta limits new conversations per number, so start low. */
const HOURLY_LIMIT = () => Number(process.env.CRM_MAX_CAMPAIGN_SENDS_PER_HOUR || 40);
/** A customer who got any campaign message in the last N days is left out of a new one. */
const REST_DAYS = () => Number(process.env.CRM_CAMPAIGN_REST_DAYS || 7);

/** Values a template parameter can take besides fixed text. */
export const PARAM_TOKENS = ['{nombre}', '{ciudad}', '{producto}'] as const;

const firstName = (c: Customer) => c.name.trim().split(/\s+/)[0] ?? '';

function render(token: string, c: Customer): string {
  return token
    .replaceAll('{nombre}', firstName(c))
    .replaceAll('{ciudad}', c.city)
    .replaceAll('{producto}', c.favoriteProduct ?? '')
    .trim();
}

type Row = {
  id: number; name: string; template_name: string; language: string; body_text: string; param_info: string; param_map: string; filter: string; status: CampaignStatus; created_at: string;
};

function toCampaign(r: Row): Campaign {
  const counts = { pending: 0, sent: 0, failed: 0, excluded: 0 } as Record<ItemStatus, number>;
  const rows = getDb().prepare('SELECT status, COUNT(*) AS n FROM campaign_items WHERE campaign_id = ? GROUP BY status').all(r.id) as unknown as { status: ItemStatus; n: number }[];
  for (const x of rows) counts[x.status] = x.n;
  return {
    id: r.id, name: r.name, templateName: r.template_name, language: r.language, bodyText: r.body_text,
    paramMap: JSON.parse(r.param_map), paramInfo: JSON.parse(r.param_info), filter: JSON.parse(r.filter), status: r.status, createdAt: r.created_at, counts
  };
}

export function listCampaigns(): Campaign[] {
  return (getDb().prepare('SELECT * FROM campaigns ORDER BY id DESC LIMIT 50').all() as unknown as Row[]).map(toCampaign);
}

export function getCampaign(id: number): Campaign | null {
  const r = getDb().prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Row | undefined;
  return r ? toCampaign(r) : null;
}

export function listItems(campaignId: number, limit = 500): CampaignItem[] {
  const rows = getDb()
    .prepare(
      `SELECT i.id, i.contact_id, c.name, c.phone, i.params, i.status, i.error, i.sent_at
       FROM campaign_items i JOIN contacts c ON c.id = i.contact_id
       WHERE i.campaign_id = ? ORDER BY i.id LIMIT ?`
    )
    .all(campaignId, limit) as unknown as { id: number; contact_id: number; name: string; phone: string; params: string; status: ItemStatus; error: string; sent_at: string | null }[];
  return rows.map((r) => ({ id: r.id, contactId: r.contact_id, name: r.name, phone: r.phone, params: JSON.parse(r.params), status: r.status, error: r.error, sentAt: r.sent_at }));
}

export type NewCampaign = {
  name: string;
  templateName: string;
  language: string;
  bodyText: string;
  parameterInfo: TemplateParameterInfo;
  /** One entry per template parameter (header and body, in order): fixed text or a token such as {nombre}. */
  paramMap: string[];
  filter: unknown;
};

/**
 * Builds the recipient list for a campaign without sending anything. People without a phone, people who
 * were messaged by a campaign recently, and people for whom a parameter would be empty are left out.
 */
export function createCampaign(input: NewCampaign) {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new Error('Ponle nombre a la campaña');
  if (!input.templateName) throw new Error('Elige una plantilla');
  const unsupported = input.parameterInfo.parameters.find((p) => p.component === 'BUTTON');
  if (unsupported) throw new Error('Esta plantilla tiene botones con variables: por ahora envíala desde la bandeja');
  const needed = input.parameterInfo.parameters.length;
  if (input.paramMap.length !== needed) throw new Error(`La plantilla necesita ${needed} variable(s)`);
  const filter = sanitizeFilter(input.filter);

  const d = getDb();
  const recent = new Set(
    (d.prepare(`SELECT DISTINCT contact_id FROM campaign_items WHERE status = 'sent' AND sent_at > datetime('now', ?)`).all(`-${REST_DAYS()} day`) as unknown as { contact_id: number }[]).map((r) => r.contact_id)
  );
  const recipients: { c: Customer; params: string[] }[] = [];
  const skipped = { noPhone: 0, rested: 0, missingData: 0 };
  for (const c of listCustomers()) {
    if (!matchesFilter(c, filter)) continue;
    if (!c.hasPhone) { skipped.noPhone++; continue; }
    if (recent.has(c.id)) { skipped.rested++; continue; }
    const params = input.paramMap.map((t) => render(t, c));
    if (params.some((v) => !v)) { skipped.missingData++; continue; }
    recipients.push({ c, params });
  }
  if (!recipients.length) throw new Error('Ningún cliente cumple: revisa el filtro o los datos que usa la plantilla');

  d.exec('BEGIN');
  try {
    const id = Number(
      d.prepare('INSERT INTO campaigns (name, template_name, language, body_text, param_info, param_map, filter) VALUES (?,?,?,?,?,?,?)').run(
        name, input.templateName, input.language, input.bodyText, JSON.stringify(input.parameterInfo), JSON.stringify(input.paramMap), JSON.stringify(filter)
      ).lastInsertRowid
    );
    const ins = d.prepare('INSERT INTO campaign_items (campaign_id, contact_id, params) VALUES (?,?,?)');
    for (const r of recipients) ins.run(id, r.c.id, JSON.stringify(r.params));
    d.exec('COMMIT');
    return { id, recipients: recipients.length, skipped };
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export function setItemExcluded(itemId: number, excluded: boolean) {
  getDb()
    .prepare("UPDATE campaign_items SET status = ? WHERE id = ? AND status IN ('pending','excluded') AND campaign_id IN (SELECT id FROM campaigns WHERE status IN ('draft','running'))")
    .run(excluded ? 'excluded' : 'pending', itemId);
}

export function cancelCampaign(id: number) {
  getDb().prepare("UPDATE campaigns SET status = 'cancelled' WHERE id = ? AND status IN ('draft','running')").run(id);
}

export function sentLastHour(): number {
  const r = getDb().prepare("SELECT COUNT(*) AS n FROM campaign_items WHERE status = 'sent' AND sent_at > datetime('now','-1 hour')").get() as { n: number };
  return r.n;
}

/**
 * Starts (or continues) a campaign: sends pending recipients one by one until the hourly allowance is used.
 * Called by a person pressing the button; call it again later for the rest.
 */
export async function sendBatch(id: number): Promise<{ sent: number; failed: number; remaining: number; limited: boolean; stopped?: string }> {
  const d = getDb();
  const row = d.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('Campaña no encontrada');
  if (row.status === 'cancelled' || row.status === 'done') throw new Error(`La campaña está ${row.status === 'done' ? 'terminada' : 'cancelada'}`);
  d.prepare("UPDATE campaigns SET status = 'running' WHERE id = ?").run(id);

  const info = JSON.parse(row.param_info) as TemplateParameterInfo;
  const allowance = Math.max(0, HOURLY_LIMIT() - sentLastHour());
  const pending = d
    .prepare("SELECT i.id, i.contact_id, i.params, c.phone FROM campaign_items i JOIN contacts c ON c.id = i.contact_id WHERE i.campaign_id = ? AND i.status = 'pending' ORDER BY i.id LIMIT ?")
    .all(id, allowance) as unknown as { id: number; contact_id: number; params: string; phone: string }[];

  let sent = 0;
  let failed = 0;
  let streak = 0;
  let stopped: string | undefined;
  for (const it of pending) {
    const params = JSON.parse(it.params) as string[];
    const phoneNumberId = lastPhoneNumberId(it.contact_id) || process.env.PHONE_NUMBER_ID;
    if (!phoneNumberId) { stopped = 'No sé desde qué número enviar: define PHONE_NUMBER_ID'; break; }
    try {
      const template = buildTemplatePayload(row.template_name, row.language, params, info);
      await getWhatsAppClient().messages.sendTemplate({ phoneNumberId, to: it.phone, template });
      d.prepare("UPDATE campaign_items SET status = 'sent', error = '', sent_at = datetime('now') WHERE id = ?").run(it.id);
      addActivity(it.contact_id, 'whatsapp_out', fillTemplate(row.body_text, info, params) || `Plantilla ${row.template_name}`, { phone_number_id: phoneNumberId, via: 'campaign', campaign_id: id });
      sent++;
      streak = 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al enviar';
      d.prepare("UPDATE campaign_items SET status = 'failed', error = ? WHERE id = ?").run(msg.slice(0, 300), it.id);
      failed++;
      // Three failures in a row usually mean something is wrong with the template or the account: stop, don't burn the list.
      if (++streak >= 3) { stopped = `Se detuvo tras 3 errores seguidos: ${msg.slice(0, 160)}`; break; }
    }
  }

  const remaining = (d.prepare("SELECT COUNT(*) AS n FROM campaign_items WHERE campaign_id = ? AND status = 'pending'").get(id) as { n: number }).n;
  if (remaining === 0) d.prepare("UPDATE campaigns SET status = 'done' WHERE id = ?").run(id);
  return { sent, failed, remaining, limited: remaining > 0 && !stopped && allowance <= pending.length, stopped };
}
