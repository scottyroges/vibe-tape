# Liked Songs Ingestion + Storage

**Status:** Not Started
**Created:** 2026-03-21
**Goal:** Fetch a user's liked songs from Spotify, store them in the database, and expose a manual sync action via tRPC so the dashboard can trigger ingestion. Sync runs as a background job via Inngest to avoid Vercel function timeouts.

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
  - Return array of `{ spotifyId, name, artist, album, albumArtUrl, addedAt }`
  - Map Spotify's response shape to our domain shape (Spotify nests track data under `track`)
- [ ] Add tests for the mapper (unit test the response → domain transform, mock fetch)

**PR:** "Add Spotify liked songs API client"

---

## Phase 3 — Song Repository Write Methods

The song repository exists with read methods. Add the write methods needed for ingestion.

- [ ] Add `upsertMany(userId, songs)` to `src/repositories/song.repository.ts`
  - Batch insert using Kysely's `insertInto().values().onConflict()` on `(userId, spotifyId)`
  - On conflict, update metadata fields (name, artist, album, albumArtUrl) in case they changed
  - Chunk inserts into batches of 500 to stay within Postgres parameter limits (~32,767 max)
- [ ] Add `updateSyncStatus(userId)` to `src/repositories/user.repository.ts`
  - Update `user.songCount` with `SELECT COUNT(*)` from song table (idempotent)
  - Update `user.lastSyncedAt` to current timestamp
- [ ] Add tests for repository methods using mock-db

**PR:** "Add song upsert and user sync tracking to repositories"

---

## Phase 4 — Library Sync Inngest Function

Background job that orchestrates token refresh → Spotify fetch → DB storage using Inngest step functions.

- [ ] Create `src/inngest/functions/sync-library.ts`
  - Event: `library/sync.requested` with `{ userId }` payload
  - Step 1 (`get-token`): Call `getValidToken(userId)` — if null, throw descriptive error so Inngest retries or marks failed
  - Step 2 (`fetch-songs`): Call `fetchLikedSongs(accessToken)` — full pagination in a single step. Rate limit 429s are handled internally by `fetchLikedSongs` with retry-after backoff. If the step fails entirely, Inngest retries it from the beginning (re-fetches all pages). This is acceptable for MVP — per-page steps would burn through the 50k/month free tier.
  - Step 3 (`upsert-songs`): Call `songRepository.upsertMany(userId, songs)`
  - Step 4 (`update-status`): Call `userRepository.updateSyncStatus(userId)`
  - Steps are independently retryable — a failure in upsert doesn't re-fetch from Spotify
  - Configure: 3 retries per step
  - Use Inngest idempotency key (`userId`) with a short concurrency window to prevent duplicate syncs if user clicks the button twice
- [ ] Register function in `src/app/api/inngest/route.ts`
- [ ] Add tests for the function (mock steps)

**PR:** "Add library sync Inngest function"

---

## Phase 5 — tRPC Router + Dashboard Trigger

Expose sync via tRPC and add a button to the dashboard.

- [ ] Create `src/server/routers/library.ts` with:
  - `sync` mutation — fires `inngest.send({ name: "library/sync.requested", data: { userId } })`, returns `{ status: "started" }`. Inngest idempotency prevents duplicate in-flight syncs.
  - `list` query — calls `songRepository.findByUserId(userId)`, returns songs
  - `count` query — calls `songRepository.countByUserId(userId)`
- [ ] Register library router in `src/server/routers/_app.ts`
- [ ] Add "Sync Library" button to dashboard page
  - Call `trpc.library.sync.useMutation()` on click
  - Show "Syncing..." state (optimistic — job runs in background)
  - Display song count (poll `trpc.library.count` or refresh on next page load)
- [ ] Add router tests

**PR:** "Add library tRPC router and dashboard sync button"

---

## Decisions

- **Background job via Inngest** — sync runs as an Inngest function to avoid Vercel's 10s function timeout. Each step (token, fetch, upsert, status update) is independently retryable. See ADR 009.
- **Manual sync only** — no auto-sync or cron for now. User clicks a button.
- **No tier cap enforcement yet** — fetch all liked songs regardless of tier. Cap comes later.
- **Upsert strategy** — use `ON CONFLICT (userId, spotifyId)` to handle re-syncs cleanly. Metadata gets updated, no duplicates.
- **No incremental sync yet** — full fetch on each sync. Incremental (using `addedAt` watermark) is a future optimization.
- **Batch inserts at 500 rows** — avoids Postgres parameter limits on large libraries.
- **Token failure handling** — if `getValidToken` returns null, the Inngest step throws an error. After retries exhaust, job is marked failed in the Inngest dashboard. User sees stale song count and can retry.
- **Pagination is a single Inngest step** — splitting into per-page steps would be more resilient but burns through the 50k/month free tier quickly (100 pages = 100 executions per sync). Instead, `fetchLikedSongs` handles 429 rate limits internally with retry-after backoff. If the step fails entirely, Inngest retries the whole fetch — acceptable at MVP scale.
- **Concurrent sync prevention** — use Inngest's idempotency key on `userId` so multiple clicks don't spawn parallel jobs.
- **Spotify rate limiting** — handled inside `fetchLikedSongs` with retry-after backoff on 429 responses, not at the Inngest step level.
- **Inngest Dev Server via Docker** — runs as a docker-compose service alongside Postgres rather than a separate `npx inngest-cli dev` process. One `docker compose up` starts all infrastructure. The container uses `host.docker.internal` to reach the Next.js dev server on the host.

## Open Questions

- None — all review items resolved.
