# Plan: Phase 2 — Enrichment Pipeline Foundation

**Status:** In Progress
**Created:** 2026-03-22

## Goal

Add the version-gated enrichment framework and the first two enrichment sources (Spotify artist genres + era derivation) to the sync pipeline. After this phase, every sync enriches artists with Spotify genres and tracks with a derived era. Placeholder no-ops are left for Claude (Phase 3) and Last.fm (Phase 4).

## Context

Phase 1 added the Artist model, enrichmentVersion columns, and chunked sync pipeline. Artists and tracks now have `enrichmentVersion: 0` by default. Phase 2 introduces `CURRENT_ENRICHMENT_VERSION = 1` so all existing entities are "stale" and get enriched on next sync. No migration needed — the schema is already ready.

## Phases and PR Splits

- [x] PR 1: Enrichment framework + era derivation + repository updates — `feat/enrichment-framework`
- [x] PR 2: Spotify artist genres fetcher — `feat/spotify-artist-genres`
- [ ] PR 3: Wire enrichment steps into sync pipeline — `feat/enrichment-pipeline-steps`

PR 1 and PR 2 are independent (can be developed/merged in either order). PR 3 depends on both.

---

### PR 1: Enrichment framework + era derivation + repository updates

**Branch:** `feat/enrichment-framework`

**Files (~6):**

1. `src/lib/enrichment.ts` — **new**
2. `src/repositories/artist.repository.ts` — add updateGenres, setEnrichmentVersion
3. `src/repositories/track.repository.ts` — add updateDerivedEra, setEnrichmentVersion
4. `tests/lib/enrichment.test.ts` — **new**
5. `tests/repositories/artist.repository.test.ts` — add tests
6. `tests/repositories/track.repository.test.ts` — add tests

**`src/lib/enrichment.ts` (new):**
- `CURRENT_ENRICHMENT_VERSION = 1` — single source of truth. Bump to trigger re-enrichment.
- `deriveEra(releaseDate: string | null): string | null` — pure function. Spotify returns dates as `"2023-06-15"`, `"2023-06"`, or `"2023"`. Extract year (first 4 chars), compute decade: `Math.floor(year / 10) * 10 + "s"`. Returns `null` for null/invalid input.

**`src/repositories/artist.repository.ts`:**
- `updateGenres(updates: { id: string; spotifyGenres: string[] }[]): Promise<void>` — loop of individual `UPDATE artist SET spotify_genres = ... WHERE id = ...`. Simple and correct for 500-artist chunks (~1s total). Idempotent.
- `setEnrichmentVersion(version: number, limit: number): Promise<number>` — bulk UPDATE using subquery: `UPDATE artist SET enrichment_version = $v, enriched_at = now() WHERE id IN (SELECT id FROM artist WHERE enrichment_version < $v LIMIT $limit)`. Returns `Number(result[0].numUpdatedRows)`. Postgres doesn't support `UPDATE ... LIMIT` directly, hence the subquery pattern.

**`src/repositories/track.repository.ts`:**
- `updateDerivedEra(updates: { id: string; derivedEra: string }[]): Promise<void>` — same loop pattern as updateGenres.
- `setEnrichmentVersion(version: number, limit: number): Promise<number>` — same subquery pattern as artist version.

**Tests:**
- `tests/lib/enrichment.test.ts`: deriveEra cases — full date, year-month, year-only, 1990s, 2000s boundary, null, empty string, invalid string. Verify CURRENT_ENRICHMENT_VERSION exports as 1.
- Repository tests: verify updateGenres/updateDerivedEra call updateTable with correct table name, setEnrichmentVersion returns numUpdatedRows count.

---

### PR 2: Spotify artist genres fetcher

**Branch:** `feat/spotify-artist-genres`

**Files (~2):**

1. `src/lib/spotify.ts` — add fetchArtists + types, extract spotifyFetch helper
2. `tests/lib/spotify.test.ts` — add fetchArtists tests

**`src/lib/spotify.ts`:**

New types:
```typescript
type SpotifyArtist = { id: string; genres: string[] };
type SpotifyArtistsResponse = { artists: (SpotifyArtist | null)[] };
```

Extract rate-limit/retry logic into private `spotifyFetch(url, accessToken): Promise<Response>` helper, then refactor `fetchLikedSongs` to use it. This DRYs up the 429 retry pattern without changing behavior (existing tests cover it).

New function:
- `fetchArtists(accessToken: string, spotifyIds: string[]): Promise<Map<string, string[]>>` — batches IDs into groups of 50, calls `GET /v1/artists?ids={csv}` per batch via spotifyFetch, returns Map<spotifyId, genres[]>. Null artists in response (deleted/invalid) are skipped.

Uses a local `chunk()` helper (same 6-line function from track.repository.ts). Not extracting to shared utility — keeps PR small.

**Tests:**
- Fetches genres for a batch, verifies URL and map entries
- Batches IDs into groups of 50 (75 IDs → 2 fetch calls)
- Handles null artists in response (skips them)
- Returns empty map for empty input
- Retries on 429
- Throws on non-2xx

---

### PR 3: Wire enrichment steps into sync pipeline

**Branch:** `feat/enrichment-pipeline-steps`

**Files (~2):**

1. `src/inngest/functions/sync-library.ts` — add enrichment steps 5a-6d
2. `tests/inngest/functions/sync-library.test.ts` — update tests

**Sync pipeline additions** (inserted between upsert loop and `update-status`):

```
Step 5a: enrich-artists/spotify-genres-{offset}  — chunked, 500/step
         (findStale → fetchArtists → updateGenres)
Step 5b: placeholder no-op (comment only)
Step 5c: enrich-artists/set-version-{offset}     — chunked, 1000/step
Step 6a: enrich-tracks/era-{offset}              — chunked, 1000/step
         (findStale → deriveEra → updateDerivedEra)
Step 6b: placeholder no-op (comment only)
Step 6c: placeholder no-op (comment only)
Step 6d: enrich-tracks/set-version-{offset}      — chunked, 1000/step
```

**Sequencing:** All steps run sequentially. The plan doc says 5a/5b parallel and 6a/6b/6c parallel, but since 5b/6b/6c are no-ops, parallelization adds no value. Code is structured as independent functions so parallelization is easy to add in Phase 3/4 when the other steps become real.

**Chunked loop pattern** (same for all enrichment steps):
```typescript
let offset = 0;
while (true) {
  const processed = await step.run(`step-name-${offset}`, async () => {
    const stale = await repo.findStale(CURRENT_ENRICHMENT_VERSION, CHUNK_SIZE);
    if (stale.length === 0) return 0;
    // ... enrich and write ...
    return stale.length;
  });
  if (processed < CHUNK_SIZE) break;
  offset += CHUNK_SIZE;
}
```

**Key design notes:**
- `findStale` in 5a queries by `enrichmentVersion < CURRENT_VERSION`. Step 5c stamps the version afterward. Between 5a and 5c, version hasn't changed, so retries re-fetch the same artists (genres overwritten idempotently). Correct.
- The `token` from step 2 (get-token) is reused in step 5a for the Spotify API call. Inngest memoizes step results, so this works on replay.
- No-op placeholders are comments only (no step.run) — zero Inngest execution cost.

**Tests:**
- Verify enrichment step names appear in correct order between upsert and update-status
- Verify enrichment steps are skipped (loop breaks immediately) when no stale entities
- Verify artist genre chunking (500 artists → loop continues, then breaks)
- Verify era derivation calls updateDerivedEra with correct values
- Verify tracks with null release date are filtered from era updates

## Verification

After all 3 PRs:
1. `npx tsc --noEmit` — typecheck
2. `npm test` — all tests pass
3. Manual: trigger a library sync in dev, verify:
   - Artists get `spotifyGenres` populated
   - Tracks get `derivedEra` populated (e.g., "2020s")
   - Both get `enrichmentVersion: 1` and `enrichedAt` set
   - Second sync skips enrichment (no stale entities)

## Open Questions

_None._

## Files Modified

## Session Notes
