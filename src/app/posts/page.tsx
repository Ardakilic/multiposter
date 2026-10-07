/** Post history with per-target status and links. Times are shown in UTC. */

import { count, desc, eq, inArray } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/session';
import { connectors } from '@/lib/connectors';
import { db } from '@/lib/db/client';
import { connections, media, postItems, posts, postTargets } from '@/lib/db/schema';
import { cancelPost } from './actions';

const fmt = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const truncate = (s: string, n = 280) => (s.length > n ? s.slice(0, n) + '…' : s);

const BADGE: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800',
  publishing: 'bg-yellow-100 text-yellow-800',
  published: 'bg-green-100 text-green-800',
  partial: 'bg-orange-100 text-orange-800',
  failed: 'bg-red-100 text-red-800',
  pending: 'bg-neutral-200 text-neutral-800',
  cancelled: 'bg-neutral-200 text-neutral-800',
};
const Badge = ({ status }: { status: string }) => <span className={`rounded px-1.5 py-0.5 text-xs ${BADGE[status]}`}>{status}</span>;

export default async function PostsPage() {
  const user = await requireUser();
  // ponytail: one page, no pagination; add pagination when lists get long.
  const rows = await db.select().from(posts).where(eq(posts.userId, user.id)).orderBy(desc(posts.createdAt));
  const ids = rows.map((p) => p.id);
  const items = await db
    .select({ id: postItems.id, postId: postItems.postId, text: postItems.text, mediaCount: count(media.id) })
    .from(postItems)
    .leftJoin(media, eq(media.postItemId, postItems.id))
    .where(inArray(postItems.postId, ids))
    .groupBy(postItems.id)
    .orderBy(postItems.position);
  const targets = await db
    .select({
      id: postTargets.id,
      postId: postTargets.postId,
      status: postTargets.status,
      result: postTargets.result,
      error: postTargets.error,
      label: connections.label,
      connector: connections.connector,
    })
    .from(postTargets)
    .innerJoin(connections, eq(connections.id, postTargets.connectionId))
    .where(inArray(postTargets.postId, ids));

  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">Posts</h1>
      {rows.length === 0 && <p>Nothing posted yet.</p>}
      <ul className="flex flex-col gap-4">
        {rows.map((p) => (
          <li key={p.id} className="rounded border border-neutral-300 p-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge status={p.status} />
              <span>Scheduled {fmt(p.scheduledAt)}</span>
              {p.publishedAt && p.status !== 'publishing' && <span>Published {fmt(p.publishedAt)}</span>}
              {p.status === 'scheduled' && (
                <form action={cancelPost} className="ml-auto">
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" className="text-red-600 underline">
                    Cancel
                  </button>
                </form>
              )}
            </div>
            <ol className="my-2 flex flex-col gap-1">
              {items
                .filter((i) => i.postId === p.id)
                .map((i) => (
                  <li key={i.id} className="whitespace-pre-wrap">
                    {truncate(i.text)}
                    {i.mediaCount > 0 && <span className="text-sm text-neutral-500"> [{i.mediaCount} media]</span>}
                  </li>
                ))}
            </ol>
            <ul className="text-sm">
              {targets
                .filter((t) => t.postId === p.id)
                .map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {connectors[t.connector]?.name ?? t.connector} · {t.label}
                    </span>
                    <Badge status={t.status} />
                    {t.result.map((r, n) =>
                      r.url ? (
                        <a key={n} href={r.url} target="_blank" rel="noreferrer" className="underline">
                          link
                        </a>
                      ) : null,
                    )}
                    {t.error && <span className="text-red-600">{t.error}</span>}
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
