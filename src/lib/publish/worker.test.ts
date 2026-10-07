import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/client';
import { connections, postTargets, posts, users } from '../db/schema';
import { publishPost } from './publish';
import { start, tick } from './worker';

vi.mock('./publish', () => ({ publishPost: vi.fn(async () => {}) }));

let userId: string;
beforeEach(async () => {
  vi.mocked(publishPost).mockClear();
  [{ id: userId }] = await db.insert(users).values({ email: 'u@example.com', passwordHash: 'x' }).returning();
});

const ago = (s: number) => new Date(Date.now() - s * 1000);
async function makePosts(n: number, values: Partial<typeof posts.$inferInsert> = {}) {
  const rows = Array.from({ length: n }, () => ({ userId, scheduledAt: ago(60), ...values }));
  return (await db.insert(posts).values(rows).returning()).map((p) => p.id);
}
const statusOf = async (id: string) => (await db.select().from(posts).where(eq(posts.id, id)))[0].status;

describe('tick', () => {
  it('claims only due scheduled posts', async () => {
    const [due] = await makePosts(1);
    const [future] = await makePosts(1, { scheduledAt: ago(-3600) });
    const [cancelled] = await makePosts(1, { status: 'cancelled' });
    expect(await tick()).toBe(1);
    expect(publishPost).toHaveBeenCalledExactlyOnceWith(due);
    expect(await statusOf(due)).toBe('publishing');
    expect(await statusOf(future)).toBe('scheduled');
    expect(await statusOf(cancelled)).toBe('cancelled');
    expect(await tick()).toBe(0);
  });

  it('claims at most 5, and concurrent ticks claim disjoint sets', async () => {
    const ids = await makePosts(8);
    const [a, b] = await Promise.all([tick(), tick()]);
    expect(a + b).toBe(8);
    expect(Math.max(a, b)).toBe(5);
    const published = vi.mocked(publishPost).mock.calls.map(([id]) => id);
    expect(published.sort()).toEqual([...ids].sort());
    expect(await tick()).toBe(0);
  });

  it('fails posts stuck in publishing > 15 min and their pending targets; leaves fresh ones alone', async () => {
    const [stuck] = await makePosts(1, { status: 'publishing', publishedAt: ago(16 * 60) });
    const [fresh] = await makePosts(1, { status: 'publishing', publishedAt: ago(60) });
    const [conn] = await db
      .insert(connections)
      .values({ userId, connector: 'x', label: 'x', accountName: '@x', credentials: 'x' })
      .returning();
    await db.insert(postTargets).values([
      { postId: stuck, connectionId: conn.id },
      { postId: stuck, connectionId: conn.id, status: 'published' },
      { postId: fresh, connectionId: conn.id },
    ]);

    expect(await tick()).toBe(0);
    const [post] = await db.select().from(posts).where(eq(posts.id, stuck));
    expect(post.status).toBe('failed');
    expect(Date.now() - post.publishedAt!.getTime()).toBeLessThan(60_000);
    expect(await statusOf(fresh)).toBe('publishing');
    const targets = await db.select().from(postTargets);
    const of = (id: string) => targets.filter((t) => t.postId === id).map((t) => [t.status, t.error]);
    expect(of(stuck)).toEqual(
      expect.arrayContaining([['failed', 'interrupted while publishing'], ['published', null]]),
    );
    expect(of(fresh)).toEqual([['pending', null]]);
  });
});

describe('start', () => {
  afterEach(() => vi.useRealTimers());

  it('ticks every WORKER_POLL_MS, never overlaps, survives errors, and stops', async () => {
    process.env.WORKER_POLL_MS = '1000';
    vi.useFakeTimers();
    let release!: () => void;
    vi.mocked(publishPost).mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    await makePosts(1);
    const stop = start();

    await vi.advanceTimersByTimeAsync(1000); // tick 1 claims the post and hangs in publishPost
    await vi.waitFor(() => expect(publishPost).toHaveBeenCalledTimes(1));
    await makePosts(1);
    await vi.advanceTimersByTimeAsync(3000); // skipped: tick 1 still running
    expect(publishPost).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      expect(publishPost).toHaveBeenCalledTimes(2);
    });

    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(publishPost).mockRejectedValueOnce(new Error('db down'));
    await makePosts(1);
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      expect(err).toHaveBeenCalledWith('worker tick failed', expect.any(Error));
    });
    err.mockRestore();

    stop();
    await makePosts(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(publishPost).toHaveBeenCalledTimes(3);
    delete process.env.WORKER_POLL_MS;
  });
});
