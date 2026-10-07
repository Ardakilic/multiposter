'use server';

/**
 * Auth server actions. Emails are normalised (trim + lowercase) before lookup/insert; failed logins
 * always run a scrypt verify so unknown emails cost the same time as wrong passwords.
 */

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSession, destroySession } from '@/lib/auth/session';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';

export type FormState = { error?: string } | undefined;

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.'));

const registerSchema = z.object({
  email,
  password: z.string().min(8, 'Password must be at least 8 characters.').max(1024),
});
const loginSchema = z.object({ email, password: z.string().min(1).max(1024) });

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
let dummyHash: Promise<string> | undefined;

/** Create an account and sign in. Disabled when ALLOW_REGISTRATION is false. */
export async function register(_: FormState, form: FormData): Promise<FormState> {
  if (!getConfig().ALLOW_REGISTRATION) return { error: 'Registration is disabled.' };
  const parsed = registerSchema.safeParse({ email: form.get('email') ?? '', password: form.get('password') ?? '' });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const passwordHash = await hashPassword(parsed.data.password);
  const [user] = await db
    .insert(users)
    .values({ email: parsed.data.email, passwordHash })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (!user) return { error: 'An account with this email already exists.' };
  await createSession(user.id);
  redirect('/compose');
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: form.get('email') ?? '', password: form.get('password') ?? '' });
  if (!parsed.success) return { error: 'Invalid credentials.' };
  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email));
  dummyHash ??= hashPassword('not-a-real-password');
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? (await dummyHash));
  if (!user || !ok) return { error: 'Invalid credentials.' };
  await createSession(user.id);
  redirect('/compose');
}

export async function logout() {
  await destroySession();
  redirect('/login');
}
