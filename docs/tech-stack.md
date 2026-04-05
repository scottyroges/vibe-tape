# Vibe Tape — Tech Stack & Architecture

> *March 2026 — Draft*
>
> **Status: Personal use only.** See [ADR 010](decisions/010-personal-use-only.md).
> Vibe Tape runs locally against Docker Postgres and a local Inngest Dev Server.
> There is no hosted environment. Sections below describing payments, tiered
> plans, cost models, or cloud services are kept as historical context from
> when the project was planned as a product.

---

## Guiding Principle

Runs entirely on the developer's machine. Docker Compose brings up Postgres
and the Inngest Dev Server; `next dev` handles the app. External API calls
(Spotify, Claude, Last.fm) go straight from the laptop to the upstream
service — nothing sits in between.

---

## Stack Overview

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js + TypeScript | App Router, server components, API routes all in one. |
| Hosting | Local only (`next dev`) | No production environment. See [ADR 010](decisions/010-personal-use-only.md). |
| Database | Postgres (Docker Compose) | Local container via `docker compose up`. Schema managed by Prisma, queries via Kysely. |
| Auth | Better Auth + genericOAuth plugin | Session management + Spotify OAuth. We own token storage separately. |
| AI — vibe analysis | Claude API (Sonnet + Haiku) | Sonnet for playlist generation. Haiku for track classification (mood, energy, danceability, vibe tags) during enrichment. Mood is constrained at the prompt level to an 11-value canonical vocabulary (see `CANONICAL_MOODS` in `src/lib/prompts/classify-tracks.ts`). |
| Music metadata | Last.fm API | Genre tags via artist/track tag endpoints. Replaces Spotify audio features (removed Nov 2024). |
| Background jobs | Inngest Dev Server (Docker) | Step functions with retries, run locally. See [ADR 009](decisions/009-async-job-processing.md). |
| Spotify integration | Raw REST API (no SDK) | Official SDK is poorly maintained and broke in Feb 2026. Direct fetch calls are ~150 lines and we own them fully. |

---

## Spotify Authentication

### Flow choice: Authorization Code (not PKCE)

We run a server-side Next.js app and can safely store the client secret. Authorization Code flow gives us a long-lived refresh token, which is essential for background sync jobs that run without user interaction.

Better Auth's `genericOAuth` plugin handles the OAuth dance and session cookie. We manually store the Spotify tokens in our own `users` table alongside the Better Auth session.

**Scopes requested:**
- `user-read-email` — required by Better Auth to create user accounts
- `user-library-read` — read liked songs
- `playlist-modify-public` — create/update public playlists
- `playlist-modify-private` — create/update private playlists

### Initial login flow

1. User clicks login → redirect to `accounts.spotify.com/authorize` with scopes + state param
2. Spotify redirects to `/api/auth/oauth2/callback/spotify` with authorization code
3. Server exchanges code for `access_token` + `refresh_token` via `POST accounts.spotify.com/api/token`
4. Tokens stored in `users` table with `token_expires_at` timestamp
5. Better Auth sets session cookie (30-day expiry, refreshed daily)

### Token refresh strategy

**Lazy refresh** — tokens are only refreshed immediately before an API call that needs them. No scheduled refresh job.

- Access tokens expire after **1 hour**
- Refresh tokens last **indefinitely** (until user revokes app access)
- Every Spotify API call goes through a `getValidToken(userId)` helper
- Helper checks `token_expires_at` against current time
- If expired: `POST accounts.spotify.com/api/token` with `refresh_token`
- Store new `access_token` and updated `token_expires_at` back to Postgres
- If refresh fails with `invalid_grant`: mark user as `needs_reauth`, skip in sync jobs, prompt on next login

### Local development note

Spotify no longer supports `localhost` as a redirect URI (deprecated Nov 2025). Use `http://127.0.0.1:3000` and set `BETTER_AUTH_URL=http://127.0.0.1:3000` in `.env`. The Spotify Developer Dashboard redirect URI must be set to `http://127.0.0.1:3000/api/auth/oauth2/callback/spotify`.

---

## Data Architecture

### Key tables

| Table | Key fields |
|-------|-----------|
| `users` | `id`, `spotify_id`, `email`, `access_token`, `refresh_token`, `token_expires_at`, `tier`, `song_count`, `needs_reauth` |
| `sessions` | Managed by Better Auth — `id`, `user_id`, `expires_at`, `token` |
| `track` | `id`, `spotify_id`, `name`, `album`, `album_art_url`, `vibe_mood`, `vibe_energy`, `vibe_danceability`, `vibe_genres`, `vibe_tags`, `vibe_version` |
| `track_spotify_enrichment` | `track_id` (PK/FK), `popularity`, `duration_ms`, `release_date`, `derived_era`, `version` |
| `track_claude_enrichment` | `track_id` (PK/FK), `mood`, `energy`, `danceability`, `vibe_tags`, `version` |
| `track_lastfm_enrichment` | `track_id` (PK/FK), `tags`, `version` |
| `artist_spotify_enrichment` | `artist_id` (PK/FK), `genres`, `version` |
| `artist_lastfm_enrichment` | `artist_id` (PK/FK), `tags`, `version` |
| `liked_song` | `id`, `user_id`, `track_id`, `liked_at` |
| `playlist` | `id`, `user_id`, `spotify_playlist_id`, `vibe_name`, `vibe_description`, `seed_song_ids`, `status` (`PlaylistStatus` enum), `generated_track_ids`, `target_duration_minutes`, `user_intent`, `claude_target` (JSONB), `math_target` (JSONB), `error_message`, `art_image_url`, `last_synced_at` |
| `group_sessions` | `id`, `host_user_id`, `participant_ids`, `seed_song_ids`, `status`, `playlist_id`, `expires_at` | Tier 3 — not in schema yet |
| `guest_passes` | `id`, `created_by_user_id`, `session_id`, `used_at`, `spotify_id` (null until used) | Tier 3 — not in schema yet |

---

## API Layer

All app logic is exposed via tRPC procedures (see [ADR 002](decisions/002-trpc-api-layer.md)). The only raw API routes are auth and infrastructure handlers.

### Raw routes
- `GET/POST /api/auth/[...all]` — Better Auth handler (login, callback, session management)
- `GET/POST /api/trpc/[trpc]` — tRPC fetch adapter
- `GET/POST/PUT /api/inngest` — Inngest serve handler (receives events and invokes background functions)

### tRPC routers (planned)

| Router | Key procedures | Tier |
|--------|---------------|------|
| `health` | `ping` | Implemented |
| `library` | `sync`, `list`, `search` | Tier 1 (partial) |
| `playlist` | `generate`, `getById`, `save`, `discard`, `list`, `refresh` | Tier 1 (`generate` / `getById` / `save` / `discard` implemented) |
| `session` | `create`, `join`, `generate` | Tier 3 |

---

## Vibe Generation Pipeline

This is the core product logic. Runs on every playlist generation request.

1. Receive `seed_song_ids` (3–5 songs) from client
2. Fetch song metadata from DB (name, artist, Last.fm genres, BPM, era)
3. Send to Claude: *"What do these songs have in common? Return a vibe name, one-line descriptor, and 5–8 matching criteria as a JSON object."*
4. Claude returns structured criteria (tempo range, energy level, mood keywords, genre tags, era range)
5. Score all songs in user's library against criteria using weighted sum
6. Take top 20–30 songs by score
7. `POST /me/playlists` — create Spotify playlist
8. `POST /playlists/{id}/tracks` — add songs
9. Queue AI art generation job (async, Tier 2+)
10. Return playlist URL + vibe card data to client

---

## Background Processing

Background jobs run via **Inngest**. Jobs are defined as step functions where each step is independently retryable. See [ADR 009](decisions/009-async-job-processing.md) for the full decision.

### How it works

The Inngest SDK exposes a serve handler at `/api/inngest`. The Inngest Dev
Server (a Docker Compose container) discovers registered functions via this
endpoint and invokes them by sending HTTP requests back to it. Functions are
defined in `src/inngest/functions/` and registered in the serve handler.
With `INNGEST_DEV=1` set in `.env`, signature verification is disabled so the
Dev Server can reach the endpoint without signing keys.

### Local development

The Inngest Dev Server runs as a Docker Compose service alongside Postgres. `docker compose up` starts both. The Dev Server dashboard is at `http://localhost:8288` and auto-discovers functions via `host.docker.internal:3000/api/inngest`.

### Jobs

- **Library sync** (`sync-library`) — Fetches the user's Spotify liked songs, upserts to database, and runs Spotify + Claude enrichment. Triggered by `library/sync.requested` event with `{ userId }`. Idempotent per user with concurrency limit of 1. After completing, emits `enrichment/lastfm.requested` to trigger Last.fm enrichment asynchronously.
- **Last.fm enrichment** (`enrich-lastfm`) — Fetches Last.fm tags for artists and tracks with stale or missing enrichment. Runs independently from library sync with global concurrency of 1 (rate-limit friendly). Dual trigger: the `enrichment/lastfm.requested` event (emitted by sync-library) and a daily cron (`0 0 * * *`) set on the Inngest function itself — fires while the Dev Server is running.
- **Playlist generation** (`generate-playlist`) — Builds a playlist recipe from 3–5 seed tracks using the hybrid Claude + math scoring pipeline. Triggered by `playlist/generate.requested` after the `playlist.generate` tRPC mutation inserts a `GENERATING` placeholder row; the function loads seeds, gets a Claude target + vibe name/description, computes a math centroid target, scores the user's library via the shared `scoreLibrary` helper, ranks/caps/truncates/shuffles, and flips the row to `PENDING`. Concurrency keyed on `playlistId` (limit 1) so retries can't race. `onFailure` marks the row `FAILED`. No Spotify push happens here — that waits for the user to click Save. Regenerate and top-up ship as sibling functions in a later PR. See `docs/plans/active/playlist-generation-hybrid.md`.
