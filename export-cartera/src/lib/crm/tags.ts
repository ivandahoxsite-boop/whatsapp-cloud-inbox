import { getDb } from './db';

export type Tag = { id: number; name: string; color: string; count: number };

export const TAG_COLORS = ['#34d399', '#38bdf8', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#22d3ee', '#f87171'];

export function listTags(): Tag[] {
  return getDb()
    .prepare(
      `SELECT t.id, t.name, t.color, COUNT(ct.contact_id) AS count
       FROM tags t LEFT JOIN contact_tags ct ON ct.tag_id = t.id
       GROUP BY t.id ORDER BY t.name COLLATE NOCASE`
    )
    .all() as unknown as Tag[];
}

/** Returns the id of the tag with this name, creating it if needed (names are case-insensitive). */
export function ensureTag(rawName: string): number {
  const name = rawName.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name) throw new Error('Etiqueta vacía');
  const d = getDb();
  const found = d.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number } | undefined;
  if (found) return found.id;
  const n = (d.prepare('SELECT COUNT(*) AS n FROM tags').get() as { n: number }).n;
  return Number(d.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(name, TAG_COLORS[n % TAG_COLORS.length]).lastInsertRowid);
}

export function updateTag(id: number, patch: { name?: string; color?: string }) {
  const d = getDb();
  if (patch.name?.trim()) d.prepare('UPDATE tags SET name = ? WHERE id = ?').run(patch.name.trim().slice(0, 40), id);
  if (patch.color && /^#[0-9a-f]{6}$/i.test(patch.color)) d.prepare('UPDATE tags SET color = ? WHERE id = ?').run(patch.color, id);
}

export function deleteTag(id: number) {
  getDb().prepare('DELETE FROM tags WHERE id = ?').run(id);
}

export function tagsByContact(): Map<number, number[]> {
  const rows = getDb().prepare('SELECT contact_id, tag_id FROM contact_tags').all() as unknown as { contact_id: number; tag_id: number }[];
  const map = new Map<number, number[]>();
  for (const r of rows) map.set(r.contact_id, [...(map.get(r.contact_id) ?? []), r.tag_id]);
  return map;
}

export function addTags(contactIds: number[], tagIds: number[]) {
  const stmt = getDb().prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)');
  for (const c of contactIds) for (const t of tagIds) stmt.run(c, t);
}

export function removeTags(contactIds: number[], tagIds: number[]) {
  const stmt = getDb().prepare('DELETE FROM contact_tags WHERE contact_id = ? AND tag_id = ?');
  for (const c of contactIds) for (const t of tagIds) stmt.run(c, t);
}
