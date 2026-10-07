import { randomUUID } from 'node:crypto';
import type { MediaFile } from '../connectors/types';
import { getConfig } from '../config';
import { getObject, objectUrl, putObject } from '../storage';
import { tinify } from './tinify';

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

type Input = File | { bytes: Buffer; mime: string; name: string };

/** Validate, optionally compress, and store an upload. Throws user-readable errors. */
export async function storeUpload(file: Input): Promise<{ key: string; mime: string; size: number }> {
  const [mime, name, size] = file instanceof File ? [file.type, file.name, file.size] : [file.mime, file.name, file.bytes.length];
  const ext = EXT[mime];
  if (!ext) throw new Error(`${name}: unsupported file type ${mime || 'unknown'} (allowed: PNG, JPEG, GIF, WebP, MP4, MOV)`);
  const max = getConfig().MAX_UPLOAD_MB;
  if (size > max * 1024 * 1024) throw new Error(`${name}: file is larger than ${max} MB`);
  const raw = file instanceof File ? Buffer.from(await file.arrayBuffer()) : file.bytes;
  const bytes = await tinify(raw, mime);
  const key = `media/${randomUUID()}.${ext}`;
  await putObject(key, bytes, mime);
  return { key, mime, size: bytes.length };
}

/** Wrap a media row as a lazy `MediaFile`: bytes/URL are fetched only if the connector needs them. */
export function toMediaFile(row: { storageKey: string; mime: string; size: number; alt?: string | null }): MediaFile {
  return {
    key: row.storageKey,
    mime: row.mime,
    size: row.size,
    alt: row.alt ?? undefined,
    bytes: () => getObject(row.storageKey),
    url: () => objectUrl(row.storageKey),
  };
}
