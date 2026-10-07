import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetConfig } from '../config';
import { getObject } from '../storage';
import { storeUpload, toMediaFile } from './upload';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('storeUpload (S3Mock)', () => {
  it('stores a File under media/{uuid}.{ext}', async () => {
    const r = await storeUpload(new File([Buffer.from('pngdata')], 'a.png', { type: 'image/png' }));
    expect(r).toMatchObject({ mime: 'image/png', size: 7 });
    expect(r.key).toMatch(/^media\/[0-9a-f-]{36}\.png$/);
    expect((await getObject(r.key)).toString()).toBe('pngdata');
  });

  it('stores raw bytes and maps quicktime to .mov', async () => {
    const r = await storeUpload({ bytes: Buffer.from('mov'), mime: 'video/quicktime', name: 'v.mov' });
    expect(r.key).toMatch(/\.mov$/);
  });

  it('rejects unsupported types', async () => {
    await expect(storeUpload({ bytes: Buffer.from('x'), mime: 'application/pdf', name: 'a.pdf' })).rejects.toThrow(
      'a.pdf: unsupported file type application/pdf',
    );
    await expect(storeUpload(new File(['x'], 'noext'))).rejects.toThrow('unsupported file type unknown');
  });

  it('rejects files over MAX_UPLOAD_MB', async () => {
    vi.stubEnv('MAX_UPLOAD_MB', '1');
    resetConfig();
    const big = { bytes: Buffer.alloc(1024 * 1024 + 1), mime: 'image/gif', name: 'big.gif' };
    await expect(storeUpload(big)).rejects.toThrow('big.gif: file is larger than 1 MB');
  });

  it('tinifies when TINYPNG_API_KEY is set', async () => {
    vi.stubEnv('TINYPNG_API_KEY', 'KEY');
    resetConfig();
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      if (url === 'https://api.tinify.com/shrink') return Promise.resolve(new Response('{}', { status: 201, headers: { Location: 'https://t/o' } }));
      if (url === 'https://t/o') return Promise.resolve(new Response('tiny'));
      return real(url, init);
    });
    const r = await storeUpload({ bytes: Buffer.from('bigjpeg'), mime: 'image/jpeg', name: 'a.jpg' });
    expect(r).toMatchObject({ mime: 'image/jpeg', size: 4 });
    expect((await getObject(r.key)).toString()).toBe('tiny');
  });
});

describe('toMediaFile', () => {
  it('wraps a media row', async () => {
    const { key } = await storeUpload({ bytes: Buffer.from('gif'), mime: 'image/gif', name: 'a.gif' });
    const m = toMediaFile({ storageKey: key, mime: 'image/gif', size: 3, alt: null });
    expect(m).toMatchObject({ key, mime: 'image/gif', size: 3, alt: undefined });
    expect((await m.bytes()).toString()).toBe('gif');
    expect(await m.url()).toContain(key);
    expect(toMediaFile({ storageKey: key, mime: 'image/gif', size: 3, alt: 'a cat' }).alt).toBe('a cat');
  });
});
