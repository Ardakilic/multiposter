import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password', () => {
  it('hashes in scrypt$N$r$p$salt$hash format and verifies', async () => {
    const h = await hashPassword('hunter2');
    const [algo, n, r, p, salt, hash] = h.split('$');
    expect([algo, n, r, p]).toEqual(['scrypt', '16384', '8', '1']);
    expect(Buffer.from(salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(hash, 'base64')).toHaveLength(64);
    expect(await verifyPassword('hunter2', h)).toBe(true);
    expect(await verifyPassword('hunter3', h)).toBe(false);
  });

  it('uses a random salt', async () => {
    expect(await hashPassword('x')).not.toBe(await hashPassword('x'));
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$1$2$3$a$b')).toBe(false);
    await expect(verifyPassword('x', 'scrypt$3$8$1$c2FsdA==$aGFzaA==')).rejects.toThrow(); // N not a power of 2
  });
});
