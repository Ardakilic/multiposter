import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { form, jar, loginAs } from '../../../test/next';
import { db } from '@/lib/db/client';
import { connections, media, postItems, posts, postTargets } from '@/lib/db/schema';
import { cancelPost } from './actions';
import PostsPage from './page';

vi.mock('next/headers', async () => (await import('../../../test/next')).headers);
vi.mock('next/navigation', async () => (await import('../../../test/next')).navigation);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

async function makePost(userId: string, status: 'scheduled' | 'publishing' | 'published' = 'scheduled', createdAt = new Date()) {
  const [post] = await db
    .insert(posts)
    .values({ userId, status, scheduledAt: new Date('2030-01-02T03:04:00Z'), createdAt })
    .returning();
  return post;
}

let me: { id: string };
beforeEach(async () => {
  me = await loginAs();
});

describe('cancelPost', () => {
  it('requires a session', async () => {
    jar.clear();
    await expect(cancelPost(form([]))).rejects.toThrow('REDIRECT /login');
  });

  it('cancels only the user’s scheduled posts', async () => {
    const scheduled = await makePost(me.id);
    const published = await makePost(me.id, 'published');
    const other = await loginAs('other@example.com');
    const theirs = await makePost(other.id);
    jar.clear();
    const { createSession } = await import('@/lib/auth/session');
    await createSession(me.id); // back to the original user

    for (const id of [scheduled.id, published.id, theirs.id, 'not-a-uuid']) await cancelPost(form([['id', id]]));
    const status = Object.fromEntries((await db.select().from(posts)).map((p) => [p.id, p.status]));
    expect(status).toEqual({ [scheduled.id]: 'cancelled', [published.id]: 'published', [theirs.id]: 'scheduled' });
  });
});

describe('PostsPage', () => {
  it('requires a session', async () => {
    jar.clear();
    await expect(PostsPage()).rejects.toThrow('REDIRECT /login');
  });

  it('shows an empty state', async () => {
    expect(renderToStaticMarkup(await PostsPage())).toContain('Nothing posted yet.');
  });

  it('renders posts newest first with items, media, targets, links and errors', async () => {
    const [conn] = await db
      .insert(connections)
      .values({ userId: me.id, connector: 'mastodon', label: 'fedi', accountName: 'a', credentials: 'x' })
      .returning();
    const [legacy] = await db
      .insert(connections)
      .values({ userId: me.id, connector: 'gone', label: 'old', accountName: 'a', credentials: 'x' })
      .returning();
    const old = await makePost(me.id, 'published', new Date('2020-01-01'));
    await db.update(posts).set({ publishedAt: new Date('2030-01-02T03:05:00Z') });
    const fresh = await makePost(me.id);
    const claimed = await makePost(me.id, 'publishing', new Date('2019-01-01'));
    await db.update(posts).set({ publishedAt: new Date('2030-01-02T03:06:00Z') }).where(eq(posts.id, claimed.id));
    const [item] = await db.insert(postItems).values({ postId: old.id, position: 0, text: 'x'.repeat(300) }).returning();
    await db.insert(postItems).values({ postId: old.id, position: 1, text: 'reply' });
    await db.insert(postItems).values({ postId: fresh.id, position: 0, text: 'fresh text' });
    await db.insert(media).values([
      { postItemId: item.id, position: 0, storageKey: 'k1', mime: 'image/png', size: 1 },
      { postItemId: item.id, position: 1, storageKey: 'k2', mime: 'image/png', size: 1 },
    ]);
    await db.insert(postTargets).values([
      { postId: old.id, connectionId: conn.id, status: 'published', result: [{ id: '1', url: 'https://m.example/1' }, { id: '2' }] },
      { postId: old.id, connectionId: legacy.id, status: 'failed', error: 'too long for X (300/280)' },
    ]);
    const other = await loginAs('other@example.com');
    const secret = await makePost(other.id);
    await db.insert(postItems).values({ postId: secret.id, position: 0, text: 'secret' });
    jar.clear();
    const { createSession } = await import('@/lib/auth/session');
    await createSession(me.id);

    const html = renderToStaticMarkup(await PostsPage());
    expect(html.indexOf('fresh text')).toBeLessThan(html.indexOf('reply'));
    expect(html).toContain('x'.repeat(280) + '…');
    expect(html).not.toContain('x'.repeat(281));
    expect(html).toContain('[2 media]');
    expect(html).toContain('Scheduled 2030-01-02 03:04 UTC');
    expect(html).toContain('Published 2030-01-02 03:05 UTC');
    expect(html).not.toContain('Published 2030-01-02 03:06 UTC'); // still publishing
    expect(html).toContain('href="https://m.example/1"');
    expect(html).toContain('Mastodon · fedi');
    expect(html).toContain('gone · old');
    expect(html).toContain('too long for X (300/280)');
    expect(html.match(/>Cancel</g)).toHaveLength(1);
    expect(html).not.toContain('secret');
  });
});
