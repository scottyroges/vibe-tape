# Vibe Tape — Tech Stack & Architecture

> *March 2026 — Draft*

---

## Guiding Principle

Free for as long as possible. Every infrastructure choice prioritizes free tiers and zero fixed cost until there is real revenue. Complexity is only introduced when it solves a specific problem. We own the parts that are core to the product; we delegate the parts that are commodity.

---

## Stack Overview

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js + TypeScript | App Router, server components, API routes all in one. Same stack as other projects. |
| Hosting | Vercel | Free tier, built-in cron, deploys on git push. Zero config. |
| Database | Neon (Postgres) | Free tier handles thousands of users. Serverless, scales to zero. |
| Auth | Better Auth + genericOAuth plugin | Session management + Spotify OAuth. We own token storage separately. |
| File storage | Cloudflare R2 | 10GB free. Stores AI-generated art cards and cached images. |
| Payments | Stripe | Free until you collect money. Per-transaction fee only. |
| AI — vibe analysis | Claude API (Sonnet + Haiku) | Sonnet for playlist generation (~$0.01–0.02/gen). Haiku for track classification (mood, energy, danceability, vibe tags) during enrichment. |
| AI — art generation | Stable Diffusion (Replicate) | ~$0.005/image. Deferred to Tier 2. GPT-4o image gen as alternative (~$0.06). |
| Music metadata | Last.fm API + MusicBrainz | Genre tags, BPM, era data. Free. Replaces Spotify audio features (removed Nov 2024). |
| Background jobs | Inngest (free tier) | 50k executions/month free. Native Next.js/Vercel integration. Step functions with retries. See [ADR 009](decisions/009-async-job-processing.md). |
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
- Store new `access_token` and updated `token_expires_at` back to Neon
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
| `track` | `id`, `spotify_id`, `name`, `artist`, `album`, `album_art_url`, `derived_era`, `claude_mood`, `claude_energy`, `claude_danceability`, `claude_vibe_tags`, `lastfm_tags`, `enrichment_version` |
| `liked_song` | `id`, `user_id`, `track_id`, `liked_at` |
| `playlists` | `id`, `user_id`, `spotify_playlist_id`, `vibe_name`, `vibe_description`, `seed_song_ids`, `art_image_url`, `last_synced_at` |
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
| `library` | `sync`, `list`, `search` | Tier 1 |
| `playlist` | `generate`, `list`, `getById`, `refresh` | Tier 1 |
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

Background jobs run via **Inngest** — a managed job queue that integrates natively with Next.js on Vercel. Jobs are defined as step functions where each step is independently retryable. See [ADR 009](decisions/009-async-job-processing.md) for the full decision and migration path.

### How it works

The Inngest SDK exposes a serve handler at `/api/inngest`. The Inngest server (cloud in production, Docker container in local dev) discovers registered functions via this endpoint and invokes them by sending HTTP requests back to it. Functions are defined in `src/inngest/functions/` and registered in the serve handler.

In production, requests to `/api/inngest` are authenticated via request signing (`INNGEST_SIGNING_KEY`). In local dev (`INNGEST_DEV=1`), signature verification is disabled.

### Local development

The Inngest Dev Server runs as a Docker Compose service alongside Postgres. `docker compose up` starts both. The Dev Server dashboard is at `http://localhost:8288` and auto-discovers functions via `host.docker.internal:3000/api/inngest`.

### Jobs

- **Library sync** (`sync-library`) — Fetches a user's Spotify liked songs and upserts to database. Four steps: get token, fetch songs, upsert tracks, update sync status. Triggered by `library/sync.requested` event with `{ userId }`. Idempotent per user with concurrency limit of 1.
- **Nightly auto-sync** (future) — batch-refresh all users' libraries on a schedule via Vercel cron triggering an Inngest event.
- **AI art generation** (Tier 2+) — generate vibe card art async after playlist creation. Cache in R2.

---

## Cost Model

| Cost item | Unit cost | ~300 users/mo | Free tier |
|-----------|-----------|---------------|-----------|
| Claude (vibe analysis) | ~$0.015/gen | ~$9/mo | N/A |
| SD image generation | ~$0.005/image | ~$3/mo | Skip for free users |
| Inngest (background jobs) | — | $0 | Free 50k executions/mo |
| Vercel hosting | — | $0 (hobby tier) | Free |
| Neon database | — | $0 (free tier) | Free |
| Cloudflare R2 | — | < $1/mo | Free 10GB |
| Last.fm API | — | $0 | Free |

**Total variable cost at 300 users: ~$12–15/month against ~$250/month revenue.**
