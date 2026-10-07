/** X connector (API v2, OAuth 1.0a user tokens). Length uses twitter-text weighting (URLs = 23, CJK = 2). */

import { TwitterApi, type EUploadMimeType } from 'twitter-api-v2';
import twitterText from 'twitter-text'; // ESM build only has a default export
import type { Connector } from './types';

const client = (c: Record<string, string>) =>
  new TwitterApi({ appKey: c.apiKey, appSecret: c.apiSecret, accessToken: c.accessToken, accessSecret: c.accessSecret });

export const x: Connector = {
  id: 'x',
  name: 'X',
  fields: [
    { name: 'apiKey', label: 'API key', required: true, help: 'X API is pay-per-use for new developers since 2026. The app must have Read+Write permission.' },
    { name: 'apiSecret', label: 'API secret', secret: true, required: true },
    { name: 'accessToken', label: 'Access token', required: true },
    { name: 'accessSecret', label: 'Access token secret', secret: true, required: true },
  ],
  capabilities: { images: true, video: true, threads: true, textOnly: true, maxMedia: 4 },
  maxLength: () => 280,
  countLength: (text) => twitterText.parseTweet(text).weightedLength,
  async verify(creds) {
    const { data } = await client(creds).v2.me();
    return { accountName: `@${data.username}`, settings: {} };
  },
  async post({ creds, text, media, parent }) {
    const v2 = client(creds).v2;
    const media_ids: string[] = [];
    for (const m of media) {
      const id = await v2.uploadMedia(await m.bytes(), { media_type: m.mime as EUploadMimeType });
      if (m.alt) await v2.createMediaMetadata(id, { alt_text: { text: m.alt } });
      media_ids.push(id);
    }
    const { data } = await v2.tweet({
      text,
      ...(media_ids.length && { media: { media_ids: media_ids as [string] } }),
      ...(parent && { reply: { in_reply_to_tweet_id: parent.id } }),
    });
    return { id: data.id, url: `https://x.com/i/web/status/${data.id}`, ref: { id: data.id } };
  },
};
