# Multiposter — Implementation Plan

Source of truth: `docs/SPEC.md`. Each phase runs as a separate implementation agent. Agents only touch files listed
for their phase (plus their own `*.test.ts(x)` next to them). `package.json` is owned by P1 only.

**Gate for every phase:** `npm run lint && npx tsc --noEmit && npm test -- --coverage && npm run build`
(coverage thresholds 95/95/95/95). Tests need `docker compose up -d db s3mock`.

## P1 Scaffold (sequential, first)

1. Into the existing dir (keep LICENSE; README will be overwritten in P4):
   `npx create-next-app@latest . --ts --app --tailwind --eslint --src-dir --import-alias "@/*" --use-npm --no-react-compiler --disable-git --yes`
2. Install everything later phases need (no later phase edits `package.json`):
   - runtime: `drizzle-orm pg zod @aws-sdk/client-s3 @aws-sdk/s3-request-presigner twitter-api-v2 @atproto/api nostr-tools twitter-text`
   - dev: `drizzle-kit @types/pg @types/twitter-text vitest @vitest/coverage-v8 @testing-library/react @testing-library/dom @testing-library/user-event jsdom`
   - scripts: `test` = `vitest run`, `db:generate` = `drizzle-kit generate`.
3. Files:

| File | Content |
|---|---|
| `next.config.ts` | standalone, `serverExternalPackages: ['pg']`, `experimental.serverActions.bodySizeLimit: '50mb'` |
| `drizzle.config.ts` | schema `src/lib/db/schema.ts`, out `drizzle`, dialect postgresql |
| `src/lib/config.ts` | zod env schema, `getConfig()` memoized, `resetConfig()` for tests |
| `src/lib/db/schema.ts` | all tables + enums (SPEC §4) |
| `src/lib/db/client.ts` | `db`, `migrate()` |
| `drizzle/*` | first migration via `npm run db:generate` |
| `src/lib/crypto.ts` | `encrypt(obj)`, `decrypt(str)` |
| `src/lib/auth/password.ts` | `hashPassword`, `verifyPassword` |
| `src/lib/auth/session.ts` | `createSession`, `destroySession`, `getUser`, `requireUser` |
| `src/lib/storage.ts` | `putObject`, `getObject`, `objectUrl`, `ensureBucket` |
| `src/lib/connectors/types.ts` | contract (SPEC §6) |
| `src/lib/connectors/index.ts` | registry + `getConnector` |
| `src/lib/connectors/{x,bluesky,mastodon,nostr,instagram}.ts` | stubs: real `id/name/fields/capabilities/maxLength/countLength`; `verify`/`post` throw `'not implemented'` |
| `src/lib/text/count.ts`, `src/lib/text/split.ts` | SPEC §8 |
| `vitest.config.ts` | SPEC §14 |
| `test/global-setup.ts`, `test/setup.ts` | migrate + bucket; TRUNCATE between tests |
| `docker-compose.yml`, `Dockerfile`, `.env.example`, `.dockerignore` | SPEC §15 |
| `.github/workflows/ci.yml` | SPEC §15 |
| tests | for every P1 `src/lib` file except connector stubs' throwing methods (one test each is enough to cover them) |

Exit: gate passes; `docker build .` succeeds.

## P2 Features (three agents in parallel, disjoint files)

**P2-A connectors (fetch/SDK)**
- `src/lib/connectors/x.ts`, `bluesky.ts`, `mastodon.ts` + `*.test.ts`
- Replace stubs; SDKs `vi.mock`ed, `fetch` spied; assert request shapes (SPEC §7.1–7.3).

**P2-B nostr, instagram, media**
- `src/lib/connectors/nostr.ts`, `instagram.ts`
- `src/lib/media/hosts/blossom.ts`, `src/lib/media/hosts/imgur.ts`
- `src/lib/media/tinify.ts`, `src/lib/media/upload.ts`
- tests for each (upload.ts against real S3Mock; tinify/hosts with spied `fetch`; nostr with mocked `SimplePool`).

**P2-C publish engine**
- `src/lib/publish/publish.ts`, `src/lib/publish/worker.ts`, `src/instrumentation.ts` + tests
- Tests use real DB and register a fake connector into `connectors` (no real providers). Cover: single post, flood
  reply chain refs, auto-thread split, too-long failure, capability failures, partial/failed status, SKIP LOCKED claim
  (two concurrent `tick()`s claim disjoint posts), instrumentation guard (`NEXT_RUNTIME` not nodejs → no-op).

Merge order: any; files are disjoint. Gate runs after all three merge.

## P3 GUI

| File | Content |
|---|---|
| `src/app/layout.tsx` | nav with APP_NAME, links, logout |
| `src/app/page.tsx` | redirect |
| `src/app/(auth)/login/page.tsx`, `(auth)/register/page.tsx`, `(auth)/actions.ts` | login/register/logout actions |
| `src/app/connections/page.tsx`, `connections/actions.ts`, `connections/connect-form.tsx` | list/delete/add (client form rendered from `fields`) |
| `src/app/compose/page.tsx`, `compose/actions.ts`, `compose/compose-form.tsx` | items editor, live counter, targets, schedule |
| `src/app/posts/page.tsx`, `posts/actions.ts` | history + cancel |
| tests | actions/pages called as functions (mock `next/headers`, `next/navigation`); client components via RTL + jsdom |

Delete create-next-app boilerplate assets not used (`public/*.svg`, default page content).

## P4 Hardening

- `README.md` per SPEC §16.
- Raise any file below 95% coverage; lint/typecheck clean.
- `docker compose up --build` smoke: app boots, migrations apply, bucket exists, `/login` serves, register →
  `/connections` loads, a scheduled post with no targets is picked by the worker and marked `failed`/`published`
  without crashing.
- Review `ci.yml` by reading it against SPEC §15 (no `act`).

Exit: gate passes; smoke checklist recorded in the PR description.
