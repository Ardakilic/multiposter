import { createHash } from 'node:crypto';
import { getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadToBlossom } from './blossom';

const sk = Uint8Array.from(Buffer.from('5'.repeat(64), 'hex'));
const bytes = Buffer.from('image-bytes');
const sha = createHash('sha256').update(bytes).digest('hex');

afterEach(() => vi.restoreAllMocks());

describe('uploadToBlossom', () => {
  it('PUTs with a signed kind 24242 auth event', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ url: `https://b.example/${sha}.png` }));
    expect(await uploadToBlossom('https://b.example/', bytes, 'image/png', sk)).toEqual({ url: `https://b.example/${sha}.png`, sha256: sha });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('https://b.example/upload');
    const headers = init!.headers as Record<string, string>;
    expect(init!.method).toBe('PUT');
    expect(headers).toMatchObject({ 'Content-Type': 'image/png', 'Content-Length': String(bytes.length), 'X-SHA-256': sha });
    expect(headers.Authorization).toMatch(/^Nostr /);
    const ev = JSON.parse(Buffer.from(headers.Authorization.slice(6), 'base64').toString());
    expect(verifyEvent(ev)).toBe(true);
    expect(ev).toMatchObject({ kind: 24242, content: 'Upload', pubkey: getPublicKey(sk) });
    expect(ev.tags.slice(0, 2)).toEqual([['t', 'upload'], ['x', sha]]);
    expect(ev.tags[2][0]).toBe('expiration');
    expect(Number(ev.tags[2][1]) - ev.created_at).toBe(300);
  });

  it('throws on non-2xx with status and body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('nope', { status: 401 }));
    await expect(uploadToBlossom('https://b.example', bytes, 'image/png', sk)).rejects.toThrow('Blossom upload failed (401): nope');
  });
});
