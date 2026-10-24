import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type FieldEntity = 'contact' | 'sale';
export type FieldType = 'text' | 'number' | 'date' | 'select';

export type CustomField = {
  id: number;
  entity: FieldEntity;
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  position: number;
};

export type Stage = { id: number; name: string; position: number };

const DEFAULT_STAGES = ['Nuevo', 'Contactado', 'Interesado', 'Negociación', 'Cliente'];

let db: DatabaseSync | null = null;

// The core columns are fixed; everything else lives in the JSON `data` columns
// and is described by the `fields` table, so the structure can change at any time
// without migrations.
export function getDb(): DatabaseSync {
  if (db) return db;

  const file = process.env.CRM_DB_PATH || path.join(process.cwd(), 'data', 'crm.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL CHECK (entity IN ('contact','sale')),
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      options TEXT NOT NULL DEFAULT '[]',
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE (entity, key)
    );
    CREATE TABLE IF NOT EXISTS stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      sold_at TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      product TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS sales_contact_idx ON sales(contact_id);
  `);

  const stageCount = db.prepare('SELECT COUNT(*) AS n FROM stages').get() as { n: number };
  if (stageCount.n === 0) {
    const insert = db.prepare('INSERT INTO stages (name, position) VALUES (?, ?)');
    DEFAULT_STAGES.forEach((name, i) => insert.run(name, i));
  }

  return db;
}

export function slugifyKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

type FieldRow = Omit<CustomField, 'options'> & { options: string };

export function listFields(entity?: FieldEntity): CustomField[] {
  const rows = (
    entity
      ? getDb().prepare('SELECT * FROM fields WHERE entity = ? ORDER BY position, id').all(entity)
      : getDb().prepare('SELECT * FROM fields ORDER BY entity, position, id').all()
  ) as unknown as FieldRow[];
  return rows.map((r) => ({ ...r, options: JSON.parse(r.options) as string[] }));
}

export function upsertField(input: {
  entity: FieldEntity;
  label: string;
  key?: string;
  type?: FieldType;
  options?: string[];
}): CustomField {
  const key = input.key || slugifyKey(input.label);
  if (!key) throw new Error('Nombre de campo inválido');
  const d = getDb();
  const existing = d.prepare('SELECT id FROM fields WHERE entity = ? AND key = ?').get(input.entity, key);
  if (existing) return listFields(input.entity).find((f) => f.key === key)!;

  const pos = d.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM fields WHERE entity = ?').get(input.entity) as {
    p: number;
  };
  d.prepare('INSERT INTO fields (entity, key, label, type, options, position) VALUES (?,?,?,?,?,?)').run(
    input.entity,
    key,
    input.label,
    input.type ?? 'text',
    JSON.stringify(input.options ?? []),
    pos.p
  );
  return listFields(input.entity).find((f) => f.key === key)!;
}

export function updateField(id: number, patch: { label?: string; type?: FieldType; options?: string[] }) {
  const d = getDb();
  if (patch.label !== undefined) d.prepare('UPDATE fields SET label = ? WHERE id = ?').run(patch.label, id);
  if (patch.type !== undefined) d.prepare('UPDATE fields SET type = ? WHERE id = ?').run(patch.type, id);
  if (patch.options !== undefined) d.prepare('UPDATE fields SET options = ? WHERE id = ?').run(JSON.stringify(patch.options), id);
}

export function deleteField(id: number) {
  getDb().prepare('DELETE FROM fields WHERE id = ?').run(id);
}

export function listStages(): Stage[] {
  return getDb().prepare('SELECT * FROM stages ORDER BY position, id').all() as unknown as Stage[];
}

export function addStage(name: string): Stage {
  const d = getDb();
  const pos = d.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM stages').get() as { p: number };
  d.prepare('INSERT INTO stages (name, position) VALUES (?, ?)').run(name, pos.p);
  return listStages().find((s) => s.name === name)!;
}

export function renameStage(id: number, name: string) {
  getDb().prepare('UPDATE stages SET name = ? WHERE id = ?').run(name, id);
}

export function deleteStage(id: number) {
  getDb().prepare('DELETE FROM stages WHERE id = ?').run(id);
}
