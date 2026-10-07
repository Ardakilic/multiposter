// Shared stand-ins for Next request APIs, for page/action tests:
//   vi.mock('next/headers', async () => (await import('../../test/next')).headers);
import { db } from '../src/lib/db/client';
import { users } from '../src/lib/db/schema';

export const jar = new Map<string, string>();

export const headers = {
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
};

export const navigation = {
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
};

/** Inserts a user and makes it the current session. */
export async function loginAs(email = 'me@example.com') {
  jar.clear();
  const [user] = await db.insert(users).values({ email, passwordHash: 'x' }).returning();
  const { createSession } = await import('../src/lib/auth/session'); // lazy: session imports the mocked next/headers
  await createSession(user.id);
  return user;
}

export const form = (entries: [string, string | Blob][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};
