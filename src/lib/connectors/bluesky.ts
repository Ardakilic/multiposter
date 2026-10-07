/**
 * Bluesky connector (AT Protocol, app-password login). Images only, each ≤ 976,560 bytes; limits are
 * checked before logging in so a bad post fails fast. Length is counted in graphemes.
 */

import { AtpAgent, RichText } from '@atproto/api';
import { graphemes } from '../text/count';
import type { Connector } from './types';

const MAX_IMAGE_BYTES = 976_560;

async function login(c: Record<string, string>) {
  const agent = new AtpAgent({ service: c.service || 'https://bsky.social' });
  const { data } = await agent.login({ identifier: c.identifier, password: c.appPassword });
  return { agent, handle: data.handle };
}

export const bluesky: Connector = {
  id: 'bluesky',
  name: 'Bluesky',
  fields: [
    { name: 'identifier', label: 'Handle or email', required: true, placeholder: 'you.bsky.social' },
    { name: 'appPassword', label: 'App password', secret: true, required: true, help: 'Settings → Privacy and security → App passwords.' },
    { name: 'service', label: 'Service', placeholder: 'https://bsky.social', help: 'Leave empty for bsky.social.' },
  ],
  capabilities: { images: true, video: false, threads: true, textOnly: true, maxMedia: 4 },
  maxLength: () => 300,
  countLength: graphemes,
  async verify(creds) {
    return { accountName: (await login(creds)).handle, settings: {} };
  },
  async post({ creds, text, media, root, parent }) {
    for (const m of media) {
      if (!m.mime.startsWith('image/')) throw new Error(`Bluesky does not support ${m.mime} in v1 (images only)`);
      if (m.size > MAX_IMAGE_BYTES) throw new Error(`Bluesky images must be ≤ ${MAX_IMAGE_BYTES} bytes; ${m.key} is ${m.size}`);
    }
    const { agent, handle } = await login(creds);
    const images = [];
    for (const m of media) {
      const { data } = await agent.uploadBlob(await m.bytes(), { encoding: m.mime });
      images.push({ image: data.blob, alt: m.alt ?? '' });
    }
    const rt = new RichText({ text });
    await rt.detectFacets(agent);
    const ref = (r: Record<string, string>) => ({ uri: r.uri, cid: r.cid });
    const { uri, cid } = await agent.post({
      text: rt.text,
      facets: rt.facets,
      ...(images.length && { embed: { $type: 'app.bsky.embed.images', images } }),
      ...(parent && { reply: { root: ref(root ?? parent), parent: ref(parent) } }),
      createdAt: new Date().toISOString(),
    });
    return { id: uri, url: `https://bsky.app/profile/${handle}/post/${uri.split('/').pop()}`, ref: { uri, cid } };
  },
};
