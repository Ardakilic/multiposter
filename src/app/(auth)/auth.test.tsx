import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { form, jar, loginAs } from '../../../test/next';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { resetConfig } from '@/lib/config';
import { db } from '@/lib/db/client';
import { sessions, users } from '@/lib/db/schema';
import { login, logout, register } from './actions';
import LoginPage from './login/page';
import RegisterPage from './register/page';

vi.mock('next/headers', async () => (await import('../../../test/next')).headers);
vi.mock('next/navigation', async () => (await import('../../../test/next')).navigation);
vi.mock('next/server', () => ({ connection: vi.fn(async () => {}) }));

const creds = (email: string, password: string) => form([['email', email], ['password', password]]);

beforeEach(() => jar.clear());
afterEach(() => vi.unstubAllEnvs());

describe('register', () => {
  it('creates the user, logs in and redirects; email is normalised', async () => {
    await expect(register(undefined, creds(' New@Example.com ', 'password1'))).rejects.toThrow('REDIRECT /compose');
    const [u] = await db.select().from(users);
    expect(u.email).toBe('new@example.com');
    expect(await verifyPassword('password1', u.passwordHash)).toBe(true);
    expect(jar.has(SESSION_COOKIE)).toBe(true);
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

  it('is refused when registration is disabled', async () => {
    vi.stubEnv('ALLOW_REGISTRATION', 'false');
    expect(await register(undefined, creds('a@b.co', 'password1'))).toEqual({ error: 'Registration is disabled.' });
    expect(await db.select().from(users)).toHaveLength(0);
  });
});

describe('login / logout', () => {
  beforeEach(async () => {
    await db.insert(users).values({ email: 'me@example.com', passwordHash: await hashPassword('password1') });
  });

  it('logs in with the right password', async () => {
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

  it('login page hides the register link when registration is disabled', async () => {
    vi.stubEnv('ALLOW_REGISTRATION', 'false');
    expect(renderToStaticMarkup(await LoginPage())).not.toContain('/register');
  });

  it('register page renders, or 404s when disabled', async () => {
    expect(renderToStaticMarkup(await RegisterPage())).toContain('minLength="8"');
    vi.stubEnv('ALLOW_REGISTRATION', 'false');
    resetConfig();
    await expect(RegisterPage()).rejects.toThrow('NOT_FOUND');
  });

  it('logged-in users are sent to /compose', async () => {
    await loginAs();
    await expect(LoginPage()).rejects.toThrow('REDIRECT /compose');
    await expect(RegisterPage()).rejects.toThrow('REDIRECT /compose');
  });
});
