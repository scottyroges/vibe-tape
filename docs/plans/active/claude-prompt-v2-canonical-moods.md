# Plan: Claude Classification Prompt v2 — Canonical Moods

**Status:** Draft
**Created:** 2026-04-04
**Depends on:** [`vibe-profile-derivation.md`](vibe-profile-derivation.md)
(PR 4a + 4b must ship first so the canonical mood list is locked and
in use).

## Goal

Update the Claude track-classification prompt to emit `mood` from a fixed
vocabulary of 11 canonical moods instead of free-form strings. Bump
`CLAUDE_ENRICHMENT_VERSION` to 2, which causes the existing sync pipeline
to re-classify every track on the next sync. After the re-run, the mood
cluster map in `src/lib/vibe-profile.ts` (`MOOD_CLUSTER`) becomes load-free
— it only runs as a safety net for out-of-vocab drift.

## Why

The current prompt lets Claude pick any mood word. The vibe profile
derivation handles this by clustering ~90 distinct values into 11 canonical
moods via a static map, with intentional null fall-through for genuinely
ambiguous terms (`soulful`, `groovy`, `thriller`).

That works, but has three drawbacks:

1. **Wasted Claude output.** When Claude returns `"soulful"`, the cluster
   map drops it to null because the term is ambiguous across clusters.
   Claude had a definite opinion — we just can't trust it because of the
   label it chose.
2. **Cluster map carries judgment calls.** `angst-driven` → `aggressive`,
   `spiritual` → `uplifting`, `reflective` → `nostalgic`. Each of these is
   a decision a human made. Changing any of them requires a
   `VIBE_DERIVATION_VERSION` bump and a full re-derivation.
3. **Source-side cleanup beats read-side cleanup.** Once Claude is
   constrained to the canonical set, the whole cluster-map layer becomes
   optional. Simpler mental model, fewer moving parts.

Once Claude emits only canonical moods, the derivation pipeline gets one
step shorter and every mood in `track.vibeMood` is guaranteed to be a
queryable canonical value (or null).

## What changes

### `src/lib/prompts/classify-tracks.ts`

Update the system prompt to list the 11 canonical moods and require Claude
to pick one of them (or return `null` if none fit). Update the TypeScript
type to reflect the constraint.

**New system prompt shape:**

```text
You are a music classification assistant. For each track provided, classify
it with:

- mood: one of the following canonical moods (or null if none fit):
    uplifting, energetic, aggressive, melancholic, romantic, nostalgic,
    dark, dreamy, playful, confident, peaceful
- energy: one of "low", "medium", or "high"
- danceability: one of "low", "medium", or "high"
- vibeTags: 2-5 short descriptors (e.g. "late-night", "driving", "workout",
  "rainy-day", "summer")

Mood guidance:
- uplifting — joyful, euphoric, triumphant, hopeful, cheerful, spiritual
- energetic — upbeat, powerful, epic, anthemic, determined
- aggressive — angry, intense, heavy, edgy, rebellious
- melancholic — sad, wistful, bittersweet, vulnerable, heartfelt
- romantic — tender, passionate, sensual, sultry, warm, loving
- nostalgic — timeless, contemplative, introspective, reflective
- dark — moody, haunting, mysterious, eerie, ominous
- dreamy — ethereal, atmospheric, hypnotic, psychedelic, cinematic
- playful — whimsical, quirky, humorous, carefree
- confident — cool, boastful, swaggering, funky
- peaceful — calm, relaxed, mellow, laid-back, chill, tranquil

If a track genuinely doesn't fit any canonical mood, return mood: null.
Do not invent new moods.

Respond ONLY with a JSON array of objects in the same order as the input.
Each object must have exactly these keys: mood, energy, danceability,
vibeTags. No other text.
```

**Type update:**

```ts
export type CanonicalMood =
  | "uplifting"
  | "energetic"
  | "aggressive"
  | "melancholic"
  | "romantic"
  | "nostalgic"
  | "dark"
  | "dreamy"
  | "playful"
  | "confident"
  | "peaceful";

export type ClassificationResult = {
  mood: CanonicalMood | null;
  energy: "low" | "medium" | "high";
  danceability: "low" | "medium" | "high";
  vibeTags: string[];
};

export const CANONICAL_MOODS: readonly CanonicalMood[] = [
  "uplifting", "energetic", "aggressive", "melancholic", "romantic",
  "nostalgic", "dark", "dreamy", "playful", "confident", "peaceful",
] as const;
```

`CanonicalMood` and `CANONICAL_MOODS` move to this file as the source of
truth. `src/lib/vibe-profile.ts` imports them from here instead of defining
its own copy.

### `src/inngest/functions/sync-library.ts`

Update `isValidClassification` to require `mood` to be `null` or one of
the canonical moods. Currently it accepts any non-empty string.

```ts
function isValidClassification(c: unknown): c is ClassificationResult {
  if (!c || typeof c !== "object") return false;
  const obj = c as Record<string, unknown>;

  const moodOk =
    obj.mood === null ||
    (typeof obj.mood === "string" &&
      (CANONICAL_MOODS as readonly string[]).includes(obj.mood));

  return (
    moodOk &&
    VALID_ENERGY_VALUES.has(obj.energy as string) &&
    VALID_ENERGY_VALUES.has(obj.danceability as string) &&
    Array.isArray(obj.vibeTags) &&
    obj.vibeTags.length > 0 &&
    obj.vibeTags.every((t: unknown) => typeof t === "string")
  );
}
```

If Claude returns an off-list mood string, the whole classification is
rejected (falls through to the existing null-classification path — mood,
energy, danceability all become null for that track, vibeTags empty). This
is stricter than the current behavior but matches the "canonical only"
contract. Off-list moods should be rare and we'd rather have a null than
an untrusted value.

### `src/lib/enrichment.ts`

Bump `CLAUDE_ENRICHMENT_VERSION` from 1 to 2.

```ts
export const CLAUDE_ENRICHMENT_VERSION = 2;
```

The existing sync pipeline picks this up automatically: `findStaleWithArtists`
will return tracks with `claudeVersion < 2`, i.e. all of them. Next sync
re-classifies every track.

### `src/lib/vibe-profile.ts`

Simplify the `MOOD_CLUSTER` map. Once Claude only emits canonical moods
directly, clustering is mostly an identity function. Two options for the
final shape of this file (decide during implementation):

**Option 1: Delete MOOD_CLUSTER entirely.** `clusterMood` becomes a direct
vocabulary check: if `raw` is in `CANONICAL_MOODS`, return it; otherwise
null. Cleaner code, no map. Downside: if a bad Claude response slips past
the validator somehow, we have no safety net.

**Option 2: Keep MOOD_CLUSTER as a safety net.** Populate it only with
canonical identity mappings (`uplifting → uplifting`, etc.) plus a small
set of the most common legacy terms as a backstop during the transition
(`joyful → uplifting`, `sad → melancholic`). Gives us defense in depth.

Lean toward Option 1 — the validator in `sync-library.ts` already rejects
off-list moods, so the safety net is redundant. If we ship Option 1 and
regret it, adding the map back is trivial.

### Tests

- `tests/lib/prompts/classify-tracks.test.ts` (new if it doesn't exist) —
  snapshot test that the system prompt contains all 11 canonical moods
  and the null instruction.
- `tests/inngest/functions/sync-library.test.ts` — update
  `isValidClassification` tests to cover canonical-mood acceptance,
  off-list rejection, and null acceptance.
- `tests/lib/vibe-profile.test.ts` — if going with Option 1, update mood
  clustering tests to reflect the simplified behavior (canonical in →
  canonical out, anything else → null).

## Files touched

1. `src/lib/prompts/classify-tracks.ts` — prompt rewrite, new types,
   `CANONICAL_MOODS` export
2. `src/lib/enrichment.ts` — bump `CLAUDE_ENRICHMENT_VERSION` to 2
3. `src/inngest/functions/sync-library.ts` — stricter
   `isValidClassification`
4. `src/lib/vibe-profile.ts` — simplify or delete `MOOD_CLUSTER` (also
   import `CANONICAL_MOODS`/`CanonicalMood` from `classify-tracks.ts`
   instead of redefining)
5. `tests/lib/prompts/classify-tracks.test.ts` — prompt snapshot / content
   assertions
6. `tests/inngest/functions/sync-library.test.ts` — validator tests
7. `tests/lib/vibe-profile.test.ts` — clustering test cleanup

## Ordering

Single PR, depends on vibe profile PRs 4a and 4b being merged.

Why wait: if PR 4a ships with the MOOD_CLUSTER map and the canonical list
as currently defined, this plan slots cleanly on top. If we do this plan
in parallel or before 4a, we'd be moving `CANONICAL_MOODS` between files
mid-implementation and invite churn.

## Consequences

- **Re-classification cost.** Every track gets classified again. At 1,457
  tracks / ~50 per batch / Claude Haiku pricing, this is pennies. Not a
  concern.
- **Data refresh.** The existing ~5% of tracks with null mood (classification
  failure from run 1) get a second shot. Some may recover, some may fail
  again, a few new ones may fail because of the stricter validator.
- **Mood column becomes queryable.** Playlist generation can safely do
  `WHERE vibe_mood = 'melancholic'` and trust the result.
- **The mood cluster map becomes vestigial.** Option 1 above deletes it.
  The vibe profile pipeline drops one transformation step.
- **vibeTags stays free-form.** This plan only constrains `mood`. Claude's
  `vibeTags` stay as free-form descriptors that flow through the
  normalizer + genre vocab split in `deriveVibeProfile` — no change to
  that pipeline.

## Verification

1. `npx tsc --noEmit` clean
2. `npm test` clean
3. Trigger a sync from the dashboard
4. Watch the Inngest dashboard — confirm Claude classify steps run again
   (findStaleWithArtists returns all 1,457 tracks since version bumped)
5. Sample query:
   ```sql
   SELECT mood, COUNT(*) FROM track_claude_enrichment
   WHERE version = 2
   GROUP BY mood ORDER BY COUNT(*) DESC;
   ```
   Should show only the 11 canonical moods and null. No free-form strings.
6. Spot-check `track.vibe_mood` after the subsequent vibe profile
   re-derivation: every non-null value should be canonical.

## Open questions

- **Option 1 or 2 for `MOOD_CLUSTER`?** Lean Option 1 (delete). Decide at
  implementation time based on how clean the Option 1 code ends up.
- **Should `vibeTags` also get a fixed vocabulary?** No — free-form tags
  feed into the genre/tag merge logic in `deriveVibeProfile`, which
  already handles normalization and vocabulary matching. Constraining
  `vibeTags` at the source adds friction without benefit.
- **Do we need guidance for specific genres in the prompt?** The current
  mood-guidance block covers the ~60 most common Claude outputs from the
  v1 run. If v2 shows Claude consistently picking a wrong canonical mood
  for certain genres (e.g. always tagging indie rock as `melancholic`),
  we'd iterate on the prompt guidance. Not something to predict up front.
