import { sql } from 'drizzle-orm';
import { getConfig } from '../config';
import { db } from '../db/client';
import { publishPost } from './publish';

/**
 * Fail posts stuck in 'publishing' > 15 min (crash/DB error mid-publish; retrying could double-post), then claim up
 * to 5 due posts (safe across concurrent workers) and publish them. Returns how many were claimed.
 * published_at doubles as the claim stamp while 'publishing'; publishPost overwrites it on completion.
 */
export async function tick(): Promise<number> {
  await db.execute(sql`
    WITH stuck AS (
      UPDATE posts SET status = 'failed', published_at = now()
      WHERE status = 'publishing' AND published_at < now() - interval '15 minutes'
      RETURNING id)
    UPDATE post_targets SET status = 'failed', error = 'interrupted while publishing'
    WHERE status = 'pending' AND post_id IN (SELECT id FROM stuck)`);
  const { rows } = await db.execute<{ id: string }>(sql`
    UPDATE posts SET status = 'publishing', published_at = now()
    WHERE id IN (SELECT id FROM posts WHERE status = 'scheduled' AND scheduled_at <= now()
                 ORDER BY scheduled_at LIMIT 5 FOR UPDATE SKIP LOCKED)
    RETURNING id`);
  for (const { id } of rows) await publishPost(id);
  return rows.length;
}

// ponytail: polling; swap for LISTEN/NOTIFY or a queue if latency matters.
/** Run `tick()` every WORKER_POLL_MS, skipping a beat while one is still running. Returns a stop function. */
export function start(): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (err) {
      console.error('worker tick failed', err);
    } finally {
      running = false;
    }
  }, getConfig().WORKER_POLL_MS);
  return () => clearInterval(timer);
}
