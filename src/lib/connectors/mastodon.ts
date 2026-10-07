import { codePoints } from '../text/count';
import type { Connector } from './types';

export type MastodonSettings = {
  maxChars?: number;
  maxMedia?: number;
  charsPerUrl?: number;
  imageSizeLimit?: number;
  videoSizeLimit?: number;
};

const CHARS_PER_URL = 23; // instance default; countLength has no settings in the contract

/** Media poll knobs; exported so tests can zero the delay. */
export const mediaPoll = { attempts: 30, delayMs: 2000 };

async function api(creds: Record<string, string>, path: string, init: RequestInit = {}) {
  const host = creds.host.trim().replace(/\/+$/, '');
  const base = /^https?:\/\//.test(host) ? host : `https://${host}`;
  const res = await fetch(base + path, {
    ...init,
    headers: { Authorization: `Bearer ${creds.accessToken}`, ...init.headers },
  });
  if (!res.ok) throw new Error(`Mastodon ${init.method ?? 'GET'} ${path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { status: res.status, body: await res.json() };
}

async function upload(creds: Record<string, string>, m: { mime: string; key: string; alt?: string; bytes(): Promise<Buffer> }) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(await m.bytes())], { type: m.mime }), m.key.split('/').pop());
  if (m.alt) form.append('description', m.alt);
  let { status, body } = await api(creds, '/api/v2/media', { method: 'POST', body: form });
  for (let i = 0; status !== 200; i++) {
    if (i === mediaPoll.attempts) throw new Error(`Mastodon media ${body.id} still processing`);
    await new Promise((r) => setTimeout(r, mediaPoll.delayMs));
    ({ status, body } = await api(creds, `/api/v1/media/${body.id}`));
  }
  return body.id as string;
}

export const mastodon: Connector<Record<string, string>, MastodonSettings> = {
  id: 'mastodon',
  name: 'Mastodon',
  fields: [
    { name: 'host', label: 'Instance URL', required: true, placeholder: 'https://mastodon.social' },
    { name: 'accessToken', label: 'Access token', secret: true, required: true, help: 'Preferences → Development → New application, scopes: write:statuses write:media read:accounts.' },
  ],
  capabilities: { images: true, video: true, threads: true, textOnly: true, maxMedia: 4 },
  maxLength: (s) => s.maxChars ?? 500,
  countLength: (text) => codePoints(text.replace(/https?:\/\/\S+/g, 'x'.repeat(CHARS_PER_URL))),
  async verify(creds) {
    const { body: me } = await api(creds, '/api/v1/accounts/verify_credentials');
    const { body: inst } = await api(creds, '/api/v2/instance');
    const st = inst.configuration?.statuses ?? {};
    const ma = inst.configuration?.media_attachments ?? {};
    return {
      accountName: me.acct,
      settings: {
        maxChars: st.max_characters ?? 500,
        maxMedia: st.max_media_attachments ?? 4,
        charsPerUrl: st.characters_reserved_per_url ?? CHARS_PER_URL,
        imageSizeLimit: ma.image_size_limit,
        videoSizeLimit: ma.video_size_limit,
      },
    };
  },
  async post({ creds, text, media, parent }) {
    const media_ids = [];
    for (const m of media) media_ids.push(await upload(creds, m));
    const { body } = await api(creds, '/api/v1/statuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: text, media_ids, in_reply_to_id: parent?.id }),
    });
    return { id: body.id, url: body.url, ref: { id: body.id } };
  },
};
