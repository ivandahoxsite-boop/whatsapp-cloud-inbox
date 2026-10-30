import { NextResponse } from 'next/server';
import { completeTask, createTask, deleteTask, listTasks, moveTask, setTaskNotify, updateTask } from '@/lib/crm/tasks';
import { todayCo } from '@/lib/crm/tasks-info';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status });

export async function GET(request: Request) {
  try {
    const id = Number(new URL(request.url).searchParams.get('contactId'));
    return NextResponse.json({ today: todayCo(), tasks: listTasks(Number.isInteger(id) && id > 0 ? id : undefined) });
  } catch (e) {
    return fail(e, 500);
  }
}

// POST { text, contactId?, dueDate?, repeat?, notify? } creates a to-do.
export async function POST(request: Request) {
  try {
    const b = (await request.json()) as { text: string; contactId?: number | null; dueDate?: string | null; dueTime?: string | null; repeat?: string; notify?: boolean };
    return NextResponse.json({ id: createTask(b) });
  } catch (e) {
    return fail(e);
  }
}

// PATCH { id, action: 'done' | 'move' | 'delete' | 'notify' | 'edit', dueDate?, on?, text?, dueTime?, repeat?, notify? }
export async function PATCH(request: Request) {
  try {
    const b = (await request.json()) as {
      id: number;
      action: string;
      dueDate?: string | null;
      dueTime?: string | null;
      on?: boolean;
      text?: string;
      repeat?: string;
      notify?: boolean;
    };
    const { id, action, dueDate, dueTime, on } = b;
    if (!Number.isInteger(id)) throw new Error('Falta el pendiente');
    if (action === 'done') completeTask(id);
    else if (action === 'move') moveTask(id, dueDate ?? null, dueTime ?? null);
    else if (action === 'delete') deleteTask(id);
    else if (action === 'notify') setTaskNotify(id, !!on);
    else if (action === 'edit') updateTask(id, { text: b.text ?? '', dueDate, dueTime, repeat: b.repeat, notify: b.notify });
    else throw new Error('Acción inválida');
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
