import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaFile } from './types';
import { x } from './x';

const v2 = { me: vi.fn(), uploadMedia: vi.fn(), createMediaMetadata: vi.fn(), tweet: vi.fn() };
const ctor = vi.fn();
vi.mock('twitter-api-v2', () => ({
  TwitterApi: class {
    v2 = v2;
    constructor(opts: unknown) {
      ctor(opts);
    }
  },
}));

const creds = { apiKey: 'k', apiSecret: 's', accessToken: 't', accessSecret: 'ts' };
const file = (mime: string, alt?: string): MediaFile => ({
  key: `u/${mime}`, mime, size: 3, alt, bytes: async () => Buffer.from(mime), url: async () => 'http://x',
});

beforeEach(() => vi.clearAllMocks());

describe('x connector', () => {
  it('verify returns @username using OAuth 1.0a keys', async () => {
    v2.me.mockResolvedValue({ data: { username: 'arda' } });
    await expect(x.verify(creds)).resolves.toEqual({ accountName: '@arda', settings: {} });
    expect(ctor).toHaveBeenCalledWith({ appKey: 'k', appSecret: 's', accessToken: 't', accessSecret: 'ts' });
  });

  it('verify propagates bad credentials', async () => {
    v2.me.mockRejectedValue(new Error('401 Unauthorized'));
    await expect(x.verify(creds)).rejects.toThrow('401');
  });

  it('posts text only without media or reply keys', async () => {
    v2.tweet.mockResolvedValue({ data: { id: '1', text: 'hi' } });
    const r = await x.post({ creds, settings: {}, text: 'hi', media: [] });
    expect(v2.tweet).toHaveBeenCalledWith({ text: 'hi' });
    expect(r).toEqual({ id: '1', url: 'https://x.com/i/web/status/1', ref: { id: '1' } });
  });

  it('uploads media, sets alt only when given, replies to parent', async () => {
    v2.uploadMedia.mockResolvedValueOnce('m1').mockResolvedValueOnce('m2');
    v2.tweet.mockResolvedValue({ data: { id: '9' } });
    const r = await x.post({
      creds, settings: {}, text: 'pics', media: [file('image/png', 'a cat'), file('video/mp4')],
      root: { id: '5' }, parent: { id: '7' },
    });
    expect(v2.uploadMedia).toHaveBeenNthCalledWith(1, Buffer.from('image/png'), { media_type: 'image/png' });
    expect(v2.uploadMedia).toHaveBeenNthCalledWith(2, Buffer.from('video/mp4'), { media_type: 'video/mp4' });
    expect(v2.createMediaMetadata).toHaveBeenCalledOnce();
    expect(v2.createMediaMetadata).toHaveBeenCalledWith('m1', { alt_text: { text: 'a cat' } });
    expect(v2.tweet).toHaveBeenCalledWith({ text: 'pics', media: { media_ids: ['m1', 'm2'] }, reply: { in_reply_to_tweet_id: '7' } });
    expect(r.ref).toEqual({ id: '9' });
  });

  it('fails when upload fails, without tweeting', async () => {
    v2.uploadMedia.mockRejectedValue(new Error('413'));
    await expect(x.post({ creds, settings: {}, text: 't', media: [file('image/png')] })).rejects.toThrow('413');
    expect(v2.tweet).not.toHaveBeenCalled();
  });
});
