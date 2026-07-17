// Next.js instrumentation hook — runs once on server startup (edge or nodejs).
// Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('@/jobs/scheduler');
    startScheduler();
  }
}
