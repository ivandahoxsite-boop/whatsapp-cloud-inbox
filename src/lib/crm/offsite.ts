import fs from 'node:fs';

// The nightly off-server backup (deploy/offsite-backup.sh) writes a small status file. The CRM only reads it, to warn
// when copies stop going up: a backup that fails silently is the worst kind.

const STATUS_PATH = () => process.env.CRM_OFFSITE_STATUS || '/var/lib/crm/offsite-backup.json';
const STALE_HOURS = 36;

export type OffsiteStatus = { lastOk: string | null; lastAttempt: string | null; lastError: string | null };

/** null when the off-server backup was never set up (no status file). */
export function offsiteStatus(): OffsiteStatus | null {
  try {
    const j = JSON.parse(fs.readFileSync(STATUS_PATH(), 'utf8')) as Partial<OffsiteStatus>;
    return { lastOk: j.lastOk || null, lastAttempt: j.lastAttempt || null, lastError: j.lastError || null };
  } catch {
    return null;
  }
}

/** A line for the morning brief when the last good copy is too old, or null when all is well (or not set up). */
export function offsiteWarning(now = new Date()): string | null {
  const s = offsiteStatus();
  if (!s) return null;
  const ageH = s.lastOk ? (now.getTime() - Date.parse(s.lastOk)) / 3_600_000 : Infinity;
  if (ageH <= STALE_HOURS) return null;
  const since = s.lastOk ? `hace ${Math.floor(ageH / 24)} día(s)` : 'nunca se ha completado';
  return `⚠️ La copia de seguridad en Google Drive ${s.lastOk ? `no se hace desde ${since}` : since}${s.lastError ? ` (${s.lastError})` : ''}. Avísale a quien administra el servidor.`;
}
