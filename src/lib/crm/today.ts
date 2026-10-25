import { callsOn, paymentPromises } from './digest';
import { pendingChats, type PendingReason } from './pending';
import { receivablesSummary } from './receivables';
import { listTasks } from './tasks';
import { dayProblem, todayCo } from './tasks-info';

/** "What do I have to do today", for the top of the Resumen tab: the same things the morning brief lists. */
export function todayBoard(now = Date.now()) {
  const today = todayCo(now);
  const tasks = listTasks().filter((t) => t.dueDate && t.dueDate <= today);
  const chats: Record<PendingReason, number> = { sin_respuesta: 0, en_el_aire: 0, cotizacion: 0 };
  for (const c of pendingChats(new Date(now))) chats[c.reason]++;
  const owed = receivablesSummary({}, new Date(now));
  const { dueToday, broken } = paymentPromises(today, new Set(owed.debtors.map((d) => d.contactId)));
  return {
    today,
    /** Sunday or a Colombian holiday: shown as a note, nothing is blocked here. */
    restDay: dayProblem(today) ? true : false,
    tasks,
    chats,
    promisesToday: dueToday,
    promisesBroken: broken,
    calls: callsOn(today)
  };
}

export type TodayBoard = ReturnType<typeof todayBoard>;
