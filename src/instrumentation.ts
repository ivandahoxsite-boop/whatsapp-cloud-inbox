// Runs once when the server starts: the CRM reads the cartera sheet and the AnaliX sales by itself at their times.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCarteraSchedule } = await import('./lib/crm/cartera-sheet');
    startCarteraSchedule();
    const { startAnalixSchedule } = await import('./lib/crm/analix');
    startAnalixSchedule();
    const { startDueNotices } = await import('./lib/crm/push');
    startDueNotices();
  }
}
