import { describe, expect, it } from 'vitest';
import { bluesky } from './bluesky';
import { connectors, getConnector } from './index';
import { instagram } from './instagram';
import { mastodon } from './mastodon';
import { nostr } from './nostr';
import { x } from './x';

describe('registry', () => {
  it('registers every connector under its id', () => {
    expect(Object.keys(connectors)).toEqual(['x', 'bluesky', 'mastodon', 'nostr', 'instagram']);
    for (const [id, c] of Object.entries(connectors)) expect(getConnector(id)).toBe(c);
  });

  it('throws on unknown ids, including prototype keys', () => {
    expect(() => getConnector('myspace')).toThrow('unknown connector: myspace');
    expect(() => getConnector('toString')).toThrow('unknown connector');
  });
});

describe('limits and counting', () => {
  it('x: 280 weighted, URLs count 23, CJK double', () => {
    expect(x.maxLength({})).toBe(280);
    expect(x.countLength('hello')).toBe(5);
    expect(x.countLength('https://example.com/' + 'a'.repeat(100))).toBe(23);
    expect(x.countLength('日本')).toBe(4);
    expect(x.fields.map((f) => f.name)).toEqual(['apiKey', 'apiSecret', 'accessToken', 'accessSecret']);
    expect(x.capabilities).toEqual({ images: true, video: true, threads: true, textOnly: true, maxMedia: 4 });
  });

  it('bluesky: 300 graphemes, no video', () => {
    expect(bluesky.maxLength({})).toBe(300);
    expect(bluesky.countLength('👨‍👩‍👧‍👦a')).toBe(2);
    expect(bluesky.fields.map((f) => f.name)).toEqual(['identifier', 'appPassword', 'service']);
    expect(bluesky.capabilities.video).toBe(false);
  });

  it('mastodon: settings-driven max, URLs as 23 chars, code points', () => {
    expect(mastodon.maxLength({})).toBe(500);
    expect(mastodon.maxLength({ maxChars: 1000 })).toBe(1000);
    expect(mastodon.countLength('see https://example.com/' + 'a'.repeat(100) + ' ok')).toBe(4 + 23 + 3);
    expect(mastodon.countLength('😀')).toBe(1);
    expect(mastodon.fields.map((f) => f.name)).toEqual(['host', 'accessToken']);
  });

  it('nostr: 5000 code points', () => {
    expect(nostr.maxLength({})).toBe(5000);
    expect(nostr.countLength('a😀')).toBe(2);
    expect(nostr.fields.map((f) => f.name)).toEqual(['privateKey', 'relays', 'mediaServer']);
    expect(nostr.capabilities.maxMedia).toBe(10);
  });

  it('instagram: 2200, media-only, no threads', () => {
    expect(instagram.maxLength({})).toBe(2200);
    expect(instagram.countLength('a😀')).toBe(2);
    expect(instagram.fields.map((f) => f.name)).toEqual(['igUserId', 'accessToken']);
    expect(instagram.capabilities).toMatchObject({ threads: false, textOnly: false, maxMedia: 10 });
  });
});
