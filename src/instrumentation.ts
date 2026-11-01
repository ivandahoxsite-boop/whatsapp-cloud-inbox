// Runs once when the server starts: the CRM reads the cartera sheet by itself at its times, and sends the morning
// "Por vencer" warning (and the to-do reminders) to the phones that turned notices on.
// (Export of the cartera module: the original also started the AnaliX sales sync, which is not part of this module.)
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCarteraSchedule } = await import('./lib/crm/cartera-sheet');
    startCarteraSchedule();
    const { startDueNotices } = await import('./lib/crm/push');
    startDueNotices();
  }
}
