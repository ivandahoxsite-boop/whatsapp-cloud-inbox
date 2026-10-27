// Runs once when the server starts: the CRM reads the cartera sheet by itself at the load times.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCarteraSchedule } = await import('./lib/crm/cartera-sheet');
    startCarteraSchedule();
  }
}
