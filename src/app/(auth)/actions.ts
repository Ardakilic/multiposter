'use server';

/**
 * Auth server actions. Emails are normalised (trim + lowercase) before lookup/insert; failed logins
 * always run a scrypt verify so unknown emails cost the same time as wrong passwords.
 * With email on (SMTP_URL), sign-up needs a confirmed address and passwords can be reset by emailed link.
 */

import { eq, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSession, destroySession, registrationOpen } from '@/lib/auth/session';
import { consumeToken, createToken } from '@/lib/auth/tokens';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db/client';
import { sessions, users } from '@/lib/db/schema';
import { mailEnabled, sendMail } from '@/lib/mail';

export type FormState = { error?: string; message?: string } | undefined;

const INVALID_LINK = 'This link is invalid or has expired.';

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.'));
const newPassword = z.string().min(8, 'Password must be at least 8 characters.').max(1024);
const token = z.string().min(1, INVALID_LINK).max(256, INVALID_LINK);

const registerSchema = z.object({ email, password: newPassword });
const loginSchema = z.object({ email, password: z.string().min(1).max(1024) });
const resetSchema = z.object({ token, password: newPassword });

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
let dummyHash: Promise<string> | undefined;

/** Emails a fresh single-use link to /verify or /reset (the path is the token purpose). */
async function mailLink(userId: string, to: string, purpose: 'verify' | 'reset') {
  const { APP_NAME, APP_URL } = getConfig();
  const link = new URL(`/${purpose}?token=${await createToken(userId, purpose)}`, APP_URL).href;
  await sendMail(
    purpose === 'verify'
      ? {
          to,
          subject: `Confirm your ${APP_NAME} account`,
          text: `Confirm your email address to finish signing up for ${APP_NAME}:\n\n${link}\n\nThis link expires in 24 hours. If you did not sign up, ignore this email.\n`,
        }
      : {
          to,
          subject: `Reset your ${APP_NAME} password`,
          text: `Someone asked to reset the password of your ${APP_NAME} account. Choose a new password here:\n\n${link}\n\nThis link expires in 1 hour. If it was not you, ignore this email; your password stays the same.\n`,
        },
  );
}

/**
 * Create an account. Email off: sign in right away. Email on: send a confirmation link instead; if it cannot be
 * sent, the account is removed again so the address isn't left unusable. Refused when registration is closed.
 */
export async function register(_: FormState, form: FormData): Promise<FormState> {
  if (!(await registrationOpen())) return { error: 'Registration is disabled.' };
  const parsed = registerSchema.safeParse({ email: form.get('email') ?? '', password: form.get('password') ?? '' });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const passwordHash = await hashPassword(parsed.data.password);
  const [user] = await db
    .insert(users)
    .values({ email: parsed.data.email, passwordHash })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (!user) return { error: 'An account with this email already exists.' };
  if (mailEnabled()) {
    try {
      await mailLink(user.id, parsed.data.email, 'verify');
    } catch (e) {
      console.error('Confirmation email failed:', e);
      await db.delete(users).where(eq(users.id, user.id));
      return { error: 'Could not send the confirmation email. Check the address and try again.' };
    }
    return { message: `We sent a confirmation link to ${parsed.data.email}. Open it within 24 hours to finish signing up.` };
  }
  await createSession(user.id);
  redirect('/compose');
}

/** With email on, an unconfirmed account gets a fresh confirmation link instead of a session. */
export async function login(_: FormState, form: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: form.get('email') ?? '', password: form.get('password') ?? '' });
  if (!parsed.success) return { error: 'Invalid credentials.' };
  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email));
  dummyHash ??= hashPassword('not-a-real-password');
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? (await dummyHash));
  if (!user || !ok) return { error: 'Invalid credentials.' };
  if (mailEnabled() && !user.emailVerifiedAt) {
    try {
      await mailLink(user.id, user.email, 'verify');
    } catch (e) {
      console.error('Confirmation email failed:', e);
      return { error: 'Confirm your email first. We could not resend the link; try again later.' };
    }
    return { error: `Confirm your email first. We sent a new link to ${user.email}.` };
  }
  await createSession(user.id);
  redirect('/compose');
}

/** POST target of /verify (a GET never consumes the token, so link-prefetching mail scanners can't). */
export async function verifyEmail(_: FormState, form: FormData): Promise<FormState> {
  const parsed = token.safeParse(form.get('token') ?? '');
  const userId = parsed.success && (await consumeToken(parsed.data, 'verify'));
  if (!userId) return { error: INVALID_LINK };
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
  await createSession(userId);
  redirect('/compose');
}

/** Same answer whether or not the account exists; the mail goes out after the response so timing doesn't tell either. */
export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({ email }).safeParse({ email: form.get('email') ?? '' });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!mailEnabled()) return { error: 'Password reset is unavailable because email is not configured.' };
  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email));
  if (user) after(() => mailLink(user.id, user.email, 'reset'));
  return { message: 'If that email has an account, we sent a password reset link.' };
}

/** New password, every existing session of the user dropped; the link also proves the address. */
export async function resetPassword(_: FormState, form: FormData): Promise<FormState> {
  const parsed = resetSchema.safeParse({ token: form.get('token') ?? '', password: form.get('password') ?? '' });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const userId = await consumeToken(parsed.data.token, 'reset');
  if (!userId) return { error: INVALID_LINK };
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(parsed.data.password), emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
    .where(eq(users.id, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await createSession(userId);
  redirect('/compose');
}

export async function logout() {
  await destroySession();
  redirect('/login');
}
