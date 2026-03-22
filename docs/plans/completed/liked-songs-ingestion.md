# Liked Songs Ingestion + Storage

**Status:** Complete (all 5 phases done)
**Created:** 2026-03-21
**Goal:** Fetch a user's liked songs from Spotify, store them in the database, and expose a manual sync action via tRPC so the dashboard can trigger ingestion. Sync runs as a background job via Inngest to avoid Vercel function timeouts.

**Current state (2026-03-21):** All phases implemented and merged to main. Inngest is deployed to production via Vercel integration. The `INNGEST_SERVE_ORIGIN` env var is set for production; manual sync was required to get the initial app registered in Inngest Cloud.

---

## Phase 1 — Inngest Setup

Add Inngest as the background job infrastructure (see ADR 009).

- [ ] `npm install inngest`
- [ ] Add Inngest Dev Server to `docker-compose.yml`:
  ```yaml
  inngest:
    image: inngest/inngest:latest
    ports:
      - "8288:8288"
    environment:
      INNGEST_DEV: 1
    extra_hosts:
      - "host.docker.internal:host-gateway"
  ```
- [ ] Add `INNGEST_DEV=1` to `.env.local` (tells the Inngest SDK to send events to the local Dev Server instead of cloud)
- [ ] Add `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` to `.env.example` (needed for production, not local dev)
- [ ] Create `src/lib/inngest.ts` — Inngest client singleton (`id: "vibe-tape"`)
- [ ] Create `src/app/api/inngest/route.ts` — serve Inngest API (GET, POST, PUT)
- [ ] Add `/api/inngest` to the public routes list in `src/middleware.ts` (Inngest needs to reach this endpoint)
- [ ] Verify local dev works: `docker compose up` then `npm run dev` — Inngest Dev Server at `http://localhost:8288` should auto-discover functions via `host.docker.internal:3000/api/inngest`
- [ ] Verify `getValidToken` (which imports `"server-only"`) works when called from an Inngest step running via the API route serve handler

**PR:** "Add Inngest background job infrastructure"

---

## Phase 2 — Spotify API Client

Build a thin wrapper for Spotify REST calls that handles pagination.

- [ ] Create `src/lib/spotify.ts` with a `fetchLikedSongs(accessToken)` function
  - Paginate `GET /me/tracks` (Spotify returns 50 per page max)
  - Handle 429 (rate limit) responses with retry-after backoff
  - Return array of `{ spotifyId, name, artist, album, albumArtUrl, likedAt }`
  - Map Spotify's response shape to our domain shape (Spotify nests track data under `track`)
- [ ] Add tests for the mapper (unit test the response → domain transform, mock fetch)

**PR:** "Add Spotify liked songs API client"

---

## Phase 3 — Track Repository Write Methods

Schema was normalized: `song` table replaced with `track` (one row per Spotify track) + `liked_song` (user-track join table). The `trackRepository` replaces `songRepository`.

- [x] Add `upsertMany(userId, songs)` to `src/repositories/track.repository.ts`
  - Transactional: upserts tracks (on conflict by `spotifyId`), then upserts `liked_song` join rows (on conflict `(userId, trackId)` do nothing)
  - Chunks into batches of 500 to stay within Postgres parameter limits
- [x] Add `updateSyncStatus(userId)` to `src/repositories/user.repository.ts`
  - Counts `liked_song` rows for user, updates `user.songCount` and `user.lastSyncedAt`
- [x] Add tests for repository methods using mock-db

**PR:** "Add track upsert and user sync tracking to repositories"

---

## Phase 4 — Library Sync Inngest Function

Background job that orchestrates token refresh → Spotify fetch → DB storage using Inngest step functions.

- [x] Create `src/inngest/functions/sync-library.ts`
  - Event: `library/sync.requested` with `{ userId }` payload
  - Step 1 (`get-token`): Call `getValidToken(userId)` — if null, throw descriptive error so Inngest retries or marks failed
  - Step 2 (`fetch-songs`): Call `fetchLikedSongs(accessToken)` — full pagination in a single step. Rate limit 429s are handled internally by `fetchLikedSongs` with retry-after backoff. If the step fails entirely, Inngest retries it from the beginning (re-fetches all pages). This is acceptable for MVP — per-page steps would burn through the 50k/month free tier.
  - Step 3 (`upsert-songs`): Call `trackRepository.upsertMany(userId, songs)`
  - Step 4 (`update-status`): Call `userRepository.updateSyncStatus(userId)`
  - Steps are independently retryable — a failure in upsert doesn't re-fetch from Spotify
  - Configure: 3 retries per step
  - Concurrency limit of 1 per userId prevents parallel syncs
- [x] Register function in `src/app/api/inngest/route.ts`
- [x] Add tests for the function (mock steps)

**PR:** "Add library sync Inngest function"

---

## Phase 5 — tRPC Router + Dashboard Trigger

Expose sync via tRPC and add a button to the dashboard.

- [x] Create `src/server/routers/library.ts` with:
  - `sync` mutation — fires `inngest.send({ name: "library/sync.requested", data: { userId } })`, returns `{ status: "started" }`. Inngest idempotency prevents duplicate in-flight syncs.
  - `list` query — calls `trackRepository.findByUserId(userId)`, returns tracks
  - `count` query — calls `trackRepository.countByUserId(userId)`
- [x] Register library router in `src/server/routers/_app.ts`
- [x] Add `syncStatus` query — returns user's current sync status (`IDLE`, `SYNCING`, `FAILED`)
- [x] Add "Sync Library" button to dashboard page
  - Call `trpc.library.sync.useMutation()` on click
  - Show "Syncing..." state driven by real `syncStatus` polling (every 2s while syncing)
  - Display song count, refresh automatically when sync completes
  - Disable button while sync is in progress (server-side check prevents duplicate syncs)
  - Show error states for both sync failures and count query errors
- [x] Add router and component tests

**PR:** "Add library tRPC router and dashboard sync button"

---

## Decisions

- **Background job via Inngest** — sync runs as an Inngest function to avoid Vercel's 10s function timeout. Each step (token, fetch, upsert, status update) is independently retryable. See ADR 009.
- **Manual sync only** — no auto-sync or cron for now. User clicks a button.
- **No tier cap enforcement yet** — fetch all liked songs regardless of tier. Cap comes later.
- **Normalized schema** — `track` stores unique Spotify tracks (upsert on `spotifyId`), `liked_song` is the user-track join (upsert on `(userId, trackId)` do nothing). Metadata is shared across users, not duplicated per-user.
- **Upsert strategy** — tracks upsert on `spotifyId` conflict (updating metadata). Liked songs use do-nothing on conflict since the relationship is immutable.
- **No incremental sync yet** — full fetch on each sync. Incremental (using `likedAt` watermark) is a future optimization.
- **Batch inserts at 500 rows** — avoids Postgres parameter limits on large libraries.
- **SpotifyLikedSong type** — the Spotify API client type was renamed from `LikedSong` to `SpotifyLikedSong` to avoid collision with the domain `LikedSong` type (the join table model).
- **Token failure handling** — if `getValidToken` returns null, the Inngest step throws an error. After retries exhaust, job is marked failed in the Inngest dashboard. User sees stale song count and can retry.
- **Pagination is a single Inngest step** — splitting into per-page steps would be more resilient but burns through the 50k/month free tier quickly (100 pages = 100 executions per sync). Instead, `fetchLikedSongs` handles 429 rate limits internally with retry-after backoff. If the step fails entirely, Inngest retries the whole fetch — acceptable at MVP scale.
- **Concurrent sync prevention** — concurrency limit of 1 per userId in Inngest, plus server-side `syncStatus` check in the tRPC mutation. Idempotency key was removed because it blocked intentional re-syncs within the 24h dedup window.
- **Sync status tracking** — `syncStatus` enum (`IDLE`, `SYNCING`, `FAILED`) on the `user` table. Set to `SYNCING` at function start, `IDLE` on success, `FAILED` on error. Dashboard polls every 2s while syncing.
- **Spotify rate limiting** — handled inside `fetchLikedSongs` with retry-after backoff on 429 responses, not at the Inngest step level.
- **Inngest Dev Server via Docker** — runs as a docker-compose service alongside Postgres rather than a separate `npx inngest-cli dev` process. One `docker compose up` starts all infrastructure. The container uses `host.docker.internal` to reach the Next.js dev server on the host.

## Open Questions

- None — all review items resolved.
