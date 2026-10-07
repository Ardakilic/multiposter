import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { form, jar, loginAs } from '../../../test/next';
import { db } from '@/lib/db/client';
import { connections, media, postItems, posts, postTargets } from '@/lib/db/schema';
import { storeUpload } from '@/lib/media/upload';
import { getObject } from '@/lib/storage';
import { createPost } from './actions';
import ComposePage from './page';

vi.mock('next/headers', async () => (await import('../../../test/next')).headers);
vi.mock('next/navigation', async () => (await import('../../../test/next')).navigation);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/media/upload', () => ({ storeUpload: vi.fn() }));

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const png = (name = 'a.png') => new File([PNG], name, { type: 'image/png' });

async function connection(userId: string, label = 'main', connector = 'mastodon', settings = {}) {
  const [row] = await db
    .insert(connections)
    .values({ userId, connector, label, accountName: `${label}@acct`, credentials: 'x', settings })
    .returning();
  return row;
}

let target: string;
beforeEach(async () => {
  vi.mocked(storeUpload).mockReset();
  const user = await loginAs();
  target = (await connection(user.id)).id;
});

describe('createPost', () => {
  it('requires a session', async () => {
    jar.clear();
    await expect(createPost(undefined, form([]))).rejects.toThrow('REDIRECT /login');
  });

  it('stores a scheduled flood with media and targets, then redirects', async () => {
    vi.mocked(storeUpload)
      .mockResolvedValueOnce({ key: 'media/1.png', mime: 'image/png', size: 10 })
      .mockResolvedValueOnce({ key: 'media/2.mp4', mime: 'video/mp4', size: 20 });
    const fd = form([
      ['items[0].text', ' first '],
      ['items[0].files', png()],
      ['items[0].files', new File([PNG], 'b.mp4', { type: 'video/mp4' })],
      ['items[0].alt[0]', ' a cat '],
      ['items[0].alt[1]', ''],
      ['items[1].text', 'second'],
      ['items[1].files', new File([], '')], // empty file input
      ['targets', target],
      ['targets', target],
      ['autoThread', 'on'],
      ['scheduledAt', '2030-01-02T03:04:00.000Z'],
    ]);
    await expect(createPost(undefined, fd)).rejects.toThrow('REDIRECT /posts');

    const [post] = await db.select().from(posts);
    expect(post).toMatchObject({ status: 'scheduled', autoThread: true, scheduledAt: new Date('2030-01-02T03:04:00Z') });
    const items = await db.select().from(postItems).orderBy(postItems.position);
    expect(items.map((i) => [i.position, i.text])).toEqual([[0, 'first'], [1, 'second']]);
    const m = await db.select().from(media).orderBy(media.position);
    expect(m).toMatchObject([
      { postItemId: items[0].id, position: 0, storageKey: 'media/1.png', mime: 'image/png', size: 10, alt: 'a cat' },
      { postItemId: items[0].id, position: 1, storageKey: 'media/2.mp4', alt: null },
    ]);
    expect(await db.select().from(postTargets)).toMatchObject([{ postId: post.id, connectionId: target, status: 'pending' }]);
  });

  it('posts now when no schedule is given; media-only items are fine (real upload)', async () => {
    const real = await vi.importActual<typeof import('@/lib/media/upload')>('@/lib/media/upload');
    vi.mocked(storeUpload).mockImplementation(real.storeUpload);
    const before = Date.now();
    const fd = form([['items[0].text', ''], ['items[0].files', png()], ['targets', target], ['scheduledAt', '']]);
    await expect(createPost(undefined, fd)).rejects.toThrow('REDIRECT /posts');
    const [post] = await db.select().from(posts);
    expect(post.autoThread).toBe(false);
    expect(post.scheduledAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const [m] = await db.select().from(media);
    expect((await getObject(m.storageKey)).equals(PNG)).toBe(true);
  });

  it.each([
    ['no items', [['targets', 'T']], 'Add at least one post.'],
    ['empty item', [['items[0].text', '  '], ['targets', 'T']], 'Each post needs text or media.'],
    ['no targets', [['items[0].text', 'hi']], 'Pick at least one connection.'],
    ['bad target id', [['items[0].text', 'hi'], ['targets', 'nope']], 'Unknown connection.'],
    ['bad schedule', [['items[0].text', 'hi'], ['targets', 'T'], ['scheduledAt', 'tomorrow']], 'Invalid schedule time.'],
  ] as [string, [string, string][], string][])('rejects %s', async (_, entries, error) => {
    const fd = form(entries.map(([k, v]) => [k, v === 'T' ? target : v]));
    expect(await createPost(undefined, fd)).toEqual({ error });
    expect(await db.select().from(posts)).toHaveLength(0);
  });

  it('rejects connections owned by someone else', async () => {
    const other = await loginAs('other@example.com');
    const theirs = (await connection(other.id)).id;
    await loginAs('third@example.com');
    expect(await createPost(undefined, form([['items[0].text', 'hi'], ['targets', theirs]]))).toEqual({ error: 'Unknown connection.' });
  });

  it('collects every upload error and stores nothing', async () => {
    vi.mocked(storeUpload).mockRejectedValueOnce(new Error('a.pdf: unsupported file type')).mockRejectedValueOnce('odd');
    const fd = form([['items[0].text', 'x'], ['items[0].files', png('a.pdf')], ['items[1].text', 'y'], ['items[1].files', png()], ['targets', target]]);
    expect(await createPost(undefined, fd)).toEqual({ error: 'a.pdf: unsupported file type\nodd' });
    expect(await db.select().from(posts)).toHaveLength(0);
  });
});

describe('ComposePage', () => {
  it('requires a session', async () => {
    jar.clear();
    await expect(ComposePage()).rejects.toThrow('REDIRECT /login');
  });

  it('asks for a connection first when there are none', async () => {
    await db.delete(connections);
    expect(renderToStaticMarkup(await ComposePage())).toContain('href="/connections"');
  });

  it('lists the user’s connections with their limits, skipping unknown connectors', async () => {
    const [me] = await db.select().from(connections);
    await connection(me.userId, 'big', 'mastodon', { maxChars: 1000 });
    await connection(me.userId, 'legacy', 'gone');
    const html = renderToStaticMarkup(await ComposePage());
    expect(html).toContain('main@acct, max 500');
    expect(html).toContain('big@acct, max 1000');
    expect(html).not.toContain('legacy');
  });
});
