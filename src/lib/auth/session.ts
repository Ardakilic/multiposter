import { and, eq, gt } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, randomBytes } from 'node:crypto';
import { getConfig } from '../config';
import { db } from '../db/client';
import { sessions, users } from '../db/schema';

export const SESSION_COOKIE = 'session';
const DAY_MS = 86_400_000;

const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

/** Store only the SHA-256 of a random token; the raw token lives only in the httpOnly cookie. */
export async function createSession(userId: string) {
  const { SESSION_TTL_DAYS, COOKIE_SECURE } = getConfig();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * DAY_MS);
  await db.insert(sessions).values({ userId, tokenHash: sha256(token), expiresAt });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: SESSION_TTL_DAYS * 86_400,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

/** Current user ({id, email}) or null. */
export async function getUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({ id: users.id, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())));
  return row ?? null;
}

/** Current user, or redirect to /login. */
export async function requireUser() {
  return (await getUser()) ?? redirect('/login');
}

/** Open when ALLOW_REGISTRATION is on, or while no account exists (so the first user can always sign up). */
export async function registrationOpen() {
  // ponytail: check-then-insert, two simultaneous first sign-ups can both get in; fine for self-hosting
  return getConfig().ALLOW_REGISTRATION || !(await db.select({ id: users.id }).from(users).limit(1)).length;
}
