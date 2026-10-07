import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { instagram, poll } from './instagram';
import type { MediaFile } from './types';

const BASE = 'https://graph.instagram.com/v25.0';
const creds = { igUserId: 'U1', accessToken: 'TOK' };
const media = (mime: string, n = 1): MediaFile => ({
  key: `k${n}`, mime, size: 1, bytes: async () => Buffer.from(''), url: async () => `https://s3/${n}`,
});
const ctx = (m: MediaFile[]) => ({ creds, settings: {}, text: 'caption', media: m });

let fetchSpy: MockInstance<typeof fetch>;
let routes: Record<string, unknown[]>;
const calls = () =>
  fetchSpy.mock.calls.map(([url, init]) => (init?.method === 'POST' ? [url, Object.fromEntries(init.body as URLSearchParams)] : [url]));

beforeEach(() => {
  poll.delayMs = 0;
  routes = {};
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const key = String(url).replace(BASE, '').replace(/[?&]access_token=TOK/, '');
    const queue = routes[key];
    if (!queue?.length) throw new Error(`unexpected ${key}`);
    const body = queue.length > 1 ? queue.shift() : queue[0];
    return body instanceof Response ? body : Response.json(body);
  });
});
afterEach(() => vi.restoreAllMocks());

describe('instagram.verify', () => {
  it('limits', () => {
    expect(instagram.maxLength({})).toBe(2200);
    expect(instagram.countLength('a😀')).toBe(2);
  });

  it('returns the username', async () => {
    routes['/me?fields=username'] = [{ username: 'alice' }];
    expect(await instagram.verify(creds)).toEqual({ accountName: 'alice', settings: {} });
    expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/me?fields=username&access_token=TOK`);
  });

  it('throws the API error message', async () => {
    routes['/me?fields=username'] = [Response.json({ error: { message: 'Invalid OAuth access token' } }, { status: 400 })];
    await expect(instagram.verify(creds)).rejects.toThrow('Instagram 400: Invalid OAuth access token');
  });

  it('falls back to the raw body', async () => {
    routes['/me?fields=username'] = [Response.json({ weird: 1 }, { status: 500 })];
    await expect(instagram.verify(creds)).rejects.toThrow('Instagram 500: {"weird":1}');
  });
});

describe('instagram.post', () => {
  it('requires media of supported types', async () => {
    await expect(instagram.post(ctx([]))).rejects.toThrow('requires at least one');
    await expect(instagram.post(ctx([media('image/png')]))).rejects.toThrow('only JPEG images and MP4 videos, got image/png');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('publishes a single image', async () => {
    routes['/U1/media'] = [{ id: 'C1' }];
    routes['/U1/media_publish'] = [{ id: 'M1' }];
    routes['/M1?fields=permalink'] = [{ permalink: 'https://instagram.com/p/x' }];
    expect(await instagram.post(ctx([media('image/jpeg')]))).toEqual({ id: 'M1', url: 'https://instagram.com/p/x', ref: { id: 'M1' } });
    expect(calls()).toEqual([
      [`${BASE}/U1/media`, { image_url: 'https://s3/1', caption: 'caption', access_token: 'TOK' }],
      [`${BASE}/U1/media_publish`, { creation_id: 'C1', access_token: 'TOK' }],
      [`${BASE}/M1?fields=permalink&access_token=TOK`],
    ]);
  });

  it('publishes a single video as REELS after polling', async () => {
    routes['/U1/media'] = [{ id: 'C1' }];
    routes['/C1?fields=status_code'] = [{ status_code: 'IN_PROGRESS' }, { status_code: 'FINISHED' }];
    routes['/U1/media_publish'] = [{ id: 'M1' }];
    routes['/M1?fields=permalink'] = [{ permalink: 'p' }];
    await instagram.post(ctx([media('video/mp4')]));
    expect(calls()[0]).toEqual([`${BASE}/U1/media`, { video_url: 'https://s3/1', media_type: 'REELS', caption: 'caption', access_token: 'TOK' }]);
    expect(calls().filter(([u]) => String(u).includes('status_code'))).toHaveLength(2);
  });

  it('publishes a carousel', async () => {
    routes['/U1/media'] = [{ id: 'A' }, { id: 'B' }, { id: 'CAR' }];
    routes['/B?fields=status_code'] = [{ status_code: 'FINISHED' }];
    routes['/CAR?fields=status_code'] = [{ status_code: 'FINISHED' }];
    routes['/U1/media_publish'] = [{ id: 'M1' }];
    routes['/M1?fields=permalink'] = [{ permalink: 'p' }];
    await instagram.post(ctx([media('image/jpeg', 1), media('video/mp4', 2)]));
    expect(calls()).toEqual([
      [`${BASE}/U1/media`, { image_url: 'https://s3/1', is_carousel_item: 'true', access_token: 'TOK' }],
      [`${BASE}/U1/media`, { video_url: 'https://s3/2', media_type: 'VIDEO', is_carousel_item: 'true', access_token: 'TOK' }],
      [`${BASE}/B?fields=status_code&access_token=TOK`],
      [`${BASE}/U1/media`, { media_type: 'CAROUSEL', children: 'A,B', caption: 'caption', access_token: 'TOK' }],
      [`${BASE}/CAR?fields=status_code&access_token=TOK`],
      [`${BASE}/U1/media_publish`, { creation_id: 'CAR', access_token: 'TOK' }],
      [`${BASE}/M1?fields=permalink&access_token=TOK`],
    ]);
  });

  it('throws when processing errors', async () => {
    routes['/U1/media'] = [{ id: 'C1' }];
    routes['/C1?fields=status_code'] = [{ status_code: 'ERROR' }];
    await expect(instagram.post(ctx([media('video/mp4')]))).rejects.toThrow('C1 failed processing');
  });

  it('gives up after bounded polling', async () => {
    poll.attempts = 2;
    routes['/U1/media'] = [{ id: 'C1' }];
    routes['/C1?fields=status_code'] = [{ status_code: 'IN_PROGRESS' }];
    await expect(instagram.post(ctx([media('video/mp4')]))).rejects.toThrow('C1 not ready in time');
    poll.attempts = 60;
  });
});
