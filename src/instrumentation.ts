/**
 * Next.js startup hook: migrates the DB, ensures the bucket and starts the publish worker.
 * Node runtime only; imports are dynamic so the edge bundle never pulls in pg/S3.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { migrate } = await import('./lib/db/client');
  const { ensureBucket } = await import('./lib/storage');
  const { getConfig } = await import('./lib/config');
  await migrate();
  await ensureBucket();
  if (getConfig().WORKER_ENABLED) (await import('./lib/publish/worker')).start();
}
