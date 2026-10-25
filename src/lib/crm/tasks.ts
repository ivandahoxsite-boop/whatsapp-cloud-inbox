import { getDb } from './db';
import { isDate, nextDue, todayCo, type Repeat, type Task } from './tasks-info';

export { type Task } from './tasks-info';

const REPEATS: Repeat[] = ['', 'semanal', 'quincenal', 'mensual'];

type Row = { id: number; contact_id: number | null; text: string; due_date: string | null; repeat: Repeat; name: string | null; phone: string | null };

/** Open to-dos, soonest first (no date last). Optionally only one customer's. */
export function listTasks(contactId?: number): Task[] {
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.contact_id, t.text, t.due_date, t.repeat, c.name, c.phone
       FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
       WHERE t.status = 'open' ${contactId ? 'AND t.contact_id = ?' : ''}
       ORDER BY t.due_date IS NULL, t.due_date, t.id`
    )
    .all(...(contactId ? [contactId] : [])) as unknown as Row[];
  return rows.map((r) => ({
    id: r.id,
    contactId: r.contact_id,
    name: r.name ?? '',
    phone: r.phone ?? '',
    hasPhone: /^\d{7,}$/.test(r.phone ?? ''),
    text: r.text,
    dueDate: r.due_date,
    repeat: r.repeat
  }));
}

export function createTask(input: { contactId?: number | null; text: string; dueDate?: string | null; repeat?: string }): number {
  const text = (input.text ?? '').trim();
  if (!text) throw new Error('Escribe qué hay que hacer');
  if (text.length > 300) throw new Error('Máximo 300 letras');
  const dueDate = input.dueDate || null;
  if (dueDate && !isDate(dueDate)) throw new Error('Fecha inválida');
  const repeat = (input.repeat ?? '') as Repeat;
  if (!REPEATS.includes(repeat)) throw new Error('Repetición inválida');
  const db = getDb();
  if (input.contactId != null && !db.prepare('SELECT 1 FROM contacts WHERE id = ?').get(input.contactId)) throw new Error('El cliente no existe');
  const r = db.prepare('INSERT INTO tasks (contact_id, text, due_date, repeat) VALUES (?, ?, ?, ?)').run(input.contactId ?? null, text, dueDate, repeat);
  return Number(r.lastInsertRowid);
}

/** Marks a to-do done. A repeating one leaves the next occurrence open (always in the future). */
export function completeTask(id: number, now = Date.now()) {
  const db = getDb();
  const t = db.prepare("SELECT contact_id, text, due_date, repeat FROM tasks WHERE id = ? AND status = 'open'").get(id) as
    | { contact_id: number | null; text: string; due_date: string | null; repeat: Repeat }
    | undefined;
  if (!t) return;
  db.prepare("UPDATE tasks SET status = 'done', done_at = datetime('now') WHERE id = ?").run(id);
  if (!t.repeat) return;
  const today = todayCo(now);
  let next = nextDue(t.due_date ?? today, t.repeat);
  while (next <= today) next = nextDue(next, t.repeat);
  db.prepare('INSERT INTO tasks (contact_id, text, due_date, repeat) VALUES (?, ?, ?, ?)').run(t.contact_id, t.text, next, t.repeat);
}

export function moveTask(id: number, dueDate: string | null) {
  if (dueDate && !isDate(dueDate)) throw new Error('Fecha inválida');
  getDb().prepare("UPDATE tasks SET due_date = ? WHERE id = ? AND status = 'open'").run(dueDate, id);
}

export function deleteTask(id: number) {
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
}
