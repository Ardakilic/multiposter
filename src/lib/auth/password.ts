import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: ScryptOptions) => Promise<Buffer>;

const N = 2 ** 14, r = 8, p = 1, KEYLEN = 64;
const maxmem = 64 * 1024 * 1024; // needs 128*N*r = 16MB; Node default cap is 32MB, raised for headroom

/** `scrypt$N$r$p$salt$hash`, salt/hash base64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r, p, maxmem });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
}

/** Constant-time check; reads N/r/p from the stored hash so cost params can change later. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, rr, pp, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n), r: Number(rr), p: Number(pp), maxmem,
  });
  return timingSafeEqual(actual, expected);
}
