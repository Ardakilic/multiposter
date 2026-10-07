/**
 * Nostr connector: signs kind-1 notes and publishes to relays; success means at least one relay accepted.
 * Relays only carry text, so media goes to a Blossom server (or Imgur) and is linked via URL + `imeta` tags.
 */

import * as nip19 from 'nostr-tools/nip19';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { getConfig } from '../config';
import { uploadToBlossom } from '../media/hosts/blossom';
import { uploadToImgur } from '../media/hosts/imgur';
import { codePoints } from '../text/count';
import type { Connector, MediaFile } from './types';

const DEFAULT_RELAYS = 'wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net';

function secretKey(key: string): Uint8Array {
  const k = key.trim();
  if (k.startsWith('nsec1')) {
    const d = nip19.decode(k);
    if (d.type === 'nsec') return d.data;
  } else if (/^[0-9a-f]{64}$/i.test(k)) {
    return Uint8Array.from(Buffer.from(k, 'hex'));
  }
  throw new Error('Invalid Nostr private key: expected nsec1… or 64-char hex');
}

async function upload(m: MediaFile, mediaServer: string | undefined, sk: Uint8Array): Promise<{ url: string; sha256?: string }> {
  const c = getConfig();
  if (c.NOSTR_MEDIA_HOST === 'imgur') {
    if (!c.IMGUR_CLIENT_ID) throw new Error('IMGUR_CLIENT_ID is required for Nostr media via Imgur');
    return uploadToImgur(c.IMGUR_CLIENT_ID, await m.bytes(), m.mime);
  }
  return uploadToBlossom(mediaServer || c.BLOSSOM_SERVER, await m.bytes(), m.mime, sk);
}

export const nostr: Connector = {
  id: 'nostr',
  name: 'Nostr',
  fields: [
    { name: 'privateKey', label: 'Private key (nsec or hex)', secret: true, required: true, help: 'Stored encrypted on this server.' },
    { name: 'relays', label: 'Relays', placeholder: DEFAULT_RELAYS, help: 'Comma-separated wss:// URLs.' },
    { name: 'mediaServer', label: 'Blossom server', placeholder: 'https://blossom.primal.net', help: 'Optional override for media uploads.' },
  ],
  capabilities: { images: true, video: true, threads: true, textOnly: true, maxMedia: 10 },
  maxLength: () => 5000,
  countLength: codePoints,
  async verify(creds) {
    return { accountName: nip19.npubEncode(getPublicKey(secretKey(creds.privateKey))), settings: {} };
  },
  async post({ creds, text, media, root, parent }) {
    const sk = secretKey(creds.privateKey);
    const pk = getPublicKey(sk);
    const tags: string[][] = [];
    const urls: string[] = [];
    for (const m of media) {
      const { url, sha256 } = await upload(m, creds.mediaServer, sk);
      urls.push(url);
      const imeta = ['imeta', `url ${url}`, `m ${m.mime}`];
      if (sha256) imeta.push(`x ${sha256}`);
      if (m.alt) imeta.push(`alt ${m.alt}`);
      tags.push(imeta);
    }
    if (parent) {
      tags.push(['e', (root ?? parent).id, '', 'root', pk], ['e', parent.id, '', 'reply', pk], ['p', pk]);
    }
    const content = urls.length ? `${text}\n${urls.join('\n')}` : text;
    const event = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags, content }, sk);

    const relays = (creds.relays || DEFAULT_RELAYS).split(',').map((r) => r.trim()).filter(Boolean);
    const pool = new SimplePool();
    try {
      const results = await Promise.allSettled(pool.publish(relays, event));
      if (!results.some((r) => r.status === 'fulfilled')) {
        const errors = results.map((r, i) => `${relays[i]}: ${(r as PromiseRejectedResult).reason}`);
        throw new Error(`No relay accepted the event: ${errors.join('; ')}`);
      }
    } finally {
      pool.close(relays);
    }
    return { id: event.id, url: `https://njump.me/${nip19.noteEncode(event.id)}`, ref: { id: event.id } };
  },
};
