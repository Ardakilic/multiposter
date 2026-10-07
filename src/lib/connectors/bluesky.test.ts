import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bluesky } from './bluesky';
import type { MediaFile } from './types';

const agent = { login: vi.fn(), uploadBlob: vi.fn(), post: vi.fn() };
const ctor = vi.fn();
const detectFacets = vi.fn();
vi.mock('@atproto/api', () => ({
  AtpAgent: class {
    constructor(opts: unknown) {
      ctor(opts);
      return agent;
    }
  },
  RichText: class {
    text: string;
    facets = [{ f: 1 }];
    constructor({ text }: { text: string }) {
      this.text = text;
    }
    detectFacets = detectFacets;
  },
}));

const creds = { identifier: 'me.bsky.social', appPassword: 'pw', service: '' };
const img = (size = 100, alt?: string, mime = 'image/jpeg'): MediaFile => ({
  key: 'u/a.jpg', mime, size, alt, bytes: async () => Buffer.from('img'), url: async () => 'http://x',
});
const uri = 'at://did:plc:abc/app.bsky.feed.post/3kxyz';

beforeEach(() => {
  vi.clearAllMocks();
  agent.login.mockResolvedValue({ data: { handle: 'me.bsky.social' } });
  agent.post.mockResolvedValue({ uri, cid: 'cid1' });
});

describe('bluesky connector', () => {
  it('verify logs in against the default service and returns the handle', async () => {
    await expect(bluesky.verify(creds)).resolves.toEqual({ accountName: 'me.bsky.social', settings: {} });
    expect(ctor).toHaveBeenCalledWith({ service: 'https://bsky.social' });
    expect(agent.login).toHaveBeenCalledWith({ identifier: 'me.bsky.social', password: 'pw' });
  });

  it('verify honours a custom service and propagates bad creds', async () => {
    agent.login.mockRejectedValue(new Error('Invalid identifier or password'));
    await expect(bluesky.verify({ ...creds, service: 'https://pds.example' })).rejects.toThrow('Invalid identifier');
    expect(ctor).toHaveBeenCalledWith({ service: 'https://pds.example' });
  });

  it('posts text with facets and no embed/reply', async () => {
    const r = await bluesky.post({ creds, settings: {}, text: 'hello', media: [] });
    expect(detectFacets).toHaveBeenCalledWith(agent);
    expect(agent.post).toHaveBeenCalledWith({ text: 'hello', facets: [{ f: 1 }], createdAt: expect.any(String) });
    expect(r).toEqual({ id: uri, url: 'https://bsky.app/profile/me.bsky.social/post/3kxyz', ref: { uri, cid: 'cid1' } });
  });

  it('uploads images with alt (default empty) and sets reply root/parent', async () => {
    agent.uploadBlob.mockResolvedValueOnce({ data: { blob: 'b1' } }).mockResolvedValueOnce({ data: { blob: 'b2' } });
    const root = { uri: 'at://r', cid: 'rc' };
    const parent = { uri: 'at://p', cid: 'pc' };
    await bluesky.post({ creds, settings: {}, text: 't', media: [img(976_560, 'dog'), img(10, undefined, 'image/png')], root, parent });
    expect(agent.uploadBlob).toHaveBeenNthCalledWith(1, Buffer.from('img'), { encoding: 'image/jpeg' });
    expect(agent.uploadBlob).toHaveBeenNthCalledWith(2, Buffer.from('img'), { encoding: 'image/png' });
    expect(agent.post.mock.calls[0][0]).toMatchObject({
      embed: { $type: 'app.bsky.embed.images', images: [{ image: 'b1', alt: 'dog' }, { image: 'b2', alt: '' }] },
      reply: { root, parent },
    });
  });

  it('uses parent as root when root is missing', async () => {
    const parent = { uri: 'at://p', cid: 'pc' };
    await bluesky.post({ creds, settings: {}, text: 't', media: [], parent });
    expect(agent.post.mock.calls[0][0].reply).toEqual({ root: parent, parent });
  });

  it('rejects oversized images and video before logging in', async () => {
    await expect(bluesky.post({ creds, settings: {}, text: 't', media: [img(976_561)] })).rejects.toThrow('≤ 976560 bytes');
    await expect(bluesky.post({ creds, settings: {}, text: 't', media: [img(10, '', 'video/mp4')] })).rejects.toThrow('does not support video/mp4');
    expect(agent.login).not.toHaveBeenCalled();
  });
});
