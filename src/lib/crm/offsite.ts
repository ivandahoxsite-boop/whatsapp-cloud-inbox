import fs from 'node:fs';
import { getDb } from './db';

// The nightly off-server backup reports how it went, and the CRM warns in the morning brief when copies stop going up:
// a backup that fails silently is the worst kind.

const STATUS_PATH = () => process.env.CRM_OFFSITE_STATUS || '/var/lib/crm/offsite-backup.json';
const STALE_HOURS = 36;

export type OffsiteStatus = { lastOk: string | null; lastAttempt: string | null; lastError: string | null };

function fromFile(): OffsiteStatus | null {
  try {
    const j = JSON.parse(fs.readFileSync(STATUS_PATH(), 'utf8')) as Partial<OffsiteStatus>;
    return { lastOk: j.lastOk || null, lastAttempt: j.lastAttempt || null, lastError: j.lastError || null };
  } catch {
    return null;
  }
}

function fromReports(): OffsiteStatus | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'offsite_status'").get() as { value: string } | undefined;
  if (!row) return null;
  try {
    const j = JSON.parse(row.value) as Partial<OffsiteStatus>;
    return { lastOk: j.lastOk || null, lastAttempt: j.lastAttempt || null, lastError: j.lastError || null };
  } catch {
    return null;
  }
}

/**
 * The backup can report in two ways: the server script (deploy/offsite-backup.sh) writes a status file, and an agent
 * that makes the copy itself (OpenClaw) reports through POST /api/agent/backup-status. The newest of both counts.
 * null when no backup ever reported.
 */
export function offsiteStatus(): OffsiteStatus | null {
  const all = [fromFile(), fromReports()].filter((x): x is OffsiteStatus => !!x);
  if (!all.length) return null;
  const newest = (k: 'lastOk' | 'lastAttempt') => all.map((x) => x[k]).filter((v): v is string => !!v).sort().pop() ?? null;
  const lastAttempt = newest('lastAttempt');
  const latest = all.find((x) => x.lastAttempt === lastAttempt) ?? all[0];
  return { lastOk: newest('lastOk'), lastAttempt, lastError: latest.lastError };
}

/** Records a backup run reported by the agent. A failure keeps the last good time, so the warning can count from it. */
export function recordOffsiteReport(r: { ok: boolean; error?: string; file?: string; bytes?: number }, now = new Date()) {
  const prev = fromReports();
  const at = now.toISOString();
  const status = {
    lastOk: r.ok ? at : prev?.lastOk ?? null,
    lastAttempt: at,
    lastError: r.ok ? null : String(r.error || 'falló la copia').slice(0, 300),
    file: r.ok ? String(r.file ?? '').slice(0, 200) : undefined,
    bytes: r.ok && Number.isFinite(r.bytes) ? Number(r.bytes) : undefined
  };
  getDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('offsite_status', ?)").run(JSON.stringify(status));
  return status;
}

/** A line for the morning brief when the last good copy is too old, or null when all is well (or not set up). */
export function offsiteWarning(now = new Date()): string | null {
  const s = offsiteStatus();
  if (!s) return null;
  const ageH = s.lastOk ? (now.getTime() - Date.parse(s.lastOk)) / 3_600_000 : Infinity;
  if (ageH <= STALE_HOURS) return null;
  const since = s.lastOk ? `hace ${Math.floor(ageH / 24)} día(s)` : 'nunca se ha completado';
  return `⚠️ La copia de seguridad fuera del servidor ${s.lastOk ? `no se hace desde ${since}` : since}${s.lastError ? ` (${s.lastError})` : ''}. Avísale a quien administra el servidor.`;
}
