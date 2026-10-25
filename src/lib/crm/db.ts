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
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS activities_contact_idx ON activities(contact_id, id);
    CREATE TABLE IF NOT EXISTS processed_events (
      key TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Messages proposed by the agent. Nothing reaches WhatsApp until approved.
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','rejected','failed')),
      error TEXT NOT NULL DEFAULT '',
      proposed_by TEXT NOT NULL DEFAULT 'agent',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at TEXT
    );
  `);

  migrate(db);

  const stageCount = db.prepare('SELECT COUNT(*) AS n FROM stages').get() as { n: number };
  if (stageCount.n === 0) {
    const insert = db.prepare('INSERT INTO stages (name, position) VALUES (?, ?)');
    DEFAULT_STAGES.forEach((name, i) => insert.run(name, i));
  }

  return db;
}

// Additive, idempotent schema changes for databases created by earlier versions.
function migrate(d: DatabaseSync) {
  const saleCols = d.prepare('PRAGMA table_info(sales)').all() as unknown as { name: string }[];
  // Invoice / order number from the source system: re-importing the same sale never duplicates it.
  if (!saleCols.some((c) => c.name === 'external_id')) d.exec('ALTER TABLE sales ADD COLUMN external_id TEXT');
  d.exec('CREATE UNIQUE INDEX IF NOT EXISTS sales_external_idx ON sales(external_id) WHERE external_id IS NOT NULL');

  const contactCols = d.prepare('PRAGMA table_info(contacts)').all() as unknown as { name: string }[];
  if (!contactCols.some((c) => c.name === 'city')) {
    d.exec("ALTER TABLE contacts ADD COLUMN city TEXT NOT NULL DEFAULT ''");
    // City used to be a custom field; promote it to a real column so it can be grouped and filtered.
    d.exec(`UPDATE contacts SET city = trim(COALESCE(json_extract(data, '$.ciudad'), json_extract(data, '$.city'), ''))`);
    d.exec("DELETE FROM fields WHERE entity = 'contact' AND key IN ('ciudad', 'city')");
  }
  // call_requests.scheduled_at (UTC) is when the user wants the call made; null means "whenever the rules allow it".
  const crCols = d.prepare("PRAGMA table_info(call_requests)").all() as unknown as { name: string }[];
  if (crCols.length && !crCols.some((c) => c.name === 'scheduled_at')) d.exec('ALTER TABLE call_requests ADD COLUMN scheduled_at TEXT');
  d.exec(`
    CREATE INDEX IF NOT EXISTS contacts_city_idx ON contacts(city);
    -- Lets the webhook and the history sync skip WhatsApp messages that are already stored.
    CREATE INDEX IF NOT EXISTS activities_message_idx ON activities(json_extract(meta, '$.message_id'));
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      color TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS contact_tags (
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (contact_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS contact_tags_tag_idx ON contact_tags(tag_id);
    -- Data imported before these fixes: media placeholders and phone numbers used as names.
    UPDATE activities SET text = '📎 Archivo' WHERE text LIKE '[Media%]';
    UPDATE contacts SET name = '' WHERE name <> '' AND trim(name, '0123456789+ ()-') = '';
    -- Result of each WhatsApp history import, so it survives restarts and updates.
    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      pages INTEGER NOT NULL DEFAULT 0,
      messages_seen INTEGER NOT NULL DEFAULT 0,
      activities_added INTEGER NOT NULL DEFAULT 0,
      contacts_created INTEGER NOT NULL DEFAULT 0,
      names_filled INTEGER NOT NULL DEFAULT 0,
      oldest_message_at TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    -- Invoices still to be collected (accounts receivable), loaded from the billing system's aging report.
    CREATE TABLE IF NOT EXISTS receivables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL UNIQUE,
      doc TEXT NOT NULL DEFAULT '',
      issued_at TEXT,
      due_at TEXT,
      amount REAL NOT NULL DEFAULT 0,
      balance REAL NOT NULL DEFAULT 0,
      seller TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid')),
      paid_at TEXT,
      data TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS receivables_contact_idx ON receivables(contact_id, status);
    -- Customers the user marked "to call" about a debt. OpenClaw dials only these, only when the rules allow it.
    CREATE TABLE IF NOT EXISTS call_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT,
      scheduled_at TEXT
    );
    CREATE INDEX IF NOT EXISTS call_requests_idx ON call_requests(status, contact_id);
    -- WhatsApp template campaigns: one row per recipient; nothing is sent until a person starts the campaign.
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      template_name TEXT NOT NULL,
      language TEXT NOT NULL,
      body_text TEXT NOT NULL DEFAULT '',
      param_info TEXT NOT NULL DEFAULT '{}',
      param_map TEXT NOT NULL DEFAULT '[]',
      filter TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','done','cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS campaign_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      params TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','excluded')),
      error TEXT NOT NULL DEFAULT '',
      sent_at TEXT,
      UNIQUE (campaign_id, contact_id)
    );
    CREATE INDEX IF NOT EXISTS campaign_items_status_idx ON campaign_items(campaign_id, status);
    CREATE INDEX IF NOT EXISTS campaign_items_sent_idx ON campaign_items(sent_at);
    -- Chats the user closed from the "Pendientes" tab; they come back only if the customer writes again.
    CREATE TABLE IF NOT EXISTS chat_resolutions (
      contact_id INTEGER PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'resolved' CHECK (kind IN ('resolved','ignored')),
      resolved_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- To-dos the user writes by hand ("llevarle el imán a Jesús", Monday), optionally tied to a customer and repeating.
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      due_date TEXT,
      due_time TEXT,
      repeat TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      done_at TEXT
    );
    CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status, due_date);
    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      filter TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const taskCols = d.prepare('PRAGMA table_info(tasks)').all() as unknown as { name: string }[];
  if (!taskCols.some((c) => c.name === 'due_time')) d.exec('ALTER TABLE tasks ADD COLUMN due_time TEXT');
}

/**
 * Changes whenever anything is written to the database, by this connection (total_changes) or by another one
 * (data_version). Cheap enough to poll every few seconds, and the key for caching derived data.
 */
export function dataVersion(): string {
  const d = getDb();
  const changes = (d.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  const other = (d.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
  return `${changes}.${other}`;
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
