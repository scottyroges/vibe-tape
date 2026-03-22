# Plan: Phase 3 — Claude Mood/Energy Classification

**Status:** In Progress
**Created:** 2026-03-22

## Goal

Implement step 6b (enrich-tracks/claude-classify) in the sync pipeline. For each stale track, call Claude Haiku to classify mood, energy, danceability, and vibe tags. This enables vibe-based playlist generation — the core product feature.

## Context

Phase 2 established the enrichment framework with version gating, chunked loops, and wired steps 5a/6a into the sync pipeline. Step 6b is currently a no-op comment placeholder. The Anthropic SDK (`@anthropic-ai/sdk` v0.74.0) is already installed. All four Claude columns use string types — energy and danceability are "low"/"medium"/"high" labels (overrides the parent plan's `Float?` type — simpler to prompt for and query).

## Phases and PR Splits

- [x] PR 1: Schema migration + prompt template — `feat/claude-schema-prompt`
- [ ] PR 2: Claude client + repository methods — `feat/claude-client-repo`
- [ ] PR 3: Wire step 6b + version bump — `feat/claude-classify-step`

PRs are sequential — each depends on the previous.

---

### PR 1: Schema migration + prompt template

**Branch:** `feat/claude-schema-prompt`

**Files (~7):**

1. `prisma/schema.prisma` — add four columns to Track
2. `prisma/migrations/<timestamp>/migration.sql` — generated, non-destructive
3. `src/db/types.ts` — regenerated
4. `src/domain/song.ts` — add four fields to Track type
5. `src/lib/prompts/classify-tracks.ts` — **new**
6. `tests/lib/prompts/classify-tracks.test.ts` — **new**

**Schema changes (non-destructive — nullable columns + array with default):**
```
claudeMood          String?       @map("claude_mood")
claudeEnergy        String?       @map("claude_energy")
claudeDanceability  String?       @map("claude_danceability")
claudeVibeTags      String[]      @default([]) @map("claude_vibe_tags")
```

**Domain type additions to Track:**
- `claudeMood: string | null`
- `claudeEnergy: string | null`
- `claudeDanceability: string | null`
- `claudeVibeTags: string[]`

**Prompt template (`src/lib/prompts/classify-tracks.ts`):**
```typescript
export type TrackInput = { name: string; artist: string };

export type ClassificationResult = {
  mood: string;
  energy: "low" | "medium" | "high";
  danceability: "low" | "medium" | "high";
  vibeTags: string[];
};

export function buildClassifyPrompt(tracks: TrackInput[]): {
  system: string;
  user: string;
};
```
- System prompt: instructs Claude to classify each track by mood (single word like "melancholic", "uplifting"), energy ("low"/"medium"/"high"), danceability ("low"/"medium"/"high"), vibeTags (2-5 short descriptors like "late-night", "driving")
- User prompt: JSON array of `{ name, artist }` objects
- Response format: "Respond ONLY with a JSON array" matching input order

**Tests:**
- Snapshot test of system prompt (catches accidental drift)
- User prompt correctly serializes track array
- Handles empty array input

**Frontend test files** (`create/page.test.tsx`, `create/confirm/page.test.tsx`) — add new nullable fields to `makeSong` helper.

---

### PR 2: Claude client + repository methods

**Branch:** `feat/claude-client-repo`

**Files (~5):**

1. `src/lib/claude.ts` — **new**
2. `src/repositories/track.repository.ts` — add findStaleWithArtists, updateClaudeClassification
3. `tests/lib/claude.test.ts` — **new**
4. `tests/repositories/track.repository.test.ts` — add tests

**Claude client (`src/lib/claude.ts`):**
```typescript
export async function classifyTracks(
  system: string,
  user: string
): Promise<{
  results: ClassificationResult[];
  inputTokens: number;
  outputTokens: number;
}>;
```
- Uses `claude-haiku-4-5-20251001` model
- `max_tokens: 4096` (enough for 50 track responses)
- Parses text response as JSON, throws typed error on parse failure
- Returns token usage for cost logging
- No retry logic — Inngest step retries handle transient failures

**Repository methods:**
- `findStaleWithArtists(version, limit)`: Like `findStale` but joins through `trackArtist` → `artist` with `STRING_AGG` to include artist display name. Returns `Array<Track & { artist: string }>`.
- `updateClaudeClassification(updates: { id, claudeMood, claudeEnergy, claudeDanceability, claudeVibeTags }[])`: Loop of individual UPDATEs, same pattern as `updateDerivedEra`.

**Tests:**
- Claude client: valid JSON parsed correctly with token counts, malformed JSON throws, wrong-shape JSON throws
- Repository: findStaleWithArtists calls selectFrom("track"), updateClaudeClassification calls updateTable("track"), empty array no-op

---

### PR 3: Wire step 6b + version bump

**Branch:** `feat/claude-classify-step`

**Files (~4):**

1. `src/inngest/functions/sync-library.ts` — replace 6b no-op with real implementation
2. `src/lib/enrichment.ts` — bump CURRENT_ENRICHMENT_VERSION from 1 to 2
3. `tests/inngest/functions/sync-library.test.ts` — update + new tests
4. `tests/lib/enrichment.test.ts` — update version assertion to 2

**Parallelization deferred:** The parent plan says 6a/6b/6c run in parallel. For now, 6a and 6b run sequentially — parallelizing two chunked loops adds complexity that isn't justified until Phase 4 when all three steps are real.

**Step 6b implementation:**
- Chunk 500 tracks/step via `findStaleWithArtists`
- Split each chunk into 10 batches of 50 for Claude calls
- For each batch: `buildClassifyPrompt` → `classifyTracks` → match results to tracks by index (if Claude returns fewer, unmatched tracks are skipped; extras ignored) → validate each → collect updates
- Log token counts per batch (`console.log`). `MAX_TRACKS_PER_ENRICHMENT_RUN` guardrail from parent plan skipped for now — cost is negligible at MVP scale. Add later if needed.
- Skip individual tracks with invalid classification: `mood` must be non-empty string, `energy` must be one of "low"/"medium"/"high", `danceability` must be one of "low"/"medium"/"high", `vibeTags` must be non-empty string array
- Bulk `updateClaudeClassification` per 500-track step
- Step name: `enrich-tracks/claude-classify-${offset}`

**Version bump to 2:** Makes all tracks stale again so they go through Claude classification. Steps 5a and 6a re-run but are idempotent and fast.

**Tests:**
- Step ordering includes `enrich-tracks/claude-classify-0` between era and set-version
- Classifies tracks with mocked Claude response
- Skips tracks with invalid Claude response (one valid, one invalid → only valid written)
- Chunks classification at 500-track boundary
- Update enrichment version test assertion to 2

## Verification

After all 3 PRs:
1. `npx tsc --noEmit` — typecheck
2. `npm test` — all tests pass
3. Manual: add `ANTHROPIC_API_KEY` to `.env`, trigger library sync, verify tracks get `claudeMood`, `claudeEnergy`, `claudeDanceability`, `claudeVibeTags` populated

## Open Questions

_All resolved during review:_
- Energy/danceability use string labels, not floats (parent plan updated to match)
- Parallelization of 6a/6b deferred to Phase 4
- MAX_TRACKS_PER_ENRICHMENT_RUN guardrail skipped for MVP
- Strict validation: mood non-empty, energy/danceability must be "low"/"medium"/"high", vibeTags non-empty array
- Response length mismatch: match by index, skip unmatched, ignore extras
- findStaleWithArtists uses INNER JOIN (sync guarantees artist rows exist)
- ANTHROPIC_API_KEY validation left to SDK
- Version bump to 2 re-runs all steps (by design, idempotent)

## Files Modified

**PR 1 — `feat/claude-schema-prompt`:**
- `prisma/schema.prisma` — added four Claude classification columns to Track
- `prisma/migrations/20260322194408_add_claude_classification_columns/migration.sql` — generated migration
- `src/db/types.ts` — regenerated Kysely types with new columns
- `src/domain/song.ts` — added four fields to domain Track type
- `src/lib/prompts/classify-tracks.ts` — **new** prompt template module
- `tests/lib/prompts/classify-tracks.test.ts` — **new** snapshot + serialization tests
- `src/app/(app)/create/page.test.tsx` — added Claude fields to `makeSong` helper
- `src/app/(app)/create/confirm/page.test.tsx` — added Claude fields to `makeSong` helper
- `docs/plans/active/track-enrichment-pipeline.md` — updated Phase 3 schema description (String labels over Float)

## Session Notes

**2026-03-22 — PR 1 complete.** Schema migration adds four nullable columns (`claude_mood`, `claude_energy`, `claude_danceability`, `claude_vibe_tags`) to the track table. Prompt template module exports `buildClassifyPrompt` with types for track input and classification results. All existing tests updated with new fields. Parent enrichment plan updated to reflect String types over Float for energy/danceability.
