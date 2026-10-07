import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectors } from '../connectors';
import type { Connector } from '../connectors/types';
import { encrypt } from '../crypto';
import { db } from '../db/client';
import { connections, media, postItems, posts, postTargets, users } from '../db/schema';
import { publishPost } from './publish';

let seq = 0;
function fake(over: Partial<Connector> = {}, caps: Partial<Connector['capabilities']> = {}) {
  return {
    id: 'fake',
    name: 'Fake',
    fields: [],
    capabilities: { images: true, video: true, threads: true, textOnly: true, maxMedia: 4, ...caps },
    maxLength: (s: Record<string, unknown>) => (s.max as number) ?? 100,
    countLength: (t: string) => [...t].length,
    verify: vi.fn(),
    post: vi.fn(async () => {
      const id = `p${++seq}`;
      return { id, url: `https://fake/${id}`, ref: { id } };
    }),
    ...over,
  } satisfies Connector;
}

let userId: string;
beforeEach(async () => {
  seq = 0;
  connectors.fake = fake();
  [{ id: userId }] = await db.insert(users).values({ email: 'u@example.com', passwordHash: 'x' }).returning();
});
afterEach(() => {
  delete connectors.fake;
});

async function connect(label: string, opts: { connector?: string; settings?: Record<string, unknown>; credentials?: string } = {}) {
  const [c] = await db
    .insert(connections)
    .values({
      userId,
      label,
      connector: opts.connector ?? 'fake',
      accountName: label,
      credentials: opts.credentials ?? encrypt({ token: label }),
      settings: opts.settings ?? {},
    })
    .returning();
  return c.id;
}

async function makePost(
  items: { text: string; media?: { mime: string }[] }[],
  connectionIds: string[],
  autoThread = false,
) {
  const [p] = await db.insert(posts).values({ userId, autoThread, scheduledAt: new Date(), status: 'publishing' }).returning();
  for (const [position, it] of items.entries()) {
    const [row] = await db.insert(postItems).values({ postId: p.id, position, text: it.text }).returning();
    for (const [i, m] of (it.media ?? []).entries())
      await db.insert(media).values({ postItemId: row.id, position: i, storageKey: `media/${position}-${i}`, mime: m.mime, size: 1, alt: i ? null : 'alt' });
  }
  for (const connectionId of connectionIds) await db.insert(postTargets).values({ postId: p.id, connectionId });
  return p.id;
}

async function state(postId: string) {
  const [p] = await db.select().from(posts).where(eq(posts.id, postId));
  const targets = await db.select().from(postTargets).where(eq(postTargets.postId, postId));
  return { post: p, targets };
}

const calls = () => vi.mocked(connectors.fake.post).mock.calls.map(([c]) => c);

describe('publishPost', () => {
  it('publishes a single post to one target', async () => {
    const id = await makePost([{ text: 'hello', media: [{ mime: 'image/png' }] }], [await connect('a')]);
    await publishPost(id);
    const { post, targets } = await state(id);
    expect(post.status).toBe('published');
    expect(post.publishedAt).toBeInstanceOf(Date);
    expect(targets[0]).toMatchObject({ status: 'published', error: null, result: [{ id: 'p1', url: 'https://fake/p1' }] });
    const [c] = calls();
    expect(c).toMatchObject({ creds: { token: 'a' }, settings: {}, text: 'hello', root: undefined, parent: undefined });
    expect(c.media).toHaveLength(1);
    expect(c.media[0]).toMatchObject({ key: 'media/0-0', mime: 'image/png', size: 1, alt: 'alt' });
  });

  it('chains a flood with root/parent refs', async () => {
    const id = await makePost([{ text: 'one' }, { text: 'two' }, { text: 'three' }], [await connect('a')]);
    await publishPost(id);
    expect(calls().map((c) => [c.text, c.root, c.parent])).toEqual([
      ['one', undefined, undefined],
      ['two', { id: 'p1' }, { id: 'p1' }],
      ['three', { id: 'p1' }, { id: 'p2' }],
    ]);
    expect((await state(id)).targets[0].result.map((r) => r.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('auto-threads long text with media only on the first chunk', async () => {
    const conn = await connect('a', { settings: { max: 10 } });
    const id = await makePost([{ text: 'aaaa bbbb cccc dddd', media: [{ mime: 'image/png' }, { mime: 'image/jpeg' }] }], [conn], true);
    await publishPost(id);
    expect(calls().map((c) => [c.text, c.media.length])).toEqual([
      ['aaaa bbbb', 2],
      ['cccc dddd', 0],
    ]);
    expect(calls()[1]).toMatchObject({ root: { id: 'p1' }, parent: { id: 'p1' }, settings: { max: 10 } });
    expect((await state(id)).post.status).toBe('published');
  });

  it('fails a too-long target without auto_thread', async () => {
    const id = await makePost([{ text: 'x'.repeat(12) }], [await connect('a', { settings: { max: 10 } })]);
    await publishPost(id);
    const { post, targets } = await state(id);
    expect(post.status).toBe('failed');
    expect(targets[0]).toMatchObject({ status: 'failed', error: 'too long for Fake (12/10)', result: [] });
    expect(calls()).toHaveLength(0);
  });

  it('fails when auto_thread is on but the connector cannot thread', async () => {
    connectors.fake = fake({}, { threads: false });
    const id = await makePost([{ text: 'x'.repeat(12) }], [await connect('a', { settings: { max: 10 } })], true);
    await publishPost(id);
    expect((await state(id)).targets[0].error).toBe('too long for Fake (12/10)');
  });

  it('fails whitespace-only text that splits to nothing', async () => {
    const id = await makePost([{ text: ' '.repeat(12) }], [await connect('a', { settings: { max: 10 } })], true);
    await publishPost(id);
    expect((await state(id)).targets[0].error).toBe('too long for Fake (12/10)');
  });

  it('fails when splitText throws', async () => {
    const id = await makePost([{ text: 'x'.repeat(12) }], [await connect('a', { settings: { max: 0.5 } })], true);
    await publishPost(id);
    expect((await state(id)).targets[0].error).toBe('invalid max: 0.5');
  });

  it('marks partial when one of two targets fails, keeping posted chunks', async () => {
    const bad = fake({
      name: 'Bad',
      post: vi.fn().mockResolvedValueOnce({ id: 'b1', ref: { id: 'b1' } }).mockRejectedValueOnce('boom'),
    });
    connectors.bad = bad;
    try {
      const id = await makePost([{ text: 'one' }, { text: 'two' }], [await connect('a'), await connect('b', { connector: 'bad' })]);
      await publishPost(id);
      const { post, targets } = await state(id);
      expect(post.status).toBe('partial');
      const byStatus = Object.fromEntries(targets.map((t) => [t.status, t]));
      expect(byStatus.published.result).toHaveLength(2);
      expect(byStatus.failed).toMatchObject({ error: 'boom', result: [{ id: 'b1' }] });
    } finally {
      delete connectors.bad;
    }
  });

  it.each([
    [{ textOnly: false }, [{ text: 'no media' }], 'Fake requires media on every post'],
    [{ video: false }, [{ text: 'v', media: [{ mime: 'video/mp4' }] }], 'Fake does not support video'],
    [{ maxMedia: 1 }, [{ text: 'm', media: [{ mime: 'image/png' }, { mime: 'image/png' }] }], 'too many media for Fake (2/1)'],
    [{ threads: false }, [{ text: 'a' }, { text: 'b' }], 'Fake does not support threads'],
  ])('fails capability check %o', async (caps, items, error) => {
    connectors.fake = fake({}, caps);
    const id = await makePost(items, [await connect('a')]);
    await publishPost(id);
    const { post, targets } = await state(id);
    expect(post.status).toBe('failed');
    expect(targets[0]).toMatchObject({ status: 'failed', error });
    expect(calls()).toHaveLength(0);
  });

  it('fails targets with an unknown connector or undecryptable credentials', async () => {
    const id = await makePost([{ text: 'hi' }], [await connect('a', { connector: 'gone' }), await connect('b', { credentials: 'garbage' })]);
    await publishPost(id);
    const { post, targets } = await state(id);
    expect(post.status).toBe('failed');
    expect(targets.map((t) => t.error).sort()).toEqual(['invalid ciphertext', 'unknown connector: gone']);
  });

  it('marks a post without targets failed and ignores unknown post ids', async () => {
    const id = await makePost([], []);
    await publishPost(id);
    expect((await state(id)).post.status).toBe('failed');
    await expect(publishPost('00000000-0000-0000-0000-000000000000')).resolves.toBeUndefined();
  });

  it('never throws, even on DB errors', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(publishPost('not-a-uuid')).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith('publishPost not-a-uuid failed', expect.anything());
    err.mockRestore();
  });
});
