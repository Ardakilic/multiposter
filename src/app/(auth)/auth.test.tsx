import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { form, jar, loginAs } from '../../../test/next';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSession, SESSION_COOKIE } from '@/lib/auth/session';
import { createToken } from '@/lib/auth/tokens';
import { resetConfig } from '@/lib/config';
import { db } from '@/lib/db/client';
import { emailTokens, sessions, users } from '@/lib/db/schema';
import { mailEnabled, sendMail } from '@/lib/mail';
import { login, logout, register, requestPasswordReset, resetPassword, verifyEmail } from './actions';
import ForgotPage from './forgot/page';
import LoginPage from './login/page';
import RegisterPage from './register/page';
import ResetPage from './reset/page';
import VerifyPage from './verify/page';

const afterTasks = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock('next/headers', async () => (await import('../../../test/next')).headers);
vi.mock('next/navigation', async () => (await import('../../../test/next')).navigation);
vi.mock('next/server', () => ({ connection: vi.fn(async () => {}), after: (fn: () => Promise<void>) => afterTasks.push(fn) }));
vi.mock('@/lib/mail', () => ({ mailEnabled: vi.fn(), sendMail: vi.fn() }));

const creds = (email: string, password: string) => form([['email', email], ['password', password]]);
const runAfterTasks = () => Promise.all(afterTasks.splice(0).map((fn) => fn()));
const lastMail = () => vi.mocked(sendMail).mock.lastCall![0];
/** Token from the link in the last email, checking the link's shape on the way. */
const mailedToken = (path: 'verify' | 'reset') =>
  lastMail().text.match(new RegExp(`^http://localhost:3000/${path}\\?token=([\\w-]{43})$`, 'm'))![1];
const userByEmail = async (email: string) => (await db.select().from(users).where(eq(users.email, email)))[0];

beforeEach(() => {
  jar.clear();
  afterTasks.length = 0;
  vi.mocked(mailEnabled).mockReset().mockReturnValue(false);
  vi.mocked(sendMail).mockReset().mockResolvedValue();
});
afterEach(() => vi.unstubAllEnvs());

describe('register', () => {
  it('creates the user, logs in and redirects; email is normalised', async () => {
    await expect(register(undefined, creds(' New@Example.com ', 'password1'))).rejects.toThrow('REDIRECT /compose');
    const [u] = await db.select().from(users);
    expect(u.email).toBe('new@example.com');
    expect(await verifyPassword('password1', u.passwordHash)).toBe(true);
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('validates email and password length', async () => {
    expect(await register(undefined, creds('nope', 'password1'))).toEqual({ error: 'Enter a valid email address.' });
    expect(await register(undefined, creds('a@b.co', 'short'))).toEqual({ error: 'Password must be at least 8 characters.' });
    expect(await register(undefined, new FormData())).toHaveProperty('error');
  });

  it('rejects duplicate emails', async () => {
    await loginAs('dup@example.com');
    expect(await register(undefined, creds('dup@example.com', 'password1'))).toEqual({
      error: 'An account with this email already exists.',
    });
  });

  it('is refused when registration is disabled and an account exists', async () => {
    vi.stubEnv('ALLOW_REGISTRATION', 'false');
    await db.insert(users).values({ email: 'first@example.com', passwordHash: 'x' });
    expect(await register(undefined, creds('a@b.co', 'password1'))).toEqual({ error: 'Registration is disabled.' });
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('lets the first user register even when registration is disabled', async () => {
    vi.stubEnv('ALLOW_REGISTRATION', 'false');
    await expect(register(undefined, creds('first@example.com', 'password1'))).rejects.toThrow('REDIRECT /compose');
    expect(await db.select().from(users)).toHaveLength(1);
  });
});

describe('login / logout', () => {
  beforeEach(async () => {
    await db.insert(users).values({ email: 'me@example.com', passwordHash: await hashPassword('password1') });
  });

  it('logs in with the right password (unconfirmed is fine while email is off)', async () => {
    await expect(login(undefined, creds('ME@example.com', 'password1'))).rejects.toThrow('REDIRECT /compose');
    expect(jar.has(SESSION_COOKIE)).toBe(true);
  });

  it('gives one generic error for wrong password, unknown email, or bad input', async () => {
    const err = { error: 'Invalid credentials.' };
    expect(await login(undefined, creds('me@example.com', 'wrong-pass'))).toEqual(err);
    expect(await login(undefined, creds('who@example.com', 'password1'))).toEqual(err);
    expect(await login(undefined, new FormData())).toEqual(err);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it('logout destroys the session and redirects to /login', async () => {
    const [u] = await db.select().from(users).where(eq(users.email, 'me@example.com'));
    const { createSession } = await import('@/lib/auth/session');
    await createSession(u.id);
    await expect(logout()).rejects.toThrow('REDIRECT /login');
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});

describe('pages', () => {
  it('login page renders the form and a register link', async () => {
    const html = renderToStaticMarkup(await LoginPage());
    expect(html).toContain('type="password"');
    expect(html).toContain('href="/register"');
  });

  it('login page hides the register link when registration is disabled, unless there are no users', async () => {
    vi.stubEnv('ALLOW_REGISTRATION', 'false');
    expect(renderToStaticMarkup(await LoginPage())).toContain('href="/register"');
    await db.insert(users).values({ email: 'first@example.com', passwordHash: 'x' });
    expect(renderToStaticMarkup(await LoginPage())).not.toContain('/register');
  });

  it('register page renders, or 404s when disabled and an account exists', async () => {
    expect(renderToStaticMarkup(await RegisterPage())).toContain('minLength="8"');
    vi.stubEnv('ALLOW_REGISTRATION', 'false');
    resetConfig();
    expect(renderToStaticMarkup(await RegisterPage())).toContain('minLength="8"');
    await db.insert(users).values({ email: 'first@example.com', passwordHash: 'x' });
    await expect(RegisterPage()).rejects.toThrow('NOT_FOUND');
  });

  it('logged-in users are sent to /compose', async () => {
    await loginAs();
    await expect(LoginPage()).rejects.toThrow('REDIRECT /compose');
    await expect(RegisterPage()).rejects.toThrow('REDIRECT /compose');
  });
});

describe('with email on', () => {
  beforeEach(() => vi.mocked(mailEnabled).mockReturnValue(true));

  it('register sends a confirmation link instead of signing in; the link verifies and signs in once', async () => {
    expect(await register(undefined, creds('New@Example.com', 'password1'))).toEqual({
      message: 'We sent a confirmation link to new@example.com. Open it within 24 hours to finish signing up.',
    });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await userByEmail('new@example.com')).toMatchObject({ emailVerifiedAt: null });
    expect(sendMail).toHaveBeenCalledOnce();
    expect(lastMail()).toMatchObject({ to: 'new@example.com', subject: 'Confirm your Multiposter account' });
    expect(lastMail().text).toContain('expires in 24 hours');

    const token = mailedToken('verify');
    await expect(verifyEmail(undefined, form([['token', token]]))).rejects.toThrow('REDIRECT /compose');
    expect((await userByEmail('new@example.com')).emailVerifiedAt).toBeInstanceOf(Date);
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect(await verifyEmail(undefined, form([['token', token]]))).toEqual({ error: 'This link is invalid or has expired.' });
  });

  it('register removes the account again when the email cannot be sent', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sendMail).mockRejectedValueOnce(new Error('550 no such user'));
    expect(await register(undefined, creds('bad@example.com', 'password1'))).toEqual({
      error: 'Could not send the confirmation email. Check the address and try again.',
    });
    expect(await db.select().from(users)).toHaveLength(0);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(log).toHaveBeenCalledWith('Confirmation email failed:', expect.any(Error));
    log.mockRestore();
  });

  it('login of an unconfirmed account resends the link and gives no session', async () => {
    await db.insert(users).values({ email: 'me@example.com', passwordHash: await hashPassword('password1') });
    expect(await login(undefined, creds('me@example.com', 'password1'))).toEqual({
      error: 'Confirm your email first. We sent a new link to me@example.com.',
    });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(lastMail()).toMatchObject({ to: 'me@example.com', subject: 'Confirm your Multiposter account' });
    await expect(verifyEmail(undefined, form([['token', mailedToken('verify')]]))).rejects.toThrow('REDIRECT /compose');
    // wrong password never reveals the verification state
    expect(await login(undefined, creds('me@example.com', 'wrong-pass'))).toEqual({ error: 'Invalid credentials.' });
  });

  it('login of an unconfirmed account explains when the link cannot be resent', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sendMail).mockRejectedValueOnce(new Error('421 try later'));
    await db.insert(users).values({ email: 'me@example.com', passwordHash: await hashPassword('password1') });
    expect(await login(undefined, creds('me@example.com', 'password1'))).toEqual({
      error: 'Confirm your email first. We could not resend the link; try again later.',
    });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(log).toHaveBeenCalledWith('Confirmation email failed:', expect.any(Error));
    log.mockRestore();
  });

  it('login of a confirmed account signs in without mail', async () => {
    await db.insert(users).values({ email: 'me@example.com', passwordHash: await hashPassword('password1'), emailVerifiedAt: new Date() });
    await expect(login(undefined, creds('me@example.com', 'password1'))).rejects.toThrow('REDIRECT /compose');
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('verify rejects missing, unknown and expired tokens', async () => {
    const err = { error: 'This link is invalid or has expired.' };
    expect(await verifyEmail(undefined, new FormData())).toEqual(err);
    expect(await verifyEmail(undefined, form([['token', 'nope']]))).toEqual(err);
    const u = await loginAs('old@example.com');
    jar.clear();
    const raw = await createToken(u.id, 'verify');
    await db.update(emailTokens).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await verifyEmail(undefined, form([['token', raw]]))).toEqual(err);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect((await userByEmail('old@example.com')).emailVerifiedAt).toBeNull();
  });

  it('forgot password answers the same for unknown and known emails, mailing only the known one', async () => {
    const same = { message: 'If that email has an account, we sent a password reset link.' };
    expect(await requestPasswordReset(undefined, form([['email', 'who@example.com']]))).toEqual(same);
    await runAfterTasks();
    expect(sendMail).not.toHaveBeenCalled();

    await db.insert(users).values({ email: 'me@example.com', passwordHash: 'x' });
    expect(await requestPasswordReset(undefined, form([['email', ' ME@example.com']]))).toEqual(same);
    expect(sendMail).not.toHaveBeenCalled(); // sent after the response
    await runAfterTasks();
    expect(lastMail()).toMatchObject({ to: 'me@example.com', subject: 'Reset your Multiposter password' });
    expect(lastMail().text).toContain('expires in 1 hour');
    expect(mailedToken('reset')).toBeTruthy();

    expect(await requestPasswordReset(undefined, form([['email', 'nope']]))).toEqual({ error: 'Enter a valid email address.' });
    expect(await requestPasswordReset(undefined, new FormData())).toEqual({ error: 'Enter a valid email address.' });
  });

  it('reset sets the password, drops every old session, verifies the email and signs in', async () => {
    const u = await loginAs('me@example.com');
    await createSession(u.id); // a second device
    jar.clear();
    await requestPasswordReset(undefined, form([['email', 'me@example.com']]));
    await runAfterTasks();
    const token = mailedToken('reset');

    expect(await resetPassword(undefined, form([['token', token], ['password', 'short']]))).toEqual({
      error: 'Password must be at least 8 characters.',
    });
    await expect(resetPassword(undefined, form([['token', token], ['password', 'new-password']]))).rejects.toThrow('REDIRECT /compose');
    const updated = await userByEmail('me@example.com');
    expect(await verifyPassword('new-password', updated.passwordHash)).toBe(true);
    expect(updated.emailVerifiedAt).toBeInstanceOf(Date);
    const left = await db.select().from(sessions);
    expect(left).toHaveLength(1);
    expect(jar.has(SESSION_COOKIE)).toBe(true);

    expect(await resetPassword(undefined, form([['token', token], ['password', 'other-password']]))).toEqual({
      error: 'This link is invalid or has expired.',
    });
    expect(await resetPassword(undefined, new FormData())).toEqual({
      error: 'This link is invalid or has expired.',
    });
  });
});

describe('with email off', () => {
  it('forgot password is unavailable', async () => {
    await db.insert(users).values({ email: 'me@example.com', passwordHash: 'x' });
    expect(await requestPasswordReset(undefined, form([['email', 'me@example.com']]))).toEqual({
      error: 'Password reset is unavailable because email is not configured.',
    });
    expect(afterTasks).toHaveLength(0);
  });
});

describe('email pages', () => {
  it('login page shows "Forgot password?" only when email is on', async () => {
    expect(renderToStaticMarkup(await LoginPage())).not.toContain('href="/forgot"');
    vi.mocked(mailEnabled).mockReturnValue(true);
    expect(renderToStaticMarkup(await LoginPage())).toContain('href="/forgot"');
  });

  it('forgot page asks for the email only', () => {
    const html = renderToStaticMarkup(ForgotPage());
    expect(html).toContain('type="email"');
    expect(html).not.toContain('type="password"');
  });

  it('verify page posts the token, or explains a missing one', async () => {
    const html = renderToStaticMarkup(await VerifyPage({ searchParams: Promise.resolve({ token: 'abc' }) }));
    expect(html).toContain('<input type="hidden" name="token" value="abc"/>');
    expect(html).toContain('Confirm email</button>');
    expect(html).not.toContain('type="email"');
    for (const token of [undefined, '', ['a', 'b']]) {
      expect(renderToStaticMarkup(await VerifyPage({ searchParams: Promise.resolve({ token }) }))).toContain(
        'This link is invalid or has expired.',
      );
    }
  });

  it('reset page posts the token with a new password, or explains a missing one', async () => {
    const html = renderToStaticMarkup(await ResetPage({ searchParams: Promise.resolve({ token: 'abc' }) }));
    expect(html).toContain('<input type="hidden" name="token" value="abc"/>');
    expect(html).toContain('minLength="8"');
    expect(html).not.toContain('type="email"');
    const missing = renderToStaticMarkup(await ResetPage({ searchParams: Promise.resolve({}) }));
    expect(missing).toContain('This link is invalid or has expired.');
    expect(missing).toContain('href="/forgot"');
  });
});
