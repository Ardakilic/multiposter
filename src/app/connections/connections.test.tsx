import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { form, jar, loginAs } from '../../../test/next';
import { connectors } from '@/lib/connectors';
import { decrypt } from '@/lib/crypto';
import { db } from '@/lib/db/client';
import { connections } from '@/lib/db/schema';
import { addConnection, deleteConnection } from './actions';
import ConnectionsPage from './page';

vi.mock('next/headers', async () => (await import('../../../test/next')).headers);
vi.mock('next/navigation', async () => (await import('../../../test/next')).navigation);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

const mastodon = (label = 'main', token = 'tok') =>
  form([
    ['connector', 'mastodon'],
    ['label', label],
    ['field.host', ' https://m.example '],
    ['field.accessToken', token],
  ]);

const verifyOk = () =>
  vi.spyOn(connectors.mastodon, 'verify').mockResolvedValue({ accountName: 'me@m.example', settings: { maxChars: 1000 } });

async function insertConnection(userId: string, label = 'other', connector = 'mastodon') {
  const [row] = await db
    .insert(connections)
    .values({ userId, connector, label, accountName: 'acct', credentials: 'x' })
    .returning();
  return row;
}

describe('addConnection', () => {
  it('requires a session', async () => {
    jar.clear();
    await expect(addConnection(undefined, mastodon())).rejects.toThrow('REDIRECT /login');
  });

  it('verifies, encrypts and stores the connection', async () => {
    const user = await loginAs();
    const verify = verifyOk();
    const res = await addConnection(undefined, mastodon());
    expect(res?.saved).toBeTypeOf('number');
    expect(verify).toHaveBeenCalledWith({ host: 'https://m.example', accessToken: 'tok' });
    const [row] = await db.select().from(connections);
    expect(row).toMatchObject({ userId: user.id, connector: 'mastodon', label: 'main', accountName: 'me@m.example', settings: { maxChars: 1000 } });
    expect(decrypt(row.credentials)).toEqual({ host: 'https://m.example', accessToken: 'tok' });
  });

  it('omits empty optional fields', async () => {
    await loginAs();
    const verify = vi.spyOn(connectors.bluesky, 'verify').mockResolvedValue({ accountName: 'me.bsky.social', settings: {} });
    const fd = form([['connector', 'bluesky'], ['label', 'b'], ['field.identifier', 'me'], ['field.appPassword', 'pw'], ['field.service', '']]);
    const noService = form([['connector', 'bluesky'], ['label', 'c'], ['field.identifier', 'me'], ['field.appPassword', 'pw']]);
    expect(await addConnection(undefined, noService)).toHaveProperty('saved');
    expect(await addConnection(undefined, fd)).toHaveProperty('saved');
    expect(verify).toHaveBeenCalledWith({ identifier: 'me', appPassword: 'pw' });
  });

  it('validates connector, label and required fields', async () => {
    await loginAs();
    expect(await addConnection(undefined, form([['connector', 'toString']]))).toEqual({ error: 'Pick a connector.' });
    expect(await addConnection(undefined, new FormData())).toEqual({ error: 'Pick a connector.' });
    expect(await addConnection(undefined, form([['connector', 'x']]))).toEqual({ error: 'Label is required (max 100 characters).' });
    expect(await addConnection(undefined, mastodon('  '))).toEqual({ error: 'Label is required (max 100 characters).' });
    expect(await addConnection(undefined, mastodon('x'.repeat(101)))).toHaveProperty('error');
    expect(await addConnection(undefined, mastodon('main', ''))).toEqual({ error: 'Access token is required.' });
  });

  it('shows verify errors verbatim', async () => {
    await loginAs();
    vi.spyOn(connectors.mastodon, 'verify').mockRejectedValueOnce(new Error('Mastodon GET /x failed: 401')).mockRejectedValueOnce('weird');
    expect(await addConnection(undefined, mastodon())).toEqual({ error: 'Mastodon GET /x failed: 401' });
    expect(await addConnection(undefined, mastodon())).toEqual({ error: 'weird' });
    expect(await db.select().from(connections)).toHaveLength(0);
  });

  it('rejects a duplicate label for the same user only', async () => {
    const other = await loginAs('other@example.com');
    await insertConnection(other.id, 'main');
    const me = await loginAs();
    await insertConnection(me.id, 'dup');
    verifyOk();
    expect(await addConnection(undefined, mastodon('dup'))).toEqual({ error: 'You already have a connection labelled "dup".' });
    expect(await addConnection(undefined, mastodon('main'))).toHaveProperty('saved');
  });
});

describe('deleteConnection', () => {
  it('deletes only the current user’s connection', async () => {
    const other = await loginAs('other@example.com');
    const theirs = await insertConnection(other.id);
    const me = await loginAs();
    const mine = await insertConnection(me.id);
    await deleteConnection(form([['id', theirs.id]]));
    await deleteConnection(form([['id', 'not-a-uuid']]));
    expect(await db.select().from(connections)).toHaveLength(2);
    await deleteConnection(form([['id', mine.id]]));
    expect((await db.select().from(connections)).map((c) => c.id)).toEqual([theirs.id]);
  });
});

describe('ConnectionsPage', () => {
  it('requires a session', async () => {
    jar.clear();
    await expect(ConnectionsPage()).rejects.toThrow('REDIRECT /login');
  });

  it('shows an empty state and the add form', async () => {
    await loginAs();
    const html = renderToStaticMarkup(await ConnectionsPage());
    expect(html).toContain('No connections yet.');
    expect(html).toContain('Up to 280 characters'); // first connector (X) preselected
  });

  it('lists only the user’s connections', async () => {
    const other = await loginAs('other@example.com');
    await insertConnection(other.id, 'not-mine');
    const me = await loginAs();
    await insertConnection(me.id, 'mine');
    await insertConnection(me.id, 'legacy', 'gone');
    const html = renderToStaticMarkup(await ConnectionsPage());
    expect(html).toContain('mine');
    expect(html).toContain('Mastodon');
    expect(html).toContain('gone'); // unknown connector id falls back to the raw id
    expect(html).toContain('aria-label="Delete mine"');
    expect(html).not.toContain('not-mine');
  });
});
