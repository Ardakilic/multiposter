import { createHash } from 'node:crypto';
import { finalizeEvent } from 'nostr-tools/pure';

/** BUD-02 upload with a kind 24242 auth event signed by `secretKey`. */
export async function uploadToBlossom(server: string, bytes: Buffer, mime: string, secretKey: Uint8Array) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const now = Math.floor(Date.now() / 1000);
  const auth = finalizeEvent(
    { kind: 24242, created_at: now, content: 'Upload', tags: [['t', 'upload'], ['x', sha256], ['expiration', String(now + 300)]] },
    secretKey,
  );
  const res = await fetch(`${server.replace(/\/+$/, '')}/upload`, {
    method: 'PUT',
    headers: {
      Authorization: `Nostr ${Buffer.from(JSON.stringify(auth)).toString('base64')}`,
      'Content-Type': mime,
      'Content-Length': String(bytes.length),
      'X-SHA-256': sha256,
    },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) throw new Error(`Blossom upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const { url } = (await res.json()) as { url: string };
  return { url, sha256 };
}
