import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { resetConfig } from '../config';
import { tinify } from './tinify';

const input = Buffer.from('original');
const auth = `Basic ${Buffer.from('api:KEY').toString('base64')}`;
let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  vi.stubEnv('TINYPNG_API_KEY', 'KEY');
  resetConfig();
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('tinify', () => {
  it('shrinks then downloads from Location', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('{}', { status: 201, headers: { Location: 'https://api.tinify.com/output/abc' } }))
      .mockResolvedValueOnce(new Response('small'));
    expect((await tinify(input, 'image/png')).toString()).toBe('small');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.tinify.com/shrink');
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: auth } });
    expect(Buffer.from(init!.body as Uint8Array).toString()).toBe('original');
    expect(fetchSpy.mock.calls[1]).toEqual(['https://api.tinify.com/output/abc', { headers: { Authorization: auth } }]);
  });

  it('skips unsupported mimes and missing key', async () => {
    expect(await tinify(input, 'image/gif')).toBe(input);
    vi.stubEnv('TINYPNG_API_KEY', '');
    resetConfig();
    expect(await tinify(input, 'image/png')).toBe(input);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([429, 503])('keeps original on %i', async (status) => {
    fetchSpy.mockResolvedValueOnce(new Response('x', { status }));
    expect(await tinify(input, 'image/jpeg')).toBe(input);
    expect(console.warn).toHaveBeenCalled();
  });

  it('keeps original on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await tinify(input, 'image/webp')).toBe(input);
  });

  it('keeps original when Location is missing', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 201 }));
    expect(await tinify(input, 'image/png')).toBe(input);
  });

  it('keeps original when download 5xx', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('{}', { status: 201, headers: { Location: 'https://x/o' } }))
      .mockResolvedValueOnce(new Response('', { status: 502 }));
    expect(await tinify(input, 'image/png')).toBe(input);
  });

  it('throws on 401', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{"error":"Unauthorized"}', { status: 401 }));
    await expect(tinify(input, 'image/png')).rejects.toThrow('TinyPNG failed (401): {"error":"Unauthorized"}');
  });
});
