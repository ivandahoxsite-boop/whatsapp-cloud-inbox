import { getDb } from './db';
import { dayProblem, isDate, isTime, nextDue, todayCo, workdayOnOrAfter, type Repeat, type Task } from './tasks-info';

export { type Task } from './tasks-info';

const REPEATS: Repeat[] = ['', 'semanal', 'quincenal', 'mensual'];

/** Valid date, and Monday-Saturday and not a Colombian holiday: nothing is scheduled (or notified) on those days. */
function checkDay(date: string) {
  if (!isDate(date)) throw new Error('Fecha inválida');
  const problem = dayProblem(date);
  if (problem) throw new Error(problem);
}

type Row = { id: number; contact_id: number | null; text: string; due_date: string | null; due_time: string | null; repeat: Repeat; notify: number; name: string | null; phone: string | null };

/** Open to-dos, soonest first (no date last). Optionally only one customer's. */
export function listTasks(contactId?: number): Task[] {
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.contact_id, t.text, t.due_date, t.due_time, t.repeat, t.notify, c.name, c.phone
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
    dueTime: r.due_time,
    repeat: r.repeat,
    notify: !!r.notify
  }));
}

export function createTask(input: { contactId?: number | null; text: string; dueDate?: string | null; dueTime?: string | null; repeat?: string; notify?: boolean }): number {
  const text = (input.text ?? '').trim();
  if (!text) throw new Error('Escribe qué hay que hacer');
  if (text.length > 300) throw new Error('Máximo 300 letras');
  const dueDate = input.dueDate || null;
  if (dueDate) checkDay(dueDate);
  const dueTime = input.dueTime || null;
  if (dueTime && !isTime(dueTime)) throw new Error('Hora inválida');
  if (dueTime && !dueDate) throw new Error('La hora necesita una fecha');
  const repeat = (input.repeat ?? '') as Repeat;
  if (!REPEATS.includes(repeat)) throw new Error('Repetición inválida');
  const db = getDb();
  if (input.contactId != null && !db.prepare('SELECT 1 FROM contacts WHERE id = ?').get(input.contactId)) throw new Error('El cliente no existe');
  if (input.notify && !dueDate) throw new Error('Para avisarte, ponle un día');
  const r = db
    .prepare('INSERT INTO tasks (contact_id, text, due_date, due_time, repeat, notify) VALUES (?, ?, ?, ?, ?, ?)')
    .run(input.contactId ?? null, text, dueDate, dueTime, repeat, input.notify ? 1 : 0);
  return Number(r.lastInsertRowid);
}

/** Marks a to-do done. A repeating one leaves the next occurrence open (always in the future). */
export function completeTask(id: number, now = Date.now()) {
  const db = getDb();
  const t = db.prepare("SELECT contact_id, text, due_date, due_time, repeat, notify FROM tasks WHERE id = ? AND status = 'open'").get(id) as
    | { contact_id: number | null; text: string; due_date: string | null; due_time: string | null; repeat: Repeat; notify: number }
    | undefined;
  if (!t) return;
  db.prepare("UPDATE tasks SET status = 'done', done_at = datetime('now') WHERE id = ?").run(id);
  if (!t.repeat) return;
  const today = todayCo(now);
  // The next occurrence is always in the future and never on a Sunday or holiday (it moves to the next working day).
  let next = nextDue(t.due_date ?? today, t.repeat);
  while (next <= today) next = nextDue(next, t.repeat);
  // The next occurrence keeps the phone reminder, so a repeating to-do notifies again on its next day.
  db.prepare('INSERT INTO tasks (contact_id, text, due_date, due_time, repeat, notify) VALUES (?, ?, ?, ?, ?, ?)').run(
    t.contact_id,
    t.text,
    workdayOnOrAfter(next),
    t.due_time,
    t.repeat,
    t.notify
  );
}

/** Turns the phone reminder of one to-do on or off. */
export function setTaskNotify(id: number, on: boolean) {
  const db = getDb();
  const t = db.prepare("SELECT due_date FROM tasks WHERE id = ? AND status = 'open'").get(id) as { due_date: string | null } | undefined;
  if (!t) throw new Error('El pendiente ya no está abierto');
  if (on && !t.due_date) throw new Error('Para avisarte, ponle un día (📅 Mover)');
  db.prepare('UPDATE tasks SET notify = ? WHERE id = ?').run(on ? 1 : 0, id);
}

export function moveTask(id: number, dueDate: string | null, dueTime?: string | null) {
  if (dueDate) checkDay(dueDate);
  if (dueTime && !isTime(dueTime)) throw new Error('Hora inválida');
  // Moving to another day keeps the time unless a new one is given; "no date" clears both.
  getDb()
    .prepare("UPDATE tasks SET due_date = ?, due_time = CASE WHEN ? IS NULL THEN NULL WHEN ? IS NOT NULL THEN ? ELSE due_time END WHERE id = ? AND status = 'open'")
    .run(dueDate, dueDate, dueTime ?? null, dueTime ?? null, id);
}

export function deleteTask(id: number) {
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
}
