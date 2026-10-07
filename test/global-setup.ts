import { Client } from 'pg';

// Tests never read .env: everything getConfig() needs is set here (inherited by test workers).
const env: Record<string, string> = {
  APP_SECRET: 'test-secret-test-secret-test-secret-0123',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/multiposter_test',
  S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:9090',
  S3_BUCKET: 'multiposter-test',
  S3_ACCESS_KEY: 'test',
  S3_SECRET_KEY: 'test',
  WORKER_ENABLED: 'false',
};

export default async function setup() {
  Object.assign(process.env, env);
  for (const k of ['S3_PUBLIC_URL', 'TINYPNG_API_KEY', 'IMGUR_CLIENT_ID', 'NOSTR_MEDIA_HOST']) delete process.env[k];

  const url = new URL(env.DATABASE_URL);
  const name = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
  } finally {
    await admin.end();
  }

  const { migrate, db } = await import('../src/lib/db/client');
  const { ensureBucket } = await import('../src/lib/storage');
  await migrate();
  await ensureBucket();
  await db.$client.end();
}
