# Track Enrichment Pipeline

**Status:** Not Started
**Created:** 2026-03-21
**Goal:** After library sync, enrich tracks with metadata from multiple sources (Spotify, Last.fm, Claude) to enable vibe-based playlist generation. The pipeline should be extensible — easy to add new data sources and re-enrich when sources or prompts improve.

---

## Context

Vibe analysis (roadmap item 4) requires Claude to return structured scoring criteria that we can query against. Today, tracks only have name/artist/album — nothing queryable for mood, genre, energy, etc. We need enrichment data on each track so that when Claude says "melancholic indie from the 2000s with low energy," we can actually filter the DB.

### Data Sources

| Source | Data | Cost | Coverage |
|--------|------|------|----------|
| **Spotify** `/me/tracks` | spotifyPopularity, spotifyReleaseDate (→ derivedEra), spotifyDurationMs | Free | 100% — already in the response we fetch |
| **Spotify** `/artists` | spotifyGenres (array per artist) | Free | ~90% of artists |
| **Last.fm** `track.getInfo` | genre tags (user-contributed) | Free | Good for popular tracks |
| **Claude** (Haiku 4.5, Batch API) | mood, energy, danceability, vibe descriptors | ~$0.03/user library | ~99% — anything Claude recognizes |

---

## Full Pipeline Overview

All steps run inside one Inngest function (`sync-library`). User sees "Syncing..." throughout.

### Vercel Timeout Constraint

Vercel serverless functions have a **60-second timeout** (Pro plan). Each Inngest `step.run()` is a separate function invocation, so each step must complete within 60 seconds. Steps that process variable-length lists (songs, artists, tracks) must use a **chunked loop pattern**: process up to N items per step invocation, persist results to DB, and loop if more items remain. Inngest supports this natively — a step can return, and the function continues with the next step or loops back.

### Steps

Each enrichment target (artists, tracks) has independent sub-steps per data source. Each source has different rate limits, chunk sizes, and failure modes — keeping them as separate sub-steps means a Last.fm failure doesn't block Spotify genres, and each can be retried independently.

```
Step 1:   set-syncing                                           DB
Step 2:   get-token                                             DB
Step 3:   fetch-songs                                           Spotify API    CHUNKED
Step 4:   upsert-data                                           DB             CHUNKED

          ── Artist Enrichment ──
Step 5a:  enrich-artists/spotify-genres                         Spotify API    CHUNKED
Step 5b:  enrich-artists/lastfm-tags                            Last.fm API    CHUNKED
Step 5c:  enrich-artists/set-version                            DB             CHUNKED

          ── Track Enrichment ──
Step 6a:  enrich-tracks/era                                     DB             CHUNKED
Step 6b:  enrich-tracks/claude-classify                         Claude API     CHUNKED
Step 6c:  enrich-tracks/lastfm-tags                             Last.fm API    CHUNKED
Step 6d:  enrich-tracks/set-version                             DB             CHUNKED

Step 7:   update-status                                         DB
```

Notes:
- **5a/5b run in parallel** — Inngest supports parallel step execution. 5a (Spotify genres, ~5s) and 5b (Last.fm artist tags, ~40s) fetch from different APIs and write to separate columns. Running them in parallel means artist enrichment takes ~40s instead of ~45s. 5c (set-version) runs after both complete.
- **6a/6b/6c run in parallel** — 6a (era, ~2s), 6b (Claude, ~15s), and 6c (Last.fm track tags, ~40s) all write to separate columns. 6d (set-version) runs after all three complete. Total time is ~40s (Last.fm bottleneck) instead of ~57s sequential.
- **Parallel chunked loops** — each parallel sub-step still uses the chunked loop pattern internally. Inngest runs the parallel groups concurrently; each group's chunks run sequentially within that group.
- **Sub-steps within a group share the same "stale" query** — they target artists/tracks where `enrichmentVersion < CURRENT_VERSION`.
- **The set-version step is separate and sequenced after the parallel group** — 5c/6d are plain `step.run()` calls placed after the parallel block. Inngest guarantees they only execute once ALL parallel sub-steps have succeeded. If 5b fails, Inngest retries 5b; 5c never runs until 5b succeeds. All source sub-steps are idempotent (upsert/overwrite), so retries are safe.

### Chunked Loop Pattern

Sub-steps marked CHUNKED use the same pattern to stay within the 60s Vercel timeout:

```typescript
let offset = 0;
while (true) {
  const processed = await step.run(`enrich-artists/spotify-genres-${offset}`, async () => {
    const stale = await artistRepo.findStale(CURRENT_VERSION, CHUNK_SIZE, offset);
    if (stale.length === 0) return 0;
    // ... fetch from API, write to DB ...
    return stale.length;
  });
  if (processed < CHUNK_SIZE) break;
  offset += CHUNK_SIZE;
}
```

Each chunk is its own Inngest step invocation → own 60s window, independently retryable.

### Chunk sizes (tuned to stay well under 60s)

| Sub-step | Chunk size | Bottleneck | ~Time/chunk |
|----------|-----------|------------|-------------|
| fetch-songs | 2,000 tracks | Spotify pagination | ~20s |
| upsert-data | 500 tracks | DB transactions | ~5s |
| artists/spotify-genres | 500 artists (10 batches of 50) | Spotify API | ~5s |
| artists/lastfm-tags | 200 artists | Last.fm 5/sec | ~40s |
| artists/set-version | 1,000 artists | Pure DB | ~2s |
| tracks/era | 1,000 tracks | Pure DB | ~2s |
| tracks/claude-classify | 500 tracks (10 batches of 50) | Claude API | ~15s |
| tracks/lastfm-tags | 200 tracks | Last.fm 5/sec | ~40s |
| tracks/set-version | 1,000 tracks | Pure DB | ~2s |

### Totals for ~1,500 tracks, ~800 artists (first sync)

```
  Spotify API:  ~46 calls (30 /me/tracks pages + 16 /artists batches)
  Claude API:   ~30 calls (~$0.06)
  Last.fm API:  ~2,300 calls (~800 artists + 1,500 tracks, ~8 min total)
  DB queries:   ~100 (all bulk, zero N+1)
```

Subsequent syncs are fast — only newly liked tracks/artists need enrichment.

### Inngest Execution Budget

Each `step.run()` counts as one execution against the 50k/month free tier.

```
First sync (~1,500 tracks, ~800 artists):
  Steps 1-4:    ~5 invocations (set-syncing, get-token, fetch chunks, upsert chunks)
  Steps 5a-5c:  ~8 invocations (2 spotify chunks + 4 lastfm chunks + 1 set-version + overhead)
  Steps 6a-6d:  ~15 invocations (1 era + 3 claude chunks + 8 lastfm chunks + 2 set-version + overhead)
  Step 7:       1 invocation
  Total:        ~30 step invocations per first sync

Subsequent syncs (50 new tracks):
  ~10 step invocations

At 50k free/month: ~1,600 first syncs or ~5,000 incremental syncs before hitting the limit.
```

---

## Phase 1 — Artist Model + Expanded Spotify Data

Normalize artists into their own table, expand the Spotify data we extract, and rewrite the sync pipeline to handle the new schema. Since this is a solo project with only dev data, we nuke existing track/likedSong data — no backfill migration needed.

### Schema Changes

- [ ] **Prisma migration** (destructive — truncate `track`, `liked_song` tables first):
  - New `Artist` table: `id` (cuid), `spotifyId` (@unique), `name`, `spotifyGenres` (String[]), `lastfmTags` (String[]), `enrichmentVersion` (Int, default 0), `enrichedAt` (DateTime?)
  - New `TrackArtist` join table: `trackId`, `artistId`, `order` (Int — preserves artist credit ordering). Unique on `(trackId, artistId)`.
  - Drop `artist` (String) column on Track
  - Add Track columns: `spotifyPopularity` (Int?), `spotifyDurationMs` (Int?), `spotifyReleaseDate` (String?), `enrichmentVersion` (Int, default 0), `enrichedAt` (DateTime?)
  - Change `lastfmGenres` (String?) → `lastfmTags` (String[]) on Track
  - Drop `bpm` column — no reliable source available (Spotify audio features deprecated, Last.fm doesn't have it)
  - Rename `era` → `derivedEra`

### Spotify Data Extraction Changes

- [ ] **Update `SpotifyLikedTrackItem` type** — expand to include `track.popularity`, `track.duration_ms`, `track.album.release_date`, and `track.artists[].id` (currently only captures `name`)
- [ ] **Update `mapTrack()` return type** — new `SpotifyLikedSong` includes `spotifyPopularity`, `spotifyDurationMs`, `spotifyReleaseDate`, and `artists: { spotifyId, name }[]` (array instead of joined string)
- [ ] **Refactor `fetchLikedSongs`** — add optional `startUrl` (Spotify pagination cursor) and `maxTracks` limit params. Returns `{ songs: SpotifyLikedSong[], nextUrl: string | null }` instead of a flat array. Caller uses `nextUrl` to continue in the next chunk.

### Sync Pipeline (Steps 1–4)

- [ ] **Update `sync-library.ts`** — expand existing steps, add chunked loop pattern
- [ ] **Step 3 (fetch-songs)** — chunked loop: each invocation calls `fetchLikedSongs(token, { startUrl, maxTracks: 2000 })`, persists `nextUrl` as step return value for next iteration.
- [ ] **Step 4 (upsert-data)** — replace current `upsert-songs`. Per 500-track transaction:
  1. Deduplicate artists → bulk INSERT artist ON CONFLICT UPDATE name
  2. SELECT artist IDs → build spotifyArtistId → artistId map
  3. Bulk INSERT track ON CONFLICT UPDATE name, album, albumArtUrl, spotifyPopularity, spotifyDurationMs, spotifyReleaseDate
  4. SELECT track IDs → build spotifyTrackId → trackId map
  5. Bulk INSERT track_artist ON CONFLICT DO NOTHING
  6. Bulk INSERT liked_song ON CONFLICT DO NOTHING
  7 queries per transaction, all bulk, no N+1.

### Domain Type Updates

- [ ] **Update `src/domain/song.ts`** — `Track` type: drop `artist: string`, add `spotifyPopularity`, `spotifyDurationMs`, `spotifyReleaseDate`, `derivedEra`, `enrichmentVersion`, `enrichedAt`, `lastfmTags` (String[]), add `spotifyGenres` (String[]) to Artist type. `TrackWithLikedAt` keeps `artist: string` — populated by the query via STRING_AGG, not the column.
- [ ] **Add `Artist` and `TrackArtist` domain types**

### Query Layer Changes

- [ ] **Update `library.list` (findByUserId)** — join through `trackArtist` → `artist` to build artist display name. Use `STRING_AGG` ordered by `trackArtist.order`. Frontend receives the same shape — no changes needed.
- [ ] **Artist repository** — new `src/repositories/artist.repository.ts` with `upsertMany()`, `findStale(version, limit)`, `updateEnrichment()`
- [ ] **Update track repository** — add `findStale(version, limit)`, `updateEnrichment(id, data)`

### Tests

- [ ] Upsert with artists (verify dedup, join table populated correctly)
- [ ] `fetchLikedSongs` chunking (cursor persistence, maxTracks limit)
- [ ] `library.list` query returns correct artist names via join

**PR:** "Add Artist model and expanded Spotify data extraction"

---

## Phase 2 — Enrichment Pipeline Foundation

Add the version-gated enrichment framework and the first two enrichment sources: Spotify artist genres and era derivation.

### Enrichment Framework

- [ ] **`CURRENT_ENRICHMENT_VERSION` constant** — e.g., `src/lib/enrichment.ts`. Single source of truth. Bump to trigger re-enrichment.
- [ ] **Chunked loop helper** — reusable pattern for all enrichment steps (query stale → process chunk → loop if more remain)

### Artist Enrichment (Steps 5a–5c)

- [ ] **Spotify artist genres fetcher** — new function in `src/lib/spotify.ts`: takes artist Spotify IDs, calls `GET /artists?ids=...` (batch of 50), returns map of artistId → genres[]
- [ ] **Step 5a (spotify-genres)** — `GET /artists?ids=...` batch of 50. Chunk 500 artists/step. Write `spotifyGenres` column.
- [ ] **Step 5b (lastfm-tags)** — placeholder no-op until Phase 4 adds Last.fm client.
- [ ] **Step 5c (set-version)** — bulk UPDATE `enrichmentVersion` + `enrichedAt` for all artists processed. Chunk 1,000/step.

### Track Enrichment (Steps 6a–6d)

- [ ] **Era derivation** — pure function: `"2023-06-15" → "2020s"`, `"1995" → "1990s"`, `null → null`
- [ ] **Step 6a (derivedEra)** — derive from `spotifyReleaseDate` in app code. Pure DB, chunk 1,000/step.
- [ ] **Step 6b (claude-classify)** — placeholder no-op until Phase 3 adds Claude client.
- [ ] **Step 6c (lastfm-tags)** — placeholder no-op until Phase 4 adds Last.fm client.
- [ ] **Step 6d (set-version)** — bulk UPDATE `enrichmentVersion` + `enrichedAt` for all tracks processed. Chunk 1,000/step.

### Tests

- [ ] Era derivation logic (pure function)
- [ ] Spotify artist genre fetcher (mocked API)
- [ ] Chunked loop pattern (verify continuation, version gating)
- [ ] Enrichment version gating (stale detection, set-version behavior)

**PR:** "Add enrichment pipeline with Spotify genres and era derivation"

---

## Phase 3 — Claude Mood/Energy Classification

Implements **Step 6b (enrich-tracks/claude-classify)** in the sync pipeline.

- [ ] **Prisma migration** — add to Track: `claudeMood` (String?), `claudeEnergy` (Float?), `claudeDanceability` (Float?), `claudeVibeTags` (String[]). Exact dimensions TBD after experimentation.
- [ ] **Prompt template** — `src/lib/prompts/classify-tracks.ts`. Exported function takes `{ name, artist }[]`, returns system + user prompt strings. Easy to iterate without touching calling code.
- [ ] **Claude client** — `src/lib/claude.ts`. Calls Haiku with structured output (JSON mode). Handles retries.
- [ ] **Step 6b implementation** — chunk 500 tracks/step, split into 10 Claude batches of 50. ~1,000 input + ~1,500 output tokens per batch. Parse and validate response, skip on parse errors. Bulk UPDATE per chunk.
- [ ] **Cost guardrails** — log token counts per batch. Configurable `MAX_TRACKS_PER_ENRICHMENT_RUN`.
- [ ] **Tests** — prompt snapshot, response parsing (valid/invalid/malformed), batch chunking, mocked Claude client

**PR:** "Add Claude-powered mood and energy classification for tracks"

---

## Phase 4 — Last.fm Tags

Implements **Step 5b (enrich-artists/lastfm-tags)** and **Step 6c (enrich-tracks/lastfm-tags)** in the sync pipeline.

- [ ] **Last.fm API client** — `src/lib/lastfm.ts`
  - `getArtistTopTags(artist: string): Promise<string[]>` — for Step 5b
  - `getTrackTopTags(artist: string, track: string): Promise<string[]>` — for Step 6c
  - Both extract `toptags.tag[].name`, return empty array on 404/no tags
- [ ] **API key** — add `LASTFM_API_KEY` to `.env`
- [ ] **Rate limiter** — simple throttle, max 5 req/sec
- [ ] **Step 5b implementation** — chunk 200 artists/step (~40s). Write `lastfmTags` on Artist.
- [ ] **Step 6c implementation** — chunk 200 tracks/step (~40s). Write `lastfmTags` on Track.
- [ ] **Tests** — mocked HTTP, tag extraction, 404 handling, rate limiting

**PR:** "Add Last.fm genre enrichment for artists and tracks"

---

## Decisions

- **Enrichment is part of sync, not a separate job** — user stays in "Syncing..." state until enrichment completes. From the user's perspective, sync means "get my library ready to use." They shouldn't land on the create page with unenriched tracks. **Revisit if sync time becomes too long** — Last.fm is the bottleneck (~5 min for 1,500 tracks at 5 req/sec). If this is a problem, could prioritize Spotify + Claude (fast) and backfill Last.fm in the background.
- **Enrich per-track, not per-user** — tracks are shared entities. Enriching once benefits all users who have that track.
- **Version-based re-enrichment** — `enrichmentVersion` (Int) on each track, compared against a `CURRENT_ENRICHMENT_VERSION` constant in code. Tracks are stale when their version is behind. `enrichedAt` timestamp kept alongside for debugging/auditing. To trigger re-enrichment: bump the constant (all tracks re-enrich lazily on next sync), or run a bulk UPDATE on a subset for targeted re-enrichment. This supports new sources, better prompts, model upgrades — anything that changes what enrichment produces.
- **Artists as a first-class entity** — normalized into their own table with a many-to-many join to tracks. Genres live on the Artist, not the Track. Avoids redundant Spotify `/artists` calls — once an artist is enriched, all their tracks benefit. Artists have their own `enrichmentVersion` for independent re-enrichment.
- **Sub-steps per source** — each data source is its own Inngest sub-step with independent chunk size, retries, and failure handling. A Last.fm timeout doesn't block Spotify genres or Claude classification. The `set-version` step only runs after all source sub-steps complete, ensuring we don't mark entities as enriched until all sources have written.
- **Source independence** — each source writes to its own columns. If Last.fm is down, Spotify + Claude data is still written. No all-or-nothing.
- **Postgres arrays for tags/genres** — stored as `text[]` (Prisma `String[]`). Queryable with `&&` (overlaps) and `@>` (contains) operators. Avoids LIKE hacks on comma-separated strings and doesn't need extra join tables. Example: `WHERE spotify_genres && ARRAY['pop', 'indie-rock']` finds any artist with either genre. **Skip GIN indexes for now** — tables are too small to benefit at MVP scale. Add them when building playlist generation queries (roadmap item 5) where we'll filter across multiple array columns.
- **Claude prompt as code** — lives in a dedicated file, not buried in service logic. This is the experimentation surface for vibe quality.
- **Extensible by adding sub-steps** — new data sources are just new Inngest sub-steps in the sync function + new columns. No architecture changes needed.
- **Source-prefixed column names** — every enrichment column is prefixed with its data source: `spotifyPopularity`, `spotifyDurationMs`, `spotifyReleaseDate`, `spotifyGenres`, `lastfmTags`, `claudeMood`, `claudeEnergy`, `claudeDanceability`, `claudeVibeTags`, `derivedEra`. Makes provenance unambiguous in queries and avoids rename churn if a second source is added for the same dimension.
- **All enrichment DB writes must be idempotent** — use UPDATE ... WHERE id IN (...), not INSERT. Steps can be retried mid-way through a chunk (e.g., timeout after 200 of 500 artists). On retry the full chunk re-runs, so writes must safely overwrite existing data.

## Open Questions

- What specific dimensions should Claude classify? (mood, energy, danceability are candidates — need to validate they're useful for vibe queries before finalizing the schema)
