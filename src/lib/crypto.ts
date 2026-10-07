import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getConfig } from './config';

const key = () => createHash('sha256').update(getConfig().APP_SECRET).digest();

/** AES-256-GCM; returns `iv.tag.ciphertext` (each base64). */
export function encrypt(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

/** Throws on malformed input, wrong key or tampering. */
export function decrypt<T = unknown>(payload: string): T {
  const parts = payload.split('.');
  if (parts.length !== 3) throw new Error('invalid ciphertext');
  const [iv, tag, data] = parts.map((p) => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}
