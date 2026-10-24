import { getDb } from './db';
import { sanitizeFilter, type CustomerFilter } from './filters';

export type SavedSegment = { id: number; name: string; filter: CustomerFilter; createdAt: string };

export function listSegments(): SavedSegment[] {
  const rows = getDb().prepare('SELECT id, name, filter, created_at FROM segments ORDER BY id').all() as unknown as {
    id: number; name: string; filter: string; created_at: string;
  }[];
  return rows.map((r) => ({ id: r.id, name: r.name, filter: sanitizeFilter(JSON.parse(r.filter)), createdAt: r.created_at }));
}

export function createSegment(name: string, filter: unknown): number {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new Error('Ponle un nombre al segmento');
  return Number(getDb().prepare('INSERT INTO segments (name, filter) VALUES (?, ?)').run(clean, JSON.stringify(sanitizeFilter(filter))).lastInsertRowid);
}

export function deleteSegment(id: number) {
  getDb().prepare('DELETE FROM segments WHERE id = ?').run(id);
}
