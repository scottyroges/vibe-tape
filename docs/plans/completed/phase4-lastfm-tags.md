# Plan: Phase 4 — Last.fm Tags

**Status:** Complete
**Created:** 2026-03-22

## Goal

Implement steps 5b (enrich-artists/lastfm-tags) and 6c (enrich-tracks/lastfm-tags) in the sync pipeline. For each stale artist and track, call the Last.fm API to fetch user-contributed genre tags. This adds a second tag source alongside Spotify genres, improving vibe query coverage — especially for tracks where Spotify metadata is sparse.

## Context

Phases 1–3 established the enrichment pipeline with version gating, chunked loops, Spotify genres (5a), era derivation (6a), and Claude classification (6b). Steps 5b and 6c are currently no-op comment placeholders. The `lastfmTags` columns already exist on both Artist (`String[] @default([])`) and Track (`String[] @default([])`), added in Phase 1's schema migration. No schema changes needed.

Last.fm is the pipeline bottleneck — their API allows ~5 requests/second, and enriching 1,500 tracks + 800 artists takes ~8 minutes. The parent plan notes this as a potential issue but defers background enrichment until it proves to be a real problem.

### Key constraints

- **Rate limit:** Last.fm allows ~5 req/sec. A simple throttle is sufficient — no need for a token bucket or sliding window.
- **No batch API:** Last.fm has no batch endpoint. Each artist/track requires an individual HTTP call.
- **Vercel 60s timeout:** Each Inngest step must complete within 60s. At 5 req/sec, that's ~200 artists or tracks per step maximum (with margin for DB writes).
**Parallelization deferred:** The parent plan says 5a/5b and 6a/6b/6c run in parallel. For now, all steps run sequentially — parallelizing requires distributed rate limiting across serverless invocations, which adds complexity that isn't justified until sync time becomes a real user complaint. Sequential adds ~5 minutes to first sync. Defer to a dedicated optimization PR.

- **Version bump to 3:** Makes all entities stale again. Existing steps (5a, 6a, 6b) re-run but are idempotent and fast.

## Phases and PR Splits

- [x] PR 1: Last.fm client + rate limiter — `feat/lastfm-client`
- [x] PR 2: Repository methods + wire steps 5b/6c + version bump — `feat/lastfm-enrich-steps`

PRs are sequential — PR 2 depends on PR 1.

---

### PR 1: Last.fm client + rate limiter

**Branch:** `feat/lastfm-client`

**Files (~4):**

1. `src/lib/lastfm.ts` — **new**
2. `tests/lib/lastfm.test.ts` — **new**
3. `.env.example` — add `LASTFM_API_KEY` placeholder

**Last.fm client (`src/lib/lastfm.ts`):**
```typescript
export async function getArtistTopTags(artist: string): Promise<string[]>;
export async function getTrackTopTags(artist: string, track: string): Promise<string[]>;
```

- Uses `LASTFM_API_KEY` from `process.env`
- Calls `artist.getTopTags` and `track.getTopTags` Last.fm API methods
- Extracts `toptags.tag[].name` from response, filtered: only tags with `count >= 50`, capped at top 5 by count. Keeps signal high and arrays small — constants are easy to tune later.
- Normalizes tag casing to lowercase (Last.fm returns mixed case like "Hip-Hop", "hip hop")
- Returns empty array on 404, no tags, or artist/track not found
- Individual call failures (malformed response, network error) are caught and logged as warnings — the entity is skipped, not retried. Skipped entities still get version-bumped by `setEnrichmentVersion` and won't retry until the next version bump. This matches Claude classification's skip-on-invalid pattern. **Revisit if version bumps are rare** — may need to exclude failed entities from the version bump so they retry on the next sync.
- Built-in rate limiter: simple delay-based throttle ensuring max 5 requests/second
- Uses `fetch` — no external HTTP library needed

**Rate limiter approach:** A module-level `lastCallTime` timestamp. Before each request, wait until at least 200ms have passed since the last call. Simple, stateless, sufficient for sequential calls within an Inngest step.

**Tests:**
- `getArtistTopTags`: returns tag names from valid response, returns empty array on 404, returns empty array when no tags
- `getTrackTopTags`: returns tag names from valid response, returns empty array on 404, returns empty array when artist/track not found
- Rate limiter: two rapid calls take at least 200ms total (verifies throttle works)

---

### PR 2: Repository methods + wire steps 5b/6c + version bump

**Branch:** `feat/lastfm-enrich-steps`

**Files (~5):**

1. `src/repositories/artist.repository.ts` — add `updateLastfmTags`
2. `src/repositories/track.repository.ts` — add `findStaleWithPrimaryArtist`, `updateLastfmTags`
3. `src/inngest/functions/sync-library.ts` — replace 5b and 6c no-ops with real implementations
4. `src/lib/enrichment.ts` — bump CURRENT_ENRICHMENT_VERSION from 2 to 3
5. `tests/inngest/functions/sync-library.test.ts` — update + new tests
6. `tests/lib/enrichment.test.ts` — update version assertion to 3
7. `tests/repositories/artist.repository.test.ts` — add tests for `updateLastfmTags`
8. `tests/repositories/track.repository.test.ts` — add tests for `updateLastfmTags`

**Repository methods:**
- `artistRepository.updateLastfmTags(updates: { id: string; lastfmTags: string[] }[])`: Loop of individual UPDATEs wrapped in `db.transaction()`, same pattern as `updateClaudeClassification` (not the older `updateGenres` which lacks a transaction).
- `trackRepository.updateLastfmTags(updates: { id: string; lastfmTags: string[] }[])`: Same transactional pattern.

**Step 5b implementation (enrich-artists/lastfm-tags):**
- Chunk 200 artists/step via `artistRepository.findStale`
- For each artist in the chunk: call `getArtistTopTags(artist.name)`
- Collect updates (skip artists that returned empty tags — don't overwrite existing tags with nothing)
- Bulk `updateLastfmTags` per step
- Step name: `enrich-artists/lastfm-tags-${offset}`

**New repository method:**
- `trackRepository.findStaleWithPrimaryArtist(version, limit)`: Like `findStaleWithArtists` but joins only the primary artist (`WHERE trackArtist.position = 0`). Returns `Array<Track & { artist: string }>` with a single artist name per track. Avoids splitting comma-separated strings.

**Step 6c implementation (enrich-tracks/lastfm-tags):**
- Chunk 200 tracks/step via `trackRepository.findStaleWithPrimaryArtist`
- For each track in the chunk: call `getTrackTopTags(track.artist, track.name)`
- Collect updates (skip tracks that returned empty tags)
- Bulk `updateLastfmTags` per step
- Step name: `enrich-tracks/lastfm-tags-${offset}`

**Version bump to 3:** Makes all entities stale again. Steps 5a, 6a, 6b re-run but are idempotent and fast.

**Tests:**
- Step ordering includes `enrich-artists/lastfm-tags-0` and `enrich-tracks/lastfm-tags-0` in correct positions
- Enriches artists with mocked Last.fm response
- Enriches tracks with mocked Last.fm response
- Skips artists/tracks where Last.fm returns empty tags
- Chunks at 200-entity boundary
- Update enrichment version test assertion to 3

## Verification

After both PRs:
1. `npx tsc --noEmit` — typecheck
2. `npm test` — all tests pass
3. Manual: add `LASTFM_API_KEY` to `.env`, trigger library sync, verify artists and tracks get `lastfmTags` populated

## Open Questions

_Resolved during review:_
- Tag filtering: count >= 50, top 5, lowercase normalized
- Parallelization deferred — sequential for now, revisit when sync time is a user complaint
- Primary artist: new `findStaleWithPrimaryArtist` query with `position = 0` join
- Individual call failures: try/catch and skip with warning log. Skipped entities still get version-bumped — revisit if version bumps are rare (they should be) and failed entities need to retry sooner
- `.env.example` exists, no conditional needed
- `updateLastfmTags` uses transactions (matching `updateClaudeClassification`, not `updateGenres`)

_Still open:_
- Should we skip the Last.fm call for artists/tracks that already have `lastfmTags` from a previous enrichment? Currently re-enrichment overwrites — probably fine since tags can change over time.
- Should empty tag responses write an empty array (marking "we checked, nothing found") or skip the update (leaving the column at its default `[]`)? Skipping avoids unnecessary writes but makes it impossible to distinguish "not yet checked" from "checked, no tags." Leaning toward skip for now since version gating already tracks whether enrichment ran.
- Last.fm rate limit is documented as 5 req/sec but enforcement varies. If we get 429s, should we back off? The simple throttle might need a retry-with-backoff wrapper. Defer until we see actual 429s.

## Files Modified

- `src/lib/lastfm.ts` — new, Last.fm API client with rate limiting and tag filtering
- `tests/lib/lastfm.test.ts` — new, tests for client, tag parsing, and throttle
- `.env.example` — added `LASTFM_API_KEY` placeholder
- `src/repositories/artist.repository.ts` — added `updateLastfmTags`
- `src/repositories/track.repository.ts` — added `findStaleWithPrimaryArtist`, `updateLastfmTags`
- `src/inngest/functions/sync-library.ts` — wired steps 5b and 6c with chunked Last.fm tag fetching
- `src/lib/enrichment.ts` — bumped `CURRENT_ENRICHMENT_VERSION` from 2 to 3
- `tests/inngest/functions/sync-library.test.ts` — added Last.fm enrichment tests (happy path, empty tags, error resilience, chunking)
- `tests/lib/enrichment.test.ts` — updated version assertion to 3
- `tests/repositories/artist.repository.test.ts` — added `updateLastfmTags` tests
- `tests/repositories/track.repository.test.ts` — added `findStaleWithPrimaryArtist` and `updateLastfmTags` tests

## Session Notes

### PR 1 (2026-03-22)
- Client implemented with delay-based throttle (200ms between calls, ~5 req/sec)
- Tag filtering: count >= 50, top 5, lowercase — constants at module level for easy tuning
- Defensive parsing handles Last.fm quirks: error-as-200 responses, single-tag-as-object instead of array
- No external HTTP library — plain `fetch`
- `_resetThrottle()` exported for test isolation

### PR 2 (2026-03-22)
- `updateLastfmTags` on both repos uses transactional loop pattern (matches `updateClaudeClassification`)
- `findStaleWithPrimaryArtist` joins on `trackArtist.position = 0` to get a single artist name per track
- Steps 5b/6c use try/catch per entity — a single Last.fm failure logs a warning and skips that entity without aborting the chunk
- `LASTFM_CHUNK_SIZE = 200` — fits ~40s of Last.fm calls within Vercel's 60s timeout
- Version bump to 3 makes all entities stale; existing steps (5a, 6a, 6b) re-run but are idempotent
- 10 new tests covering happy path, empty tags, error resilience, and chunking at 200 boundary
