# Copy Reusable Infrastructure from Telltale to Vibe Tape

> **Historical note (2026-04-04):** References to Neon's pooled + direct
> connection URLs are stale — Vibe Tape now runs against a local Docker
> Postgres only. See [ADR 010](../../decisions/010-personal-use-only.md).

**Status:** Complete
**Created:** 2026-03-20
**Goal:** Bootstrap Vibe Tape's project scaffolding by copying and adapting infrastructure from Telltale — auth, database, tRPC, testing, config, and frontend/backend structure — so we start with proven patterns instead of rebuilding from scratch.

---

## Phase 1 — Project Init & Config Files

Copy and adapt the foundational config files that define the dev environment.

- [x] Create `package.json` with Vibe Tape name/metadata, carrying over shared dependencies
- [x] Copy `tsconfig.json` (strict, `@/*` alias, vitest globals)
- [x] Copy `eslint.config.mjs` (flat config, next/core-web-vitals + next/typescript)
- [x] Copy `vitest.config.ts` (React plugin, tsconfig paths, jsdom, V8 coverage)
- [x] Copy `playwright.config.ts` (Chromium, port 3001)
- [x] Copy `.nvmrc` (Node 22)
- [x] Copy `docker-compose.yml`, renamed to `vibe-tape`
- [x] Update `.env.example` with Vibe Tape env vars (Spotify, Anthropic, Cron)
- [x] Update `.gitignore` with Telltale additions (testing, prisma, pnpm sections)
- [x] Copy `next.config.ts`
- [x] Add npm scripts (dev, build, lint, typecheck, test, db:up/down/migrate/push, etc.)
- [x] Copy `src/test/setup.ts` (jest-dom vitest matchers)

**PR:** "Project init: config files and dependencies"

---

## Phase 2 — Database Layer

Set up Prisma (schema + migrations) → Kysely (runtime queries) pipeline.

- [ ] Create `prisma/schema.prisma` with:
  - Prisma-Kysely generator config (outputs to `src/db/types.ts` + `src/db/enums.ts`)
  - Datasource config (Neon pooled + direct URLs)
  - Vibe Tape models: `User`, `Session`, `Account`, `Verification` (Better Auth), `Song`, `Playlist`, `GroupSession`, `GuestPass`
  - Enums: `UserTier` (FREE, STANDARD, POWER)
- [ ] Copy `src/lib/db.ts` (Kysely singleton with CamelCasePlugin + pg.Pool, globalThis caching)
- [ ] Copy `src/lib/id.ts` (CUID2 wrapper)
- [ ] Run `prisma generate` to produce `src/db/types.ts` and `src/db/enums.ts`
- [ ] Create initial migration
- [ ] Copy `tests/helpers/mock-db.ts` (proxy-based Kysely mock)

**PR:** "Database layer: Prisma schema, Kysely connection, test helpers"

---

## Phase 3 — Auth (Better Auth + Spotify OAuth)

Adapt Telltale's Better Auth setup, replacing Google OAuth with Spotify's genericOAuth.

- [ ] Copy and adapt `src/server/auth.ts`:
  - Replace Google OAuth with `genericOAuth` plugin for Spotify
  - Configure Authorization Code flow (not PKCE — we have a server secret)
  - Set scopes: `user-library-read`, `playlist-modify-public`, `playlist-modify-private`
  - Configure Spotify endpoints: `authorizationUrl`, `tokenUrl`, `userInfoUrl`
  - Keep: Kysely database adapter, `nextCookies()` plugin, dynamic base URL logic
  - Drop: email/password, email verification, password reset, Resend integration
- [ ] Copy `src/lib/auth-client.ts` (createAuthClient)
- [ ] Copy and adapt `src/middleware.ts`:
  - Public routes: `/`, `/login`, `/api/auth/*`, `/api/trpc/*`, shared vibe card pages
  - Protected: everything else
- [ ] Copy `src/app/api/auth/[...all]/route.ts` (Better Auth catch-all)
- [ ] Build `getValidToken(userId)` helper for lazy Spotify token refresh
  - Read from Better Auth's `account` table via Kysely
  - Check `accessTokenExpiresAt`, refresh if expired via Spotify token endpoint
  - Write new token back to `account` table
  - Handle `invalid_grant` → mark user `needs_reauth`
- [ ] Note: redirect URI must use `127.0.0.1:3000` not `localhost` (Spotify restriction)

**PR:** "Auth: Better Auth with Spotify OAuth and token management"

---

## Phase 4 — tRPC Scaffold

Copy the full type-safe API layer structure.

- [ ] Copy `src/server/trpc.ts`:
  - `createTRPCContext()` with Better Auth session
  - `publicProcedure`, `protectedProcedure`
  - Add Vibe Tape specific: procedure that checks tier/song limits
- [ ] Copy `src/lib/trpc/client.tsx` (TRPCReactProvider with httpBatchStreamLink + superjson)
- [ ] Copy `src/lib/trpc/server.ts` (server-side caller)
- [ ] Copy `src/app/api/trpc/[trpc]/route.ts` (tRPC fetch handler)
- [ ] Create `src/server/routers/_app.ts` with initial empty routers: `health`, `library`, `playlist`
- [ ] Copy ownership verification pattern from `src/server/routers/ownership/` — adapt for playlist/session ownership

**PR:** "tRPC scaffold: context, procedures, client, server caller"

---

## Phase 5 — Frontend Shell

Copy the app structure and layout patterns.

- [ ] Copy `src/app/layout.tsx` (root layout with font, metadata, Providers wrapper)
  - Update metadata for Vibe Tape
  - Keep Inter font or swap
- [ ] Copy `src/app/globals.css` (CSS reset, custom properties, light/dark mode)
- [ ] Copy `src/components/providers.tsx` (TRPCReactProvider wrapper)
- [ ] Create route group structure:
  - `src/app/(auth)/` — login page (Spotify OAuth only, much simpler than Telltale)
  - `src/app/(auth)/layout.tsx` — centered layout
  - `src/app/(app)/` — authenticated app shell
  - `src/app/(app)/layout.tsx` — session check + redirect, header with user info + sign-out
- [ ] Create placeholder pages: `/dashboard`, `/generate` (seed picker will go here)

**PR:** "Frontend shell: layouts, route groups, auth pages"

---

## Phase 6 — Backend Structure (Layers)

Set up the layered architecture pattern (routers → services → repositories → domain).

- [ ] Create directory structure:
  - `src/repositories/` — Kysely queries (user, song, playlist)
  - `src/services/` — business logic (vibe generation, library sync)
  - `src/domain/` — TypeScript types only (user, song, playlist, vibe)
- [ ] Create skeleton repository files with basic CRUD for User, Song, Playlist
- [ ] Create `src/lib/anthropic.ts` (Anthropic SDK client singleton, same pattern as Telltale)
- [ ] Wire up a `health` router as smoke test (copy from Telltale)

**PR:** "Backend structure: repositories, services, domain types"

---

## Phase 7 — Testing Infrastructure

Ensure the test pipeline works end-to-end.

- [ ] Copy `src/test/setup.ts` (test setup with jest-dom matchers)
- [ ] Verify `vitest.config.ts` setup file reference
- [ ] Copy CI workflow from `.github/workflows/` — adapt for Vibe Tape (lint, typecheck, test)
- [ ] Write one smoke test per layer to validate the pipeline:
  - Component test (e.g., providers render)
  - Repository test using mock-db
  - tRPC router test
- [ ] Verify `npm run test`, `npm run lint`, `npm run typecheck` all pass

**PR:** "Testing infrastructure: Vitest, Playwright, CI, smoke tests"

---

## Decisions

- **CSS Modules** — same as Telltale. Confirmed.
- **tRPC** — adopting tRPC instead of the raw API routes listed in tech-stack.md. The route patterns become tRPC procedures. Confirmed.
- **Spotify token storage** — use Better Auth's built-in `account` table. The genericOAuth plugin stores `accessToken`, `refreshToken`, `accessTokenExpiresAt` there automatically. The `getValidToken(userId)` helper reads/updates that table via Kysely. No separate table needed.
- **Email service:** Skipping. Vibe Tape doesn't need transactional email in MVP.
- **Admin/approval system:** Skipping. All users are self-serve — no `approvedProcedure` or admin routes.

## Open Questions

None yet.
