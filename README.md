# Multiposter

Self-hosted web app that publishes one post, or a thread of posts, to several social accounts at once.
Connect any number of X, Bluesky, Mastodon, Nostr and Instagram accounts, each under your own label.
Next.js + PostgreSQL + S3-compatible storage, shipped as one Docker image.

## Features

- Multiple users; email + password accounts (registration can be disabled)
- Many accounts per platform, each with a label like `mastodon-work`
- Single posts or **floods**: an ordered list of posts published as a reply chain
- Images and videos with alt text; optional TinyPNG compression
- Optional auto-split of long text into a thread, per platform limit
- Post now or schedule; history with per-account status, links and errors; cancel scheduled posts

## Quick start

```sh
cp .env.example .env          # then set APP_SECRET to a random string of 32+ chars
docker compose up --build     # or `make up` (same, detached)
```

To run the published image instead of building, swap `build: .` for the commented `image:` line in
`docker-compose.yml` and run `docker compose up`.

Open http://localhost:3000 and register. Compose starts the app, PostgreSQL 17 and S3Mock (local S3).
Migrations and the bucket are created when the app starts.

**Accounts.** There is no seeded user or generated password: the first person to open the app registers, even
with `ALLOW_REGISTRATION=false`. There is no admin interface; every user manages only their own connections and
posts. The app sends no email, so there is no SMTP setting and no password reset (reset a password by deleting the
user row and registering again). Migrations run automatically at startup from `drizzle/`; there is no seeder
because none is needed.

## Configuration

All settings are env vars (`.env`). They are validated at startup; invalid values are reported in the app log.

| Var | Default | Meaning |
|---|---|---|
| `APP_NAME` | `Multiposter` | Name shown in the nav and page title |
| `APP_URL` | `http://localhost:3000` | Public URL of the app |
| `APP_SECRET` | required, ≥ 32 chars | Encrypts stored credentials. Changing it makes saved connections unreadable |
| `DATABASE_URL` | required | PostgreSQL URL (compose sets the in-network one) |
| `S3_ENDPOINT` | required | S3-compatible endpoint (compose sets the in-network one) |
| `S3_REGION` | `us-east-1` | |
| `S3_BUCKET` | `multiposter` | Created at startup if missing |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | required | |
| `S3_FORCE_PATH_STYLE` | `true` | Path-style URLs (needed by most non-AWS stores) |
| `S3_PUBLIC_URL` | empty | Public base URL for stored media. Empty = presigned GET URLs (1 h) |
| `TINYPNG_API_KEY` | empty | Set to compress every PNG/JPEG/WebP upload |
| `NOSTR_MEDIA_HOST` | `blossom` | `blossom` or `imgur` |
| `BLOSSOM_SERVER` | `https://blossom.primal.net` | Default Blossom server |
| `IMGUR_CLIENT_ID` | empty | Required when `NOSTR_MEDIA_HOST=imgur` |
| `WORKER_ENABLED` | `true` | Run the publish worker in this process. `false` on extra replicas |
| `WORKER_POLL_MS` | `10000` | How often the worker looks for due posts |
| `SESSION_TTL_DAYS` | `30` | Login session lifetime |
| `COOKIE_SECURE` | `auto` | `auto` = secure cookies when `NODE_ENV=production`; or `true` / `false` |
| `MAX_UPLOAD_MB` | `50` | Max size per uploaded file |
| `ALLOW_REGISTRATION` | `true` | `false` hides and blocks `/register` once the first account exists |

`MAX_UPLOAD_MB` can only lower the limit: the request body cap (`bodySizeLimit` in `next.config.ts`) is fixed at
50 MB at build time. Raising it needs an edit there and a rebuild.

The Docker image runs with `NODE_ENV=production`, so with `COOKIE_SECURE=auto` cookies are secure-only. Browsers
such as Chrome and Firefox accept them on `http://localhost`; for any other plain-HTTP host set `COOKIE_SECURE=false` or put HTTPS in front.

## Connecting accounts

Go to **Connections**, pick a platform, paste the values below and give the account a label. Credentials are
checked on save and stored encrypted.

### X
Paste API key, API secret, access token and access token secret (OAuth 1.0a user context) from your app in the
X developer portal. The app must have **Read and Write** permission; regenerate the access token after changing
it. The X API is pay-per-use for new developers.

### Bluesky
Paste your handle (or email) and an **app password** (Settings → Privacy and security → App passwords). Service
defaults to `https://bsky.social`. Images must be ≤ ~976 KB each (TinyPNG usually gets them there). Video is not
supported; posts with video fail for Bluesky targets.

### Mastodon
Paste the instance URL and an access token from Preferences → Development → New application with scopes
`write:statuses write:media read:accounts`. Character limit, URL length, media count and size limits are read
from the instance when you connect.

### Nostr
Paste your private key (`nsec…` or hex). It is stored on this server, encrypted with `APP_SECRET`. Relays default
to `wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net`; a post succeeds if at least one relay accepts it.
Nostr has no native media upload: files go to a Blossom server (default, signed with your key; override per
account) or to Imgur via `NOSTR_MEDIA_HOST=imgur`, and their URLs are appended to the note.

### Instagram
Needs a professional (business or creator) account. Paste the Instagram user ID and a long-lived token
(Instagram Login) with `instagram_business_basic instagram_business_content_publish`. Posts must have media:
JPEG images or MP4 video (a single video is published as a reel); 2–10 files become a carousel. Instagram fetches media from a
URL, so it must reach your storage: set `S3_PUBLIC_URL`, or make sure the presigned URLs (built from
`S3_ENDPOINT`) are reachable from the internet. The bundled S3Mock is not.

## How posting works

- One code path: every post is stored as scheduled (`Post now` = scheduled for now). An in-process worker polls
  for due posts, claims them with `FOR UPDATE SKIP LOCKED` and publishes to every target in parallel.
- Each target gets its own status, links and error. Post status: `published`, `partial` or `failed`.
- Text over a platform's limit fails that target, unless auto-split is on and the platform supports threads; then
  it is split by paragraphs, sentences, then words, and posted as a reply chain.
- A flood posts each item as a reply to the previous one; an item's media goes on its first chunk.
- A post stuck in `publishing` for over 15 minutes (crash mid-publish) is marked `failed`, never retried, to avoid
  double posting.
- Uploads are stored in S3. With `TINYPNG_API_KEY` set, PNG/JPEG/WebP files are compressed first.

## Adding a connector

1. Create `src/lib/connectors/<id>.ts` exporting an object that implements `Connector` from
   `src/lib/connectors/types.ts` (fields, capabilities, length rules, `verify`, `post`).
2. Add it to the `connectors` map in `src/lib/connectors/index.ts`.
3. Write `src/lib/connectors/<id>.test.ts` (mock `fetch` or the SDK; assert request shapes).

The connect form is rendered from `fields`; the publish engine handles splitting, threading and status.

## Development

```sh
npm ci
docker compose up -d db s3mock
npm test -- --coverage     # real Postgres + S3Mock
npm run lint
npx tsc --noEmit
npm run dev                # needs .env with localhost DATABASE_URL / S3_ENDPOINT (the .env.example defaults)
```

Tests use `TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/multiposter_test`, created if
missing) and `TEST_S3_ENDPOINT` (default `http://localhost:9090`); they never read `.env`.
Schema changes: edit `src/lib/db/schema.ts`, run `npm run db:generate`, commit `drizzle/`.

### Using make

Runs everything in a `node:24-slim` container (compose `dev` profile, own `node_modules` volume); no host Node needed.
`make` alone lists the targets.

- `make install`: `npm ci`
- `make dev`: dev server on http://localhost:3000
- `make test`: tests with coverage against the compose Postgres + S3Mock
- `make lint` / `make typecheck` / `make build`
- `make db-generate`: write a migration into `drizzle/`
- `make shell`: shell in the dev container
- `make up` / `make down` / `make logs`: production image (`app`), stop, follow app logs
- `make clean`: stop everything and delete volumes (DB data included)

The `dev` service and the production `app` service both use port 3000, so run one or the other.

## CI

`.github/workflows/ci.yml` runs on push and pull request:
- **test**: `npm ci`, ESLint, `tsc --noEmit`, and the test suite against Postgres + S3Mock services; fails below
  95% line/function/branch/statement coverage.
- **docker** (after test passes): builds the image. On push to `main` it also publishes it to
  `ghcr.io/ardakilic/multiposter`, tagged `latest` and the commit SHA. The package may need to be made public in
  GitHub package settings for anonymous pulls.

## License

MIT, see [LICENSE](LICENSE).
