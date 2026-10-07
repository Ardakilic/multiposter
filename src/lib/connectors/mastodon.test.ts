import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { mastodon, mediaPoll } from './mastodon';
import type { MediaFile } from './types';

const creds = { host: 'mastodon.example/', accessToken: 'tok' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const file = (alt?: string): MediaFile => ({
  key: 'u/dir/clip.mp4', mime: 'video/mp4', size: 3, alt, bytes: async () => Buffer.from('vid'), url: async () => 'http://x',
});
let fetchMock: MockInstance<typeof fetch>;
const call = (i: number) => fetchMock.mock.calls[i] as [string, RequestInit];

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, 'fetch');
  mediaPoll.delayMs = 0;
});
afterEach(() => vi.restoreAllMocks());

describe('mastodon connector', () => {
  it('verify returns acct and instance settings, normalizing the host', async () => {
    fetchMock.mockResolvedValueOnce(json({ acct: 'arda' })).mockResolvedValueOnce(json({
      configuration: {
        statuses: { max_characters: 1000, max_media_attachments: 6, characters_reserved_per_url: 30 },
        media_attachments: { image_size_limit: 1, video_size_limit: 2 },
      },
    }));
    await expect(mastodon.verify(creds)).resolves.toEqual({
      accountName: 'arda',
      settings: { maxChars: 1000, maxMedia: 6, charsPerUrl: 30, imageSizeLimit: 1, videoSizeLimit: 2 },
    });
    expect(call(0)[0]).toBe('https://mastodon.example/api/v1/accounts/verify_credentials');
    expect(call(0)[1].headers).toEqual({ Authorization: 'Bearer tok' });
    expect(call(1)[0]).toBe('https://mastodon.example/api/v2/instance');
  });

  it('verify falls back to defaults and keeps an explicit http scheme', async () => {
    fetchMock.mockResolvedValueOnce(json({ acct: 'a' })).mockResolvedValueOnce(json({}));
    const r = await mastodon.verify({ host: 'http://localhost:3000', accessToken: 't' });
    expect(r.settings).toEqual({ maxChars: 500, maxMedia: 4, charsPerUrl: 23, imageSizeLimit: undefined, videoSizeLimit: undefined });
    expect(call(0)[0]).toBe('http://localhost:3000/api/v1/accounts/verify_credentials');
  });

  it('throws with status and body snippet on bad credentials', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"The access token is invalid"}', { status: 401 }));
    await expect(mastodon.verify(creds)).rejects.toThrow('Mastodon GET /api/v1/accounts/verify_credentials failed: 401 {"error":"The access token is invalid"}');
  });

  it('posts text-only status JSON', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 's1', url: 'https://mastodon.example/@arda/s1' }));
    const r = await mastodon.post({ creds, settings: {}, text: 'hi', media: [] });
    const [url, init] = call(0);
    expect(url).toBe('https://mastodon.example/api/v1/statuses');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ status: 'hi', media_ids: [] });
    expect(r).toEqual({ id: 's1', url: 'https://mastodon.example/@arda/s1', ref: { id: 's1' } });
  });

  it('uploads multipart media, polls 202 until 200, replies to parent', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 'm1' }, 202))
      .mockResolvedValueOnce(json({ id: 'm1' }, 206))
      .mockResolvedValueOnce(json({ id: 'm1' }))
      .mockResolvedValueOnce(json({ id: 'm2' }))
      .mockResolvedValueOnce(json({ id: 's2', url: 'u' }));
    await mastodon.post({ creds, settings: {}, text: 't', media: [file('alt text'), file()], parent: { id: 'p1' } });
    const [url, init] = call(0);
    expect(url).toBe('https://mastodon.example/api/v2/media');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    const f = form.get('file') as File;
    expect(f.name).toBe('clip.mp4');
    expect(f.type).toBe('video/mp4');
    expect(Buffer.from(await f.arrayBuffer()).toString()).toBe('vid');
    expect(form.get('description')).toBe('alt text');
    expect(call(1)[0]).toBe('https://mastodon.example/api/v1/media/m1');
    expect(call(2)[0]).toBe('https://mastodon.example/api/v1/media/m1');
    expect((call(3)[1].body as FormData).has('description')).toBe(false);
    expect(JSON.parse(call(4)[1].body as string)).toEqual({ status: 't', media_ids: ['m1', 'm2'], in_reply_to_id: 'p1' });
  });

  it('gives up when media never finishes processing', async () => {
    mediaPoll.attempts = 2;
    fetchMock.mockImplementation(async () => json({ id: 'm1' }, 206));
    await expect(mastodon.post({ creds, settings: {}, text: 't', media: [file()] })).rejects.toThrow('media m1 still processing');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    mediaPoll.attempts = 30;
  });

  it('fails on non-2xx status creation', async () => {
    fetchMock.mockResolvedValueOnce(new Response('x'.repeat(500), { status: 422 }));
    await expect(mastodon.post({ creds, settings: {}, text: 't', media: [] })).rejects.toThrow(/POST \/api\/v1\/statuses failed: 422 x{200}$/);
  });
});
