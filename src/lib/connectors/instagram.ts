/**
 * Instagram connector (Graph API, Instagram Login). Instagram fetches media itself, so `m.url()` must be
 * publicly reachable (S3_PUBLIC_URL or presigned URL); videos and carousels are polled until FINISHED before publishing.
 */

import { codePoints } from '../text/count';
import type { Connector } from './types';

const BASE = 'https://graph.instagram.com/v25.0';
/** Container status polling: attempts x delayMs (default 5 min). */
export const poll = { attempts: 60, delayMs: 5000 }; // ponytail: mutable so tests can zero the delay

async function graph(path: string, token: string, params?: Record<string, string>) {
  const res = params
    ? await fetch(`${BASE}${path}`, { method: 'POST', body: new URLSearchParams({ ...params, access_token: token }) })
    : await fetch(`${BASE}${path}&access_token=${encodeURIComponent(token)}`);
  const body = await res.json();
  if (!res.ok) throw new Error(`Instagram ${res.status}: ${body?.error?.message ?? JSON.stringify(body)}`);
  return body as Record<string, string>;
}

async function waitFinished(id: string, token: string) {
  for (let i = 0; i < poll.attempts; i++) {
    const { status_code } = await graph(`/${id}?fields=status_code`, token);
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR') throw new Error(`Instagram media container ${id} failed processing`);
    await new Promise((r) => setTimeout(r, poll.delayMs));
  }
  throw new Error(`Instagram media container ${id} not ready in time`);
}

export const instagram: Connector = {
  id: 'instagram',
  name: 'Instagram',
  fields: [
    { name: 'igUserId', label: 'Instagram user ID', required: true },
    { name: 'accessToken', label: 'Access token', secret: true, required: true, help: 'Long-lived token (Instagram Login, professional account) with instagram_business_basic and instagram_business_content_publish. Media must be publicly fetchable (S3_PUBLIC_URL or presigned URLs).' },
  ],
  capabilities: { images: true, video: true, threads: false, textOnly: false, maxMedia: 10 },
  maxLength: () => 2200,
  countLength: codePoints,
  async verify({ accessToken }) {
    const { username } = await graph('/me?fields=username', accessToken);
    return { accountName: username, settings: {} };
  },
  async post({ creds: { igUserId, accessToken }, text, media }) {
    if (!media.length) throw new Error('Instagram requires at least one image or video');
    for (const m of media) {
      if (m.mime !== 'image/jpeg' && m.mime !== 'video/mp4') throw new Error(`Instagram accepts only JPEG images and MP4 videos, got ${m.mime}`);
    }
    const item = async (m: (typeof media)[number]): Promise<Record<string, string>> =>
      m.mime === 'video/mp4' ? { video_url: await m.url(), media_type: 'REELS' } : { image_url: await m.url() };
    const create = (params: Record<string, string>) => graph(`/${igUserId}/media`, accessToken, params).then((r) => r.id);

    let creationId: string;
    if (media.length === 1) {
      creationId = await create({ ...(await item(media[0])), caption: text });
      if (media[0].mime === 'video/mp4') await waitFinished(creationId, accessToken);
    } else {
      const children: string[] = [];
      for (const m of media) {
        // carousel children use media_type VIDEO, not REELS
        const video = m.mime === 'video/mp4';
        const id = await create({ ...(await item(m)), ...(video && { media_type: 'VIDEO' }), is_carousel_item: 'true' });
        if (video) await waitFinished(id, accessToken);
        children.push(id);
      }
      creationId = await create({ media_type: 'CAROUSEL', children: children.join(','), caption: text });
      await waitFinished(creationId, accessToken);
    }
    const { id } = await graph(`/${igUserId}/media_publish`, accessToken, { creation_id: creationId });
    const { permalink } = await graph(`/${id}?fields=permalink`, accessToken);
    return { id, url: permalink, ref: { id } };
  },
};
