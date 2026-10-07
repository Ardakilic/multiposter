# Multiposter — Spec

Self-hosted web app. Users register/login, connect several social accounts (many per provider, each with a
user-chosen label like `mastodon-work`), compose a post or a **flood** (ordered list of posts published as a reply
chain), attach images/videos, optionally schedule, optionally auto-split long text into threads per platform limit,
and see past + scheduled posts with per-target status and links.

Providers v1: X, Bluesky, Mastodon, Nostr, Instagram (nice-to-have, media-only). Connectors are pluggable:
one file + one registry line.

## 1. Stack

Versions checked against npm on 2026-10-08.

| Area | Choice |
|---|---|
| Runtime | Node 24, npm |
| Web | Next.js 16 (16.4) App Router, TS, Tailwind, ESLint, `src/`, Turbopack default; React 19 |
| DB | PostgreSQL 17, drizzle-orm 0.45 + pg, drizzle-kit 0.31; migrations committed in `drizzle/`, applied at startup |
| Validation | zod 4 (env + forms) |
| Storage | @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner; S3-compatible; `adobe/s3mock:5.2.3` locally/CI |
| SDKs | twitter-api-v2 1.29, @atproto/api 0.24, nostr-tools 2.25, twitter-text 3.1 |
| Tests | vitest 5 + @vitest/coverage-v8, @testing-library/react + jsdom, real Postgres + S3Mock |
| Ship | Docker multi-stage standalone image; docker compose (app, db, s3mock); GitHub Actions |

Deliberately absent: other ORMs, auth libs (stdlib scrypt + DB sessions), job queue (DB polling with
`FOR UPDATE SKIP LOCKED`), image libs (TinyPNG optional via 2 fetch calls), `proxy.ts`/middleware.

`@humanwhocodes/crosspost` was evaluated and is used only as reference for auth/request shapes, not as a dependency:
it lacks replies/threads, video, Instagram, and Nostr media (its Nostr strategy throws on images).

## 2. Repo layout

```
src/app/                 thin pages + server actions: (auth)/login, (auth)/register, connections, compose, posts, layout, page (redirect)
src/lib/config.ts        zod env -> memoized typed config (getConfig())
src/lib/db/schema.ts     drizzle tables
src/lib/db/client.ts     pg Pool + drizzle instance, migrate()
src/lib/auth/password.ts scrypt hash/verify
src/lib/auth/session.ts  create/destroy session, cookie, requireUser()
src/lib/crypto.ts        AES-256-GCM encrypt/decrypt of credentials, key = sha256(APP_SECRET)
src/lib/storage.ts       S3 put/get/presign, ensureBucket
src/lib/media/upload.ts  validate + tinify + PutObject
src/lib/media/tinify.ts
src/lib/media/hosts/blossom.ts, imgur.ts   (Nostr media hosts)
src/lib/text/split.ts, count.ts
src/lib/connectors/types.ts, index.ts, x.ts, bluesky.ts, mastodon.ts, nostr.ts, instagram.ts
src/lib/publish/publish.ts, worker.ts
src/instrumentation.ts   register(): migrate DB, ensure bucket, start worker if WORKER_ENABLED
drizzle/                 generated SQL migrations
test/setup.ts, test/global-setup.ts
Dockerfile, docker-compose.yml, .env.example, .github/workflows/ci.yml, docs/
```

## 3. Config

All via env. `getConfig()` parses with zod once, lazily, at request/boot time — never at build (so `next build`
works without env).

| Var | Default | Notes |
|---|---|---|
| APP_NAME | `Multiposter` | UI nav + `<title>` |
| APP_URL | `http://localhost:3000` | |
| APP_SECRET | — required, ≥32 chars | credential encryption key source |
| DATABASE_URL | — required | |
| S3_ENDPOINT | — required | |
| S3_REGION | `us-east-1` | |
| S3_BUCKET | `multiposter` | |
| S3_ACCESS_KEY / S3_SECRET_KEY | — required | |
| S3_FORCE_PATH_STYLE | `true` | |
| S3_PUBLIC_URL | optional | set → public URL `${S3_PUBLIC_URL}/${key}`; else presigned GET (1h) wherever a platform must fetch media (Instagram) |
| TINYPNG_API_KEY | optional | set → every PNG/JPEG/WebP upload is tinified; tinified bytes stored + posted |
| NOSTR_MEDIA_HOST | `blossom` | `blossom` \| `imgur` |
| BLOSSOM_SERVER | `https://blossom.primal.net` | |
| IMGUR_CLIENT_ID | optional | required when NOSTR_MEDIA_HOST=imgur (zod refine) |
| WORKER_ENABLED | `true` | `false` on extra web replicas |
| WORKER_POLL_MS | `10000` | |
| SESSION_TTL_DAYS | `30` | |
| COOKIE_SECURE | `auto` | auto = true when NODE_ENV=production |
| MAX_UPLOAD_MB | `50` | also drives `experimental.serverActions.bodySizeLimit` (see §12) |
| ALLOW_REGISTRATION | `true` | `false` hides + blocks /register |

S3 client: `forcePathStyle`, `requestChecksumCalculation: 'WHEN_REQUIRED'`,
`responseChecksumValidation: 'WHEN_REQUIRED'` (S3Mock / non-AWS compatibility).

## 4. Data model

drizzle; uuid PKs `defaultRandom()`; all timestamps `timestamptz`.

| Table | Columns |
|---|---|
| users | id, email unique, password_hash, created_at |
| sessions | id, user_id→users cascade, token_hash unique, expires_at, created_at |
| connections | id, user_id→users cascade, connector text, label text, account_name text, credentials text (AES-GCM encrypted JSON), settings jsonb, created_at; unique(user_id, label) |
| posts | id, user_id→users cascade, status enum `scheduled\|publishing\|published\|partial\|failed\|cancelled`, auto_thread bool, scheduled_at not null, created_at, published_at nullable |
| post_items | id, post_id→posts cascade, position int, text text |
| media | id, post_item_id→post_items cascade, position int, storage_key, mime, size int, alt nullable |
| post_targets | id, post_id→posts cascade, connection_id→connections cascade, status enum `pending\|published\|failed`, result jsonb (`{id,url}[]`), error text nullable |

- Session cookie holds a random 32-byte token; DB stores its sha256.
- A flood = N items; a single post = 1 item.
- "Post now" = `scheduled_at = now()`. One code path (the worker) publishes everything.
- `settings` = connector-specific data captured at verify time (e.g. Mastodon instance limits).

## 5. Auth

- Register/login are server actions.
- Password: `crypto.scrypt` N=2^14, r=8, p=1, 16-byte salt; stored `scrypt$N$r$p$salt$hash` (base64); verify with
  `timingSafeEqual`.
- Cookie: httpOnly, sameSite `lax`, `secure` per config, maxAge = SESSION_TTL_DAYS.
- `requireUser()`: cookie → session (unexpired) → user, else `redirect('/login')`. Called in every page and action.
- No `proxy.ts` (Next 16's renamed middleware). Not needed: Next docs support auth checks directly in page
  components; server actions re-check themselves anyway.
- ALLOW_REGISTRATION=false: register link hidden, page and action refuse.

## 6. Connector contract (`src/lib/connectors/types.ts`)

```ts
export type Ref = Record<string, string>;            // opaque reply handle: {id} or {uri,cid}
export interface MediaFile { key: string; mime: string; size: number; alt?: string; bytes(): Promise<Buffer>; url(): Promise<string>; }
export interface Field { name: string; label: string; secret?: boolean; required?: boolean; help?: string; placeholder?: string; }
export interface Capabilities { images: boolean; video: boolean; threads: boolean; textOnly: boolean; maxMedia: number; }
export interface Connector<C extends Record<string, string> = Record<string, string>, S = Record<string, unknown>> {
  id: string; name: string; fields: Field[]; capabilities: Capabilities;
  maxLength(settings: S): number;
  countLength(text: string): number;
  verify(creds: C): Promise<{ accountName: string; settings: S }>;  // at connect time; throws on bad creds
  post(ctx: { creds: C; settings: S; text: string; media: MediaFile[]; root?: Ref; parent?: Ref }):
    Promise<{ id: string; url?: string; ref: Ref }>;
}
```

`index.ts`: `export const connectors: Record<string, Connector> = { x, bluesky, mastodon, nostr, instagram }` +
`getConnector(id)` (throws on unknown). Adding a connector = new file implementing `Connector` + one line here.
The GUI renders connect forms from `fields`.

## 7. Connectors

### 7.1 x (name "X")
- Fields: apiKey, apiSecret, accessToken, accessSecret (OAuth 1.0a user context; app must be Read+Write).
  Help text: X API is pay-per-use for new developers since 2026.
- Lib: `new TwitterApi({ appKey, appSecret, accessToken, accessSecret })`.
- verify: `client.v2.me()` → `@${data.username}`.
- post: per media `client.v2.uploadMedia(buffer, { media_type })` → media id (chunked internally for video); alt text via
  `client.v2.createMediaMetadata(mediaId, { alt_text: { text } })`; then
  `client.v2.tweet({ text, media: { media_ids }, reply: { in_reply_to_tweet_id: parent.id } })` → `data.id`.
- maxLength 280 weighted: `twitter-text` `parseTweet(text).weightedLength`.
- caps: images, video, threads, textOnly; maxMedia 4 (1 if any video).
- url `https://x.com/i/web/status/{id}`.

### 7.2 bluesky
- Fields: identifier, appPassword, service (default `https://bsky.social`).
- Lib: `new AtpAgent({ service })`, `agent.login({ identifier, password })` per publish; verify → handle.
- post:
  - per image: pre-check size ≤ 976_560 bytes, else fail target with clear message (no resizing in v1;
    TinyPNG usually gets under). `agent.uploadBlob(bytes, { encoding: mime })` → `res.data.blob`.
  - `const rt = new RichText({ text }); await rt.detectFacets(agent)`.
  - `agent.post({ text: rt.text, facets: rt.facets, embed: { $type: 'app.bsky.embed.images', images: [{ image: blob, alt: alt ?? '' }] }, reply: { root: {uri,cid}, parent: {uri,cid} }, createdAt })`
    → `{ uri, cid }`; ref `{uri,cid}`.
- maxLength 300 graphemes (`Intl.Segmenter`; equals `RichText.graphemeLength`).
- caps: images yes; **video no in v1** (needs separate video service; target fails with message); maxMedia 4; threads; textOnly.
- url `https://bsky.app/profile/{handle}/post/{rkey}` (rkey = last segment of uri).

### 7.3 mastodon
- Fields: host (instance URL), accessToken (scopes `write:statuses write:media read:accounts`). Plain `fetch`.
- verify: `GET /api/v1/accounts/verify_credentials` → `acct`; `GET /api/v2/instance` → settings
  `{ maxChars, maxMedia, charsPerUrl, imageSizeLimit, videoSizeLimit }`.
- post: `POST /api/v2/media` (multipart `file` + `description`); on 202 poll `GET /api/v1/media/{id}` until 200;
  `POST /api/v1/statuses` JSON `{ status, media_ids, in_reply_to_id }`.
- maxLength from settings (default 500); URLs count as `charsPerUrl` (default 23).
- caps: images, video, threads, textOnly; maxMedia from settings (default 4).
- url = `status.url`.

### 7.4 nostr
- Fields: privateKey (nsec or hex), relays (comma-separated wss URLs; default
  `wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net`), mediaServer (optional Blossom URL override).
- Lib imports: `nostr-tools/pure` (`finalizeEvent`, `getPublicKey`), `nostr-tools/pool` (`SimplePool`),
  `nostr-tools/nip19` (`decode`, `npubEncode`, `noteEncode`).
- verify: decode key → `npubEncode(getPublicKey(sk))` as accountName. No network.
- post:
  - Nostr has no native upload → each file goes to the configured host:
    - blossom: `PUT {server}/upload`, header `Authorization: Nostr <base64(kind 24242 event, tags t=upload, x=sha256, expiration)>`
      signed with the same key → `response.url`. (Blossom BUD-02 auth, hand-built; `nostr-tools/nip98` is
      HTTP-auth kind 27235 and does not apply.)
    - imgur: `POST https://api.imgur.com/3/image`, `Authorization: Client-ID <id>` → `data.link`.
  - Append URLs to content on new lines; add NIP-92 `imeta` tags (`url`, `m`, `x`, `alt`).
  - kind 1 event, NIP-10 tags: `["e",root,"","root",pk]`, `["e",parent,"","reply",pk]`, `["p",pk]`.
  - `pool.publish(relays, event)` returns one promise per relay; `Promise.allSettled`; success if ≥1 accepts;
    per-relay results stored in result. Close pool after.
- maxLength 5000 (practical). caps: images, video (host-dependent), maxMedia 10, threads, textOnly.
- url `https://njump.me/{noteEncode(id)}`.

### 7.5 instagram (nice-to-have)
- Fields: igUserId, accessToken (long-lived, Instagram Login, professional account; scopes
  `instagram_business_basic instagram_business_content_publish`). `fetch` to `https://graph.instagram.com/v25.0`.
- verify: `GET /me?fields=username`.
- post: requires media (textOnly false). JPEG images only (≤8MB, aspect 4:5–1.91:1) or MP4 as REELS.
  URLs must be publicly fetchable → `MediaFile.url()`.
  - single: `POST /{igUserId}/media` `{ image_url | video_url + media_type=REELS, caption }`.
  - multiple: child containers with `is_carousel_item=true`, then `media_type=CAROUSEL` container with `children`.
  - video: poll `GET /{id}?fields=status_code` until `FINISHED`.
  - `POST /{igUserId}/media_publish { creation_id }`; url via `GET /{mediaId}?fields=permalink`.
- maxLength 2200. caps: images, video, maxMedia 10, threads false, textOnly false.

## 8. Text

- `count.ts`: `graphemes(text)` via `Intl.Segmenter`; per-connector `countLength` lives in the connector.
- `split.ts`: `splitText(text, max, count) => string[]`, pure. Greedy packing by paragraphs → sentences → words →
  graphemes (hard split only when a single word exceeds max). Returns `[text]` if it fits. No numbering suffix in v1.

## 9. Publish engine (`src/lib/publish/publish.ts`)

`publishPost(postId)`:
1. Load post, items (by position), media (by position), targets + connections (decrypt creds).
2. Per target, `Promise.allSettled` across targets:
   - capability checks → fail target: text-only item on `textOnly=false`; video on `video=false`; media > maxMedia.
   - per item: if `countLength(text) > maxLength(settings)`: `auto_thread && threads` → `splitText`, else fail
     `"too long for {name} ({n}/{max})"`.
   - item media attaches to the item's first chunk.
   - post chunks sequentially; first result's ref = root; each result's ref = next parent.
   - collect `{id,url}`; set target status/result/error.
3. Post status: all ok → `published`, some → `partial`, none → `failed`; set `published_at`.

Never throws; errors land in `post_targets.error`. `MediaFile` built from storage: `bytes()` = S3 GetObject,
`url()` = public URL or presigned GET.

## 10. Worker (`src/lib/publish/worker.ts`)

```sql
UPDATE posts SET status = 'publishing'
WHERE id IN (SELECT id FROM posts WHERE status = 'scheduled' AND scheduled_at <= now()
             ORDER BY scheduled_at LIMIT 5 FOR UPDATE SKIP LOCKED)
RETURNING id
```
- `tick()` (exported, used by tests): claim, then `publishPost` each. `start()`: loop every WORKER_POLL_MS,
  errors logged, loop keeps going.
- `// ponytail: polling; swap for LISTEN/NOTIFY or a queue if latency matters.`
- One process (the Next server) runs app + worker; WORKER_ENABLED=false for extra web replicas.

`src/instrumentation.ts`:
```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { migrate } = await import('./lib/db/client');
  const { ensureBucket } = await import('./lib/storage');
  const { getConfig } = await import('./lib/config');
  await migrate();
  await ensureBucket();
  if (getConfig().WORKER_ENABLED) (await import('./lib/publish/worker')).start();
}
```
Verified (Next 16.2 docs): `register` is called once when a server instance starts and must complete before requests
are served; it runs in `output: 'standalone'` (`node server.js`). Node-only modules are dynamically imported inside
the `nodejs` guard so the edge bundle stays clean. Migrations use `drizzle-orm/node-postgres/migrator`
`migrate(db, { migrationsFolder: 'drizzle' })` (path resolved from `process.cwd()`).

## 11. Media upload (`src/lib/media/upload.ts`), used by the compose action

1. Validate mime ∈ {image/png, image/jpeg, image/gif, image/webp, video/mp4, video/quicktime}, size ≤ MAX_UPLOAD_MB.
2. TINYPNG_API_KEY set and png/jpeg/webp → tinify: `POST https://api.tinify.com/shrink` (basic auth `api:KEY`, raw
   body) → 201 + `Location`; `GET Location` same auth → bytes. On 429/5xx: keep original bytes, log warning.
3. `PutObject` key `media/{uuid}.{ext}` with ContentType → `{ key, mime, size }`.

The app never serves media itself: platforms get bytes uploaded to them, or a storage URL where the API demands one.

## 12. Next config

```ts
const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pg'],                       // stable name (not experimental) since Next 15
  experimental: { serverActions: { bodySizeLimit: '50mb' } },  // still experimental in Next 16; default 1mb
};
```
`bodySizeLimit` is fixed at build time, so it is a literal (`'50mb'`) matching the MAX_UPLOAD_MB default; MAX_UPLOAD_MB
can only lower the effective limit at runtime. Raising above 50 needs a rebuild.

## 13. GUI

Tailwind, minimal, forms + server actions, `useActionState` for errors. Layout nav shows APP_NAME.

| Route | Content |
|---|---|
| `/` | redirect → `/compose` (or `/login`) |
| `/login`, `/register` | email + password; register hidden when ALLOW_REGISTRATION=false |
| `/connections` | list (label, account, connector) + delete; add form: pick connector → inputs from `fields` (secret → password input) + label → verify → save encrypted; shows provider help text |
| `/compose` | items list (add/remove; each: textarea with live length vs strictest selected limit, multiple file input, alt text), connection checkboxes, "Auto-split into threads when too long", optional `datetime-local`; submit → upload media → insert post/items/media/targets, status `scheduled` |
| `/posts` | newest first; status badge; scheduled/published time; item text preview; per-target status + link or error; cancel for scheduled |

## 14. Tests & quality gates

- vitest 5 config:
  ```ts
  test: {
    globalSetup: ['test/global-setup.ts'],   // export default async function setup(project) { ...; return teardown }
    setupFiles: ['test/setup.ts'],
    fileParallelism: false,
    coverage: { provider: 'v8', include: ['src/**'], exclude: ['**/*.test.*'],
                thresholds: { lines: 95, functions: 95, branches: 95, statements: 95 } },
  },
  resolve: { tsconfigPaths: true },          // Vite 8 built-in; no vite-tsconfig-paths plugin
  ```
- global-setup: runs migrations against the test DB and ensures the bucket (real Postgres + S3Mock from the same
  docker compose file; test env points at localhost ports). Receives the `TestProject`; may `project.provide(...)`.
- setup.ts: TRUNCATE all tables between tests.
- Connectors: `vi.spyOn(globalThis, 'fetch')`; `vi.mock` the SDK modules; assert request shapes.
- Pages/actions: call as functions; mock `next/headers`, `next/navigation`.
- Components: RTL + jsdom via `// @vitest-environment jsdom`.
- CI gates: ESLint, `tsc --noEmit`, tests + coverage thresholds, docker build.

## 15. Docker / CI

- Dockerfile: official Next standalone 3-stage (`node:24-slim`: deps, builder, runner) + `COPY --from=builder /app/drizzle ./drizzle`.
- docker-compose.yml:
  - app: `build: .`, env from `.env` with defaults, depends_on db + s3mock `service_healthy`, port 3000.
  - db: `postgres:17`, named volume, `pg_isready` healthcheck.
  - s3mock: `adobe/s3mock:5.2.3`, `COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=multiposter`, port 9090, wget healthcheck.
- `.env.example`: every var from §3.
- `.github/workflows/ci.yml` on push/PR:
  - test: checkout v7, setup-node v7 (node 24, cache npm), services postgres:17 + s3mock; `npm ci`, `npm run lint`,
    `npx tsc --noEmit`, `npm test -- --coverage`.
  - docker: `docker build .`.

## 16. README outline (written in P4)

1. What it is (3 lines)
2. Features
3. Quick start: `cp .env.example .env`; `docker compose up`; open http://localhost:3000
4. Configuration table (§3)
5. Connecting accounts, per provider: what to paste, where to get it, nuances —
   X paid API; Bluesky app password + ~1MB image limit + no video; Mastodon token scopes; Nostr key stored
   server-side (encrypted) + media host choice; Instagram professional account + public media URL requirement
6. Adding a connector (one file + one registry line)
7. Development & tests
8. License
