import * as nip19 from 'nostr-tools/nip19';
import { getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfig } from '../config';
import { uploadToBlossom } from '../media/hosts/blossom';
import { uploadToImgur } from '../media/hosts/imgur';
import type { MediaFile } from './types';

const pool = vi.hoisted(() => ({ publish: vi.fn(), close: vi.fn() }));
vi.mock('nostr-tools/pool', () => ({ SimplePool: vi.fn(function () { return pool; }) }));
vi.mock('../media/hosts/blossom', () => ({ uploadToBlossom: vi.fn() }));
vi.mock('../media/hosts/imgur', () => ({ uploadToImgur: vi.fn() }));

const { nostr } = await import('./nostr');

const hex = '5'.repeat(64);
const sk = Uint8Array.from(Buffer.from(hex, 'hex'));
const pk = getPublicKey(sk);
const nsec = nip19.nsecEncode(sk);
const media = (mime: string, alt?: string): MediaFile => ({
  key: 'k', mime, size: 3, alt, bytes: async () => Buffer.from('abc'), url: async () => 'https://s3/k',
});
const ctx = { creds: { privateKey: nsec, relays: '', mediaServer: '' }, settings: {}, text: 'hello', media: [] as MediaFile[] };

beforeEach(() => {
  pool.publish.mockReset().mockImplementation((relays: string[]) => relays.map(() => Promise.resolve('ok')));
  pool.close.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('nostr.verify', () => {
  it('limits', () => {
    expect(nostr.maxLength({})).toBe(5000);
    expect(nostr.countLength('a😀')).toBe(2);
  });

  it('accepts nsec and hex keys', async () => {
    const npub = nip19.npubEncode(pk);
    expect(await nostr.verify({ privateKey: nsec })).toEqual({ accountName: npub, settings: {} });
    expect(await nostr.verify({ privateKey: ` ${hex.toUpperCase()} ` })).toEqual({ accountName: npub, settings: {} });
  });

  it.each(['', 'abc', nip19.npubEncode(pk).replace('npub', 'nsec'), 'nsec1invalid'])('rejects %j', async (privateKey) => {
    await expect(nostr.verify({ privateKey })).rejects.toThrow();
  });
});

describe('nostr.post', () => {
  it('publishes a signed kind 1 note to default relays', async () => {
    const r = await nostr.post(ctx);
    const [relays, ev] = pool.publish.mock.calls[0];
    expect(relays).toEqual(['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']);
    expect(verifyEvent(ev)).toBe(true);
    expect(ev).toMatchObject({ kind: 1, content: 'hello', tags: [], pubkey: pk });
    expect(r).toEqual({ id: ev.id, url: `https://njump.me/${nip19.noteEncode(ev.id)}`, ref: { id: ev.id } });
    expect(pool.close).toHaveBeenCalledWith(relays);
  });

  it('uploads media to blossom, appends urls and imeta, and adds NIP-10 reply tags', async () => {
    vi.mocked(uploadToBlossom)
      .mockResolvedValueOnce({ url: 'https://b/1.png', sha256: 'aa' })
      .mockResolvedValueOnce({ url: 'https://b/2.mp4', sha256: 'bb' });
    await nostr.post({
      ...ctx,
      creds: { ...ctx.creds, relays: ' wss://a , wss://b,', mediaServer: 'https://my.blossom' },
      media: [media('image/png', 'a cat'), media('video/mp4')],
      root: { id: 'r1' },
      parent: { id: 'p1' },
    });
    expect(uploadToBlossom).toHaveBeenCalledWith('https://my.blossom', Buffer.from('abc'), 'image/png', sk);
    const [relays, ev] = pool.publish.mock.calls[0];
    expect(relays).toEqual(['wss://a', 'wss://b']);
    expect(ev.content).toBe('hello\nhttps://b/1.png\nhttps://b/2.mp4');
    expect(ev.tags).toEqual([
      ['imeta', 'url https://b/1.png', 'm image/png', 'x aa', 'alt a cat'],
      ['imeta', 'url https://b/2.mp4', 'm video/mp4', 'x bb'],
      ['e', 'r1', '', 'root', pk],
      ['e', 'p1', '', 'reply', pk],
      ['p', pk],
    ]);
  });

  it('uses BLOSSOM_SERVER by default and parent as root when root is missing', async () => {
    vi.mocked(uploadToBlossom).mockResolvedValueOnce({ url: 'https://b/1.png', sha256: 'aa' });
    await nostr.post({ ...ctx, media: [media('image/png')], parent: { id: 'p1' } });
    expect(uploadToBlossom).toHaveBeenLastCalledWith('https://blossom.primal.net', expect.any(Buffer), 'image/png', sk);
    expect(pool.publish.mock.calls[0][1].tags).toContainEqual(['e', 'p1', '', 'root', pk]);
  });

  it('uploads via imgur when configured (no x tag)', async () => {
    vi.stubEnv('NOSTR_MEDIA_HOST', 'imgur');
    vi.stubEnv('IMGUR_CLIENT_ID', 'CID');
    resetConfig();
    vi.mocked(uploadToImgur).mockResolvedValueOnce({ url: 'https://i.imgur.com/x.png' });
    await nostr.post({ ...ctx, media: [media('image/png')] });
    expect(uploadToImgur).toHaveBeenCalledWith('CID', Buffer.from('abc'), 'image/png');
    expect(pool.publish.mock.calls[0][1].tags).toEqual([['imeta', 'url https://i.imgur.com/x.png', 'm image/png']]);
  });

  it('throws when imgur has no client id', async () => {
    // bypass the config refine by mocking getConfig's result
    const config = await import('../config');
    vi.spyOn(config, 'getConfig').mockReturnValueOnce({ ...config.getConfig(), NOSTR_MEDIA_HOST: 'imgur', IMGUR_CLIENT_ID: undefined });
    await expect(nostr.post({ ...ctx, media: [media('image/png')] })).rejects.toThrow('IMGUR_CLIENT_ID is required');
  });

  it('succeeds when at least one relay accepts', async () => {
    pool.publish.mockImplementationOnce(() => [Promise.reject(new Error('blocked')), Promise.resolve('ok')]);
    await expect(nostr.post(ctx)).resolves.toHaveProperty('id');
  });

  it('throws with relay errors when none accept, and still closes the pool', async () => {
    pool.publish.mockImplementationOnce(() => [Promise.reject(new Error('blocked')), Promise.reject(new Error('timeout'))]);
    await expect(nostr.post({ ...ctx, creds: { ...ctx.creds, relays: 'wss://a,wss://b' } })).rejects.toThrow(
      'No relay accepted the event: wss://a: Error: blocked; wss://b: Error: timeout',
    );
    expect(pool.close).toHaveBeenCalledWith(['wss://a', 'wss://b']);
  });
});
