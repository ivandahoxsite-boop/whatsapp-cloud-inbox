import { NextResponse } from 'next/server';
import { completeTask, createTask, deleteTask, listTasks, moveTask } from '@/lib/crm/tasks';
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

// POST { text, contactId?, dueDate?, repeat? } creates a to-do.
export async function POST(request: Request) {
  try {
    const b = (await request.json()) as { text: string; contactId?: number | null; dueDate?: string | null; dueTime?: string | null; repeat?: string };
    return NextResponse.json({ id: createTask(b) });
  } catch (e) {
    return fail(e);
  }
}

// PATCH { id, action: 'done' | 'move' | 'delete', dueDate? }
export async function PATCH(request: Request) {
  try {
    const { id, action, dueDate, dueTime } = (await request.json()) as { id: number; action: string; dueDate?: string | null; dueTime?: string | null };
    if (!Number.isInteger(id)) throw new Error('Falta el pendiente');
    if (action === 'done') completeTask(id);
    else if (action === 'move') moveTask(id, dueDate ?? null, dueTime ?? null);
    else if (action === 'delete') deleteTask(id);
    else throw new Error('Acción inválida');
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
