import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadToImgur } from './imgur';

afterEach(() => vi.restoreAllMocks());

describe('uploadToImgur', () => {
  it.each([
    ['image/png', 'image'],
    ['video/mp4', 'video'],
  ])('posts %s as the %s field', async (mime, field) => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ data: { link: 'https://i.imgur.com/x' } }));
    expect(await uploadToImgur('CID', Buffer.from('abc'), mime)).toEqual({ url: 'https://i.imgur.com/x' });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('https://api.imgur.com/3/image');
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Client-ID CID' } });
    const file = (init!.body as FormData).get(field) as Blob;
    expect(file.type).toBe(mime);
    expect(await file.text()).toBe('abc');
  });

  it('throws on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    await expect(uploadToImgur('CID', Buffer.from('a'), 'image/png')).rejects.toThrow('Imgur upload failed (429): rate limited');
  });
});
