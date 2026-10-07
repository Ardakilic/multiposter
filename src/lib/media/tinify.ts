import { getConfig } from '../config';

const COMPRESSIBLE = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Compress via TinyPNG. Transient failures (429/5xx/network) keep the original; auth/4xx errors throw. */
export async function tinify(bytes: Buffer, mime: string): Promise<Buffer> {
  const key = getConfig().TINYPNG_API_KEY;
  if (!key || !COMPRESSIBLE.has(mime)) return bytes;
  const headers = { Authorization: `Basic ${Buffer.from(`api:${key}`).toString('base64')}` };
  let res: Response;
  try {
    res = await fetch('https://api.tinify.com/shrink', { method: 'POST', headers, body: new Uint8Array(bytes) });
    if (res.status === 201) {
      const location = res.headers.get('Location');
      if (!location) throw new Error('TinyPNG: missing Location header');
      res = await fetch(location, { headers });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    }
  } catch (e) {
    console.warn('TinyPNG unavailable, keeping original:', e);
    return bytes;
  }
  if (res.status === 429 || res.status >= 500) {
    console.warn(`TinyPNG ${res.status}, keeping original`);
    return bytes;
  }
  throw new Error(`TinyPNG failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}
