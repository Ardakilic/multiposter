import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetConfig } from './config';
import { decrypt, encrypt } from './crypto';

afterEach(() => vi.unstubAllEnvs());

describe('crypto', () => {
  const creds = { token: 'sëcret 🔑', n: 1 };

  it('round-trips and uses a fresh IV each time', () => {
    const a = encrypt(creds);
    expect(a.split('.')).toHaveLength(3);
    expect(a).not.toContain('sëcret');
    expect(encrypt(creds)).not.toBe(a);
    expect(decrypt(a)).toEqual(creds);
  });

  it('detects tampering', () => {
    const [iv, tag, data] = encrypt(creds).split('.');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    expect(() => decrypt([iv, tag, flipped.toString('base64')].join('.'))).toThrow();
    const badTag = Buffer.from(tag, 'base64');
    badTag[0] ^= 1;
    expect(() => decrypt([iv, badTag.toString('base64'), data].join('.'))).toThrow();
  });

  it('rejects malformed input and a truncated tag', () => {
    expect(() => decrypt('nope')).toThrow('invalid ciphertext');
    const [iv, tag, data] = encrypt(creds).split('.');
    expect(() => decrypt([iv, Buffer.from(tag, 'base64').subarray(0, 4).toString('base64'), data].join('.'))).toThrow();
  });

  it('fails with a different APP_SECRET', () => {
    const enc = encrypt(creds);
    vi.stubEnv('APP_SECRET', 'another-secret-another-secret-another');
    resetConfig();
    expect(() => decrypt(enc)).toThrow();
  });
});
