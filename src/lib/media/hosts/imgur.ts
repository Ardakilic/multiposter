/** Anonymous Imgur upload (Client-ID auth); alternative Nostr media host when NOSTR_MEDIA_HOST=imgur. */

export async function uploadToImgur(clientId: string, bytes: Buffer, mime: string) {
  const form = new FormData();
  form.append(mime.startsWith('video/') ? 'video' : 'image', new Blob([new Uint8Array(bytes)], { type: mime }));
  const res = await fetch('https://api.imgur.com/3/image', {
    method: 'POST',
    headers: { Authorization: `Client-ID ${clientId}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Imgur upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const { data } = (await res.json()) as { data: { link: string } };
  return { url: data.link };
}
