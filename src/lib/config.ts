import { z } from 'zod';

const bool = (def: 'true' | 'false') => z.stringbool().default(def === 'true');
const int = (def: number) => z.coerce.number().int().positive().default(def);

const schema = z
  .object({
    NODE_ENV: z.string().default('development'),
    APP_NAME: z.string().min(1).default('Multiposter'),
    APP_URL: z.url().default('http://localhost:3000'),
    APP_SECRET: z.string().min(32),
    DATABASE_URL: z.string().min(1),
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('multiposter'),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool('true'),
    S3_PUBLIC_URL: z.url().optional(),
    TINYPNG_API_KEY: z.string().min(1).optional(),
    NOSTR_MEDIA_HOST: z.enum(['blossom', 'imgur']).default('blossom'),
    BLOSSOM_SERVER: z.url().default('https://blossom.primal.net'),
    IMGUR_CLIENT_ID: z.string().min(1).optional(),
    WORKER_ENABLED: bool('true'),
    WORKER_POLL_MS: int(10000),
    SESSION_TTL_DAYS: int(30),
    COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
    MAX_UPLOAD_MB: int(50),
    ALLOW_REGISTRATION: bool('true'),
  })
  .refine((c) => c.NOSTR_MEDIA_HOST !== 'imgur' || c.IMGUR_CLIENT_ID, {
    message: 'IMGUR_CLIENT_ID is required when NOSTR_MEDIA_HOST=imgur',
    path: ['IMGUR_CLIENT_ID'],
  })
  .transform(({ COOKIE_SECURE, S3_PUBLIC_URL, ...c }) => ({
    ...c,
    S3_PUBLIC_URL: S3_PUBLIC_URL?.replace(/\/+$/, ''),
    COOKIE_SECURE: COOKIE_SECURE === 'auto' ? c.NODE_ENV === 'production' : COOKIE_SECURE === 'true',
  }));

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

/** Parsed env, validated once on first call (never at import, so `next build` needs no env). */
export function getConfig(): Config {
  if (!cached) {
    // empty strings (e.g. `S3_PUBLIC_URL=` in .env) mean "unset"
    const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));
    cached = schema.parse(env);
  }
  return cached;
}

/** Drop the cached config so the next `getConfig()` re-reads env (tests). */
export function resetConfig() {
  cached = undefined;
}
