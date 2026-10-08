import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfig, resetConfig } from './config';

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfig();
});

describe('getConfig', () => {
  it('applies defaults and memoizes', () => {
    const c = getConfig();
    expect(c).toMatchObject({
      APP_NAME: 'Multiposter',
      APP_URL: 'http://localhost:3000',
      S3_REGION: 'us-east-1',
      S3_FORCE_PATH_STYLE: true,
      NOSTR_MEDIA_HOST: 'blossom',
      BLOSSOM_SERVER: 'https://blossom.primal.net',
      WORKER_POLL_MS: 10000,
      SESSION_TTL_DAYS: 30,
      MAX_UPLOAD_MB: 50,
      ALLOW_REGISTRATION: true,
      COOKIE_SECURE: false,
      MAIL_FROM: 'no-reply@localhost',
    });
    expect(c.S3_PUBLIC_URL).toBeUndefined();
    expect(c.SMTP_URL).toBeUndefined();
    vi.stubEnv('APP_NAME', 'Changed');
    expect(getConfig()).toBe(c);
    resetConfig();
    expect(getConfig().APP_NAME).toBe('Changed');
  });

  it('parses booleans, numbers, and treats empty strings as unset', () => {
    vi.stubEnv('ALLOW_REGISTRATION', 'false');
    vi.stubEnv('WORKER_POLL_MS', '500');
    vi.stubEnv('S3_PUBLIC_URL', '');
    vi.stubEnv('APP_NAME', '');
    const c = getConfig();
    expect(c.ALLOW_REGISTRATION).toBe(false);
    expect(c.WORKER_POLL_MS).toBe(500);
    expect(c.S3_PUBLIC_URL).toBeUndefined();
    expect(c.APP_NAME).toBe('Multiposter');
  });

  it('strips trailing slash from S3_PUBLIC_URL', () => {
    vi.stubEnv('S3_PUBLIC_URL', 'https://cdn.example.com/media/');
    expect(getConfig().S3_PUBLIC_URL).toBe('https://cdn.example.com/media');
  });

  it.each([
    ['auto', 'production', true],
    ['auto', 'development', false],
    ['true', 'development', true],
    ['false', 'production', false],
  ])('COOKIE_SECURE=%s NODE_ENV=%s -> %s', (secure, nodeEnv, expected) => {
    vi.stubEnv('COOKIE_SECURE', secure);
    vi.stubEnv('NODE_ENV', nodeEnv);
    expect(getConfig().COOKIE_SECURE).toBe(expected);
  });

  it('rejects short APP_SECRET', () => {
    vi.stubEnv('APP_SECRET', 'short');
    expect(() => getConfig()).toThrow(/APP_SECRET/);
  });

  it('rejects missing DATABASE_URL', () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(() => getConfig()).toThrow(/DATABASE_URL/);
  });

  it('requires IMGUR_CLIENT_ID when NOSTR_MEDIA_HOST=imgur', () => {
    vi.stubEnv('NOSTR_MEDIA_HOST', 'imgur');
    expect(() => getConfig()).toThrow(/IMGUR_CLIENT_ID/);
    resetConfig();
    vi.stubEnv('IMGUR_CLIENT_ID', 'abc');
    expect(getConfig().IMGUR_CLIENT_ID).toBe('abc');
  });
});
