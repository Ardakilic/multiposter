import { DeleteBucketCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfig, resetConfig } from './config';
import { ensureBucket, getObject, objectUrl, putObject } from './storage';

afterEach(() => vi.unstubAllEnvs());

describe('storage (S3Mock)', () => {
  it('puts and gets bytes', async () => {
    const body = Buffer.from([0, 1, 2, 255]);
    await putObject('t/a.bin', body, 'application/octet-stream');
    expect(await getObject('t/a.bin')).toEqual(body);
  });

  it('presigns a GET URL that serves the object', async () => {
    await putObject('t/b.txt', Buffer.from('hello'), 'text/plain');
    const url = await objectUrl('t/b.txt');
    expect(url).toContain('X-Amz-Expires=3600');
    const res = await fetch(url);
    expect(await res.text()).toBe('hello');
  });

  it('uses S3_PUBLIC_URL when set', async () => {
    vi.stubEnv('S3_PUBLIC_URL', 'https://cdn.example.com/');
    resetConfig();
    expect(await objectUrl('media/x.png')).toBe('https://cdn.example.com/media/x.png');
  });

  it('ensureBucket is idempotent and creates missing buckets', async () => {
    await ensureBucket();
    const Bucket = `fresh-${Date.now()}`;
    vi.stubEnv('S3_BUCKET', Bucket);
    resetConfig();
    try {
      await ensureBucket();
      await putObject('k', Buffer.from('x'), 'text/plain');
      expect((await getObject('k')).toString()).toBe('x');
    } finally {
      const c = getConfig();
      const s3 = new S3Client({
        endpoint: c.S3_ENDPOINT,
        region: c.S3_REGION,
        forcePathStyle: c.S3_FORCE_PATH_STYLE,
        credentials: { accessKeyId: c.S3_ACCESS_KEY, secretAccessKey: c.S3_SECRET_KEY },
      });
      await s3.send(new DeleteObjectCommand({ Bucket, Key: 'k' }));
      await s3.send(new DeleteBucketCommand({ Bucket }));
    }
  });
});
