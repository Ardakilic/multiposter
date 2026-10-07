import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getConfig } from './config';

let client: S3Client | undefined;

function s3() {
  if (!client) {
    const c = getConfig();
    client = new S3Client({
      endpoint: c.S3_ENDPOINT,
      region: c.S3_REGION,
      forcePathStyle: c.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: c.S3_ACCESS_KEY, secretAccessKey: c.S3_SECRET_KEY },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return client;
}

const Bucket = () => getConfig().S3_BUCKET;

export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: Bucket(), Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: Bucket(), Key: key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}

/** Public URL when S3_PUBLIC_URL is set, else a presigned GET valid for 1h. */
export async function objectUrl(key: string): Promise<string> {
  const base = getConfig().S3_PUBLIC_URL;
  if (base) return `${base}/${key}`;
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: Bucket(), Key: key }), { expiresIn: 3600 });
}

/** Create the bucket if missing (called once at startup). */
export async function ensureBucket() {
  try {
    await s3().send(new HeadBucketCommand({ Bucket: Bucket() }));
  } catch {
    await s3().send(new CreateBucketCommand({ Bucket: Bucket() }));
  }
}
