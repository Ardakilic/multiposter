import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/client';
import { sessions, users } from '../db/schema';
import { createSession, destroySession, getUser, requireUser, SESSION_COOKIE } from './session';

const jar = new Map<string, { value: string; opts?: Record<string, unknown> }>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, opts: Record<string, unknown>) => jar.set(name, { value, opts }),
    delete: (name: string) => jar.delete(name),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));

async function makeUser() {
  const [u] = await db.insert(users).values({ email: 'a@example.com', passwordHash: 'x' }).returning();
  return u;
}

beforeEach(() => jar.clear());

describe('session', () => {
  it('creates a session cookie and resolves the user', async () => {
    const u = await makeUser();
    await createSession(u.id);
    const c = jar.get(SESSION_COOKIE)!;
    expect(c.opts).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: false, path: '/', maxAge: 30 * 86400 });
    const [row] = await db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect(row.tokenHash).not.toBe(c.value); // only the hash is stored
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(await getUser()).toEqual({ id: u.id, email: 'a@example.com' });
    expect(await requireUser()).toEqual({ id: u.id, email: 'a@example.com' });
  });

  it('returns null / redirects without a valid session', async () => {
    expect(await getUser()).toBeNull();
    await expect(requireUser()).rejects.toThrow('REDIRECT /login');
    jar.set(SESSION_COOKIE, { value: 'bogus' });
    expect(await getUser()).toBeNull();
  });

  it('ignores expired sessions', async () => {
    const u = await makeUser();
    await createSession(u.id);
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await getUser()).toBeNull();
  });

  it('destroys the session row and cookie', async () => {
    const u = await makeUser();
    await createSession(u.id);
    await destroySession();
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await db.select().from(sessions)).toHaveLength(0);
    await destroySession(); // no cookie: no-op
  });
});
