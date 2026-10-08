# Multiposter — agent guide

Self-hosted Next.js app that publishes one post, or a thread ("flood"), to many X, Bluesky, Mastodon, Nostr and
Instagram accounts at once, now or scheduled.

## Stack
- Node 24, npm; Next.js 16 App Router + React 19, TypeScript, Tailwind
- PostgreSQL 17 via drizzle-orm + pg; migrations in `drizzle/`, applied at startup
- zod 4 (env + forms); S3-compatible storage via @aws-sdk/client-s3 (S3Mock locally/CI); nodemailer (Mailpit locally/CI)
- SDKs: twitter-api-v2, @atproto/api, nostr-tools, twitter-text
- vitest + coverage-v8, Testing Library + jsdom; Docker standalone image; GitHub Actions

## Layout
- `src/app/` thin pages + server actions: `(auth)`, `compose`, `connections`, `posts`
- `src/lib/config.ts` zod env -> `getConfig()`
- `src/lib/db/` schema + client/`migrate()`; `src/lib/auth/` scrypt passwords, DB sessions, `registrationOpen()`,
  `tokens.ts` (single-use hashed email tokens)
- `src/lib/mail.ts` `mailEnabled()` + `sendMail()` (nodemailer over `SMTP_URL`)
- `src/lib/crypto.ts` AES-GCM for stored credentials; `src/lib/storage.ts` S3
- `src/lib/connectors/` one file per platform + `index.ts` registry; `types.ts` is the `Connector` contract
- `src/lib/publish/` `publish.ts` (engine) + `worker.ts` (poller); `src/lib/media/`, `src/lib/text/`
- `src/instrumentation.ts` boot: migrate, ensure bucket, start worker
- `drizzle/` generated SQL; `test/` global setup (migrate test DB), per-test TRUNCATE, Next stand-ins
- `docs/` spec and plan; `Makefile` + `docker-compose.yml` (`dev` profile) for the container workflow

## Commands
| make (in `dev` container) | npm on host |
|---|---|
| `make install` | `npm ci` |
| `make dev` | `npm run dev` |
| `make test` | `npm test -- --coverage` |
| `make lint` / `make typecheck` | `npm run lint` / `npx tsc --noEmit` |
| `make build` | `npm run build` |
| `make db-generate` | `npm run db:generate` |

`make up` / `down` / `logs` drive the production `app` image; `make clean` drops all volumes.
Tests on the host: `docker compose up -d db s3mock mailpit`, then `npm test -- --coverage`.

## Quality gate (must pass before any commit)
`npm run lint && npx tsc --noEmit && npm test -- --coverage && npm run build`. Coverage is kept at 100%; CI fails
below 95%.

## Conventions
- Config only through `getConfig()`; never read `process.env` anywhere else.
- A connector is one file implementing `Connector` plus one line in `src/lib/connectors/index.ts`. Its tests mock
  the SDK / `fetch` and assert request shapes.
- Tests hit real Postgres and S3Mock; no DB mocks.
- Everything is published by the in-process worker; "post now" = `scheduledAt` now.
- Email is on iff `SMTP_URL` is set; tests mock `@/lib/mail`, the Mailpit integration test is the only real send.
- Stored credentials are encrypted with a key derived from `APP_SECRET`.
- Keep diffs minimal; no new dependencies without a reason; mark deliberate shortcuts with `// ponytail:` comments.

## Docs
- `docs/SPEC.md` is the source of truth; update it with behaviour changes. `docs/PLAN.md` is the build plan.

## Looks like a bug, isn't
- `posts.published_at` doubles as the worker's claim stamp while `publishing`; completion overwrites it.
- Posts stuck in `publishing` > 15 min become `failed`, never retried (avoids double posting).
- `bodySizeLimit` in `next.config.ts` is build-time; `MAX_UPLOAD_MB` can only lower it.
- Bluesky video is unsupported by design; such targets fail.
- `/register` stays open while the users table is empty, even with `ALLOW_REGISTRATION=false`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
