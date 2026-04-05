// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  MAX_PLAYLIST_TRACKS,
  SCORE_WEIGHTS,
  computeFinalScore,
  computeMathTarget,
  normalizeTitleForDedup,
  rankAndFilter,
  scoreTrack,
  scoreTrackBreakdown,
  type ScoredTrack,
} from "@/lib/playlist-scoring";
import type { VibeProfile } from "@/lib/vibe-profile";

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function profile(overrides: Partial<VibeProfile> = {}): VibeProfile {
  return {
    mood: null,
    energy: null,
    danceability: null,
    genres: [],
    tags: [],
    ...overrides,
  };
}

function track(
  id: string,
  overrides: Partial<ScoredTrack> = {},
): ScoredTrack {
  return {
    trackId: id,
    name: id, // default name == id; dedup tests override with real titles
    primaryArtistId: "artist-" + id,
    durationMs: 3 * 60 * 1000,
    claudeScore: 0,
    mathScore: 0,
    finalScore: 0,
    ...overrides,
  };
}

/** Deterministic RNG stub — cycles through `values` returning each in turn. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length] ?? 0;
    i += 1;
    return v;
  };
}

// ──────────────────────────────────────────────────────────────────────────
// computeMathTarget
// ──────────────────────────────────────────────────────────────────────────

describe("computeMathTarget", () => {
  it("returns the common profile when all seeds agree", () => {
    const seed = profile({
      mood: "uplifting",
      energy: "high",
      danceability: "high",
      genres: ["pop", "funk"],
      tags: ["summer", "driving"],
    });
    const target = computeMathTarget([seed, seed, seed]);
    expect(target.mood).toBe("uplifting");
    expect(target.energy).toBe("high");
    expect(target.danceability).toBe("high");
    expect(target.genres).toEqual(["pop", "funk"]);
    expect(target.tags).toEqual(["summer", "driving"]);
  });

  it("picks plurality mood with a clear winner", () => {
    const a = profile({ mood: "melancholic" });
    const b = profile({ mood: "melancholic" });
    const c = profile({ mood: "uplifting" });
    expect(computeMathTarget([a, b, c]).mood).toBe("melancholic");
  });

  it("returns null mood on a tie", () => {
    const a = profile({ mood: "melancholic" });
    const b = profile({ mood: "uplifting" });
    expect(computeMathTarget([a, b]).mood).toBeNull();
  });

  it("returns null mood when all seeds are null", () => {
    expect(computeMathTarget([profile(), profile()]).mood).toBeNull();
  });

  it("averages energy ordinally, ignoring nulls", () => {
    // low(0) + high(2) + null → avg 1 → medium
    const target = computeMathTarget([
      profile({ energy: "low" }),
      profile({ energy: "high" }),
      profile({ energy: null }),
    ]);
    expect(target.energy).toBe("medium");
  });

  it("rounds ordinal average for danceability", () => {
    // low(0) + low(0) + high(2) → avg 0.67 → rounded 1 → medium
    const target = computeMathTarget([
      profile({ danceability: "low" }),
      profile({ danceability: "low" }),
      profile({ danceability: "high" }),
    ]);
    expect(target.danceability).toBe("medium");
  });

  it("returns null ordinal fields when all seeds are null", () => {
    const target = computeMathTarget([profile(), profile()]);
    expect(target.energy).toBeNull();
    expect(target.danceability).toBeNull();
  });

  it("sorts genres and tags by frequency and caps them", () => {
    const target = computeMathTarget([
      profile({ genres: ["rock", "pop"], tags: ["driving"] }),
      profile({ genres: ["rock", "indie"], tags: ["driving", "summer"] }),
      profile({ genres: ["rock"], tags: ["summer"] }),
    ]);
    // rock hit 3x, pop + indie 1x each; rock is first.
    expect(target.genres[0]).toBe("rock");
    expect(target.genres).toContain("pop");
    expect(target.genres).toContain("indie");
    expect(target.genres.length).toBe(3);

    // driving 2x, summer 2x — both appear, both capped well under 12.
    expect(target.tags.length).toBe(2);
    expect(target.tags).toContain("driving");
    expect(target.tags).toContain("summer");
  });

  it("caps genres at 8 and tags at 12", () => {
    const manyGenres = Array.from({ length: 15 }, (_, i) => `g${i}`);
    const manyTags = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const target = computeMathTarget([
      profile({ genres: manyGenres, tags: manyTags }),
    ]);
    expect(target.genres.length).toBe(8);
    expect(target.tags.length).toBe(12);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// scoreTrack
// ──────────────────────────────────────────────────────────────────────────

describe("scoreTrack", () => {
  it("returns 1.0 for an exact match on all components", () => {
    const p = profile({
      mood: "uplifting",
      energy: "high",
      danceability: "high",
      genres: ["pop", "funk"],
      tags: ["summer"],
    });
    expect(scoreTrack(p, p)).toBeCloseTo(1.0, 10);
  });

  it("returns 0 when every field mismatches or is null", () => {
    const a = profile();
    const b = profile({
      mood: "melancholic",
      energy: "high",
      danceability: "high",
      genres: ["metal"],
      tags: ["dark"],
    });
    expect(scoreTrack(a, b)).toBe(0);
  });

  it("gives half-credit for one-off energy/danceability", () => {
    const a = profile({ energy: "low", danceability: "medium" });
    const b = profile({ energy: "medium", danceability: "low" });
    // energy: 0.5*0.15 + dance: 0.5*0.15 = 0.15
    expect(scoreTrack(a, b)).toBeCloseTo(0.15, 10);
  });

  it("gives zero credit for two-step energy gap", () => {
    const a = profile({ energy: "low" });
    const b = profile({ energy: "high" });
    expect(scoreTrack(a, b)).toBe(0);
  });

  it("uses Jaccard for partial genre overlap", () => {
    const a = profile({ genres: ["rock", "indie"] });
    const b = profile({ genres: ["rock", "pop"] });
    // |∩|=1, |∪|=3 → 1/3. Weight 0.30 → 0.10
    expect(scoreTrack(a, b)).toBeCloseTo(0.3 * (1 / 3), 10);
  });

  it("returns 0 for empty-both arrays (no signal)", () => {
    const a = profile({ genres: [], tags: [] });
    const b = profile({ genres: [], tags: [] });
    expect(scoreTrack(a, b)).toBe(0);
  });

  it("scores mood only when both sides agree", () => {
    const a = profile({ mood: "uplifting" });
    const b = profile({ mood: "uplifting" });
    // 0.30 mood weight, everything else null
    expect(scoreTrack(a, b)).toBeCloseTo(0.3, 10);

    const c = profile({ mood: null });
    expect(scoreTrack(a, c)).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// scoreTrackBreakdown — must match scoreTrack and expose the math
// ──────────────────────────────────────────────────────────────────────────

describe("scoreTrackBreakdown", () => {
  it("returns similarity × weight × contribution for every component", () => {
    const candidate = profile({
      mood: "uplifting",
      energy: "high",
      danceability: "high",
      genres: ["pop", "rock"],
      tags: ["summer"],
    });
    const target = profile({
      mood: "uplifting",
      energy: "medium", // one level off → 0.5
      danceability: "high", // exact → 1
      genres: ["pop"], // 1/2 jaccard
      tags: ["winter"], // 0/2 jaccard
    });
    const breakdown = scoreTrackBreakdown(candidate, target);

    expect(breakdown.mood.similarity).toBe(1);
    expect(breakdown.mood.weight).toBe(SCORE_WEIGHTS.mood);
    expect(breakdown.mood.contribution).toBeCloseTo(SCORE_WEIGHTS.mood, 10);

    expect(breakdown.energy.similarity).toBe(0.5);
    expect(breakdown.energy.contribution).toBeCloseTo(
      0.5 * SCORE_WEIGHTS.energy,
      10,
    );

    expect(breakdown.danceability.similarity).toBe(1);
    expect(breakdown.genres.similarity).toBeCloseTo(1 / 2, 10);
    expect(breakdown.tags.similarity).toBe(0);
  });

  it("total matches scoreTrack exactly", () => {
    const candidate = profile({
      mood: "uplifting",
      energy: "medium",
      danceability: "low",
      genres: ["indie", "pop"],
      tags: ["chill"],
    });
    const target = profile({
      mood: "peaceful",
      energy: "medium",
      danceability: "medium",
      genres: ["indie", "folk"],
      tags: ["chill", "acoustic"],
    });
    expect(scoreTrackBreakdown(candidate, target).total).toBeCloseTo(
      scoreTrack(candidate, target),
      10,
    );
  });

  it("weights sum to 1.0", () => {
    const sum =
      SCORE_WEIGHTS.mood +
      SCORE_WEIGHTS.energy +
      SCORE_WEIGHTS.danceability +
      SCORE_WEIGHTS.genres +
      SCORE_WEIGHTS.tags;
    expect(sum).toBeCloseTo(1, 10);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// computeFinalScore (blending + degenerate fallback)
// ──────────────────────────────────────────────────────────────────────────

describe("computeFinalScore", () => {
  it("averages claude + math when both are non-zero", () => {
    const candidate = profile({ mood: "uplifting", genres: ["pop"] });
    const claudeTarget = profile({ mood: "uplifting" });
    const mathTarget = profile({ genres: ["pop"] });
    const { claudeScore, mathScore, finalScore } = computeFinalScore(
      candidate,
      claudeTarget,
      mathTarget,
    );
    expect(claudeScore).toBeCloseTo(0.3, 10);
    expect(mathScore).toBeCloseTo(0.3, 10);
    expect(finalScore).toBeCloseTo(0.3, 10);
  });

  it("halves the score when only one side endorses", () => {
    const candidate = profile({ mood: "uplifting" });
    const claudeTarget = profile({ mood: "uplifting" });
    const mathTarget = profile({ mood: "melancholic" });
    const { finalScore } = computeFinalScore(
      candidate,
      claudeTarget,
      mathTarget,
    );
    expect(finalScore).toBeCloseTo(0.15, 10);
  });

  it("falls back to math score when claude target is degenerate", () => {
    const candidate = profile({ mood: "uplifting", genres: ["pop"] });
    const claudeTarget = profile(); // all null/empty
    const mathTarget = profile({ mood: "uplifting", genres: ["pop"] });
    const { finalScore, mathScore } = computeFinalScore(
      candidate,
      claudeTarget,
      mathTarget,
    );
    expect(finalScore).toBe(mathScore);
    expect(finalScore).toBeGreaterThan(0);
  });

  it("falls back to claude score when math target is degenerate", () => {
    const candidate = profile({ mood: "uplifting" });
    const claudeTarget = profile({ mood: "uplifting" });
    const mathTarget = profile();
    const { finalScore, claudeScore } = computeFinalScore(
      candidate,
      claudeTarget,
      mathTarget,
    );
    expect(finalScore).toBe(claudeScore);
  });

  it("returns 0 when both targets are degenerate", () => {
    const { finalScore } = computeFinalScore(
      profile({ mood: "uplifting" }),
      profile(),
      profile(),
    );
    expect(finalScore).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// rankAndFilter
// ──────────────────────────────────────────────────────────────────────────

describe("rankAndFilter", () => {
  const NO_SHUFFLE = { shuffleWindowSize: 1 as const };

  it("sorts by finalScore desc and truncates by duration", () => {
    const candidates = [
      track("a", { finalScore: 0.1, durationMs: 60_000 }),
      track("b", { finalScore: 0.9, durationMs: 60_000 }),
      track("c", { finalScore: 0.5, durationMs: 60_000 }),
      track("d", { finalScore: 0.7, durationMs: 60_000 }),
    ];
    const result = rankAndFilter(candidates, {
      targetDurationMs: 150_000, // fit ~2 full + stop
      perArtistCap: 10,
      ...NO_SHUFFLE,
    });
    // b(0.9), d(0.7), c(0.5): 60+60+60=180 ≥ 150 after 3rd
    expect(result.map((t) => t.trackId)).toEqual(["b", "d", "c"]);
  });

  it("respects the per-artist cap", () => {
    const candidates = [
      track("a1", {
        finalScore: 0.9,
        primaryArtistId: "X",
        durationMs: 30_000,
      }),
      track("a2", {
        finalScore: 0.85,
        primaryArtistId: "X",
        durationMs: 30_000,
      }),
      track("a3", {
        finalScore: 0.8,
        primaryArtistId: "X",
        durationMs: 30_000,
      }),
      track("a4", {
        finalScore: 0.75,
        primaryArtistId: "X",
        durationMs: 30_000,
      }),
      track("b1", {
        finalScore: 0.7,
        primaryArtistId: "Y",
        durationMs: 30_000,
      }),
    ];
    const result = rankAndFilter(candidates, {
      targetDurationMs: 10 * 60 * 1000,
      perArtistCap: 2,
      ...NO_SHUFFLE,
    });
    const fromX = result.filter((t) => t.primaryArtistId === "X");
    expect(fromX.length).toBe(2);
    // Top two X tracks kept; b1 appears after cap kicks in.
    expect(result.map((t) => t.trackId)).toEqual(["a1", "a2", "b1"]);
  });

  it("honors initialArtistCounts (top-up scenario)", () => {
    const candidates = [
      track("new1", { finalScore: 0.9, primaryArtistId: "X" }),
      track("new2", { finalScore: 0.8, primaryArtistId: "X" }),
      track("new3", { finalScore: 0.7, primaryArtistId: "Y" }),
    ];
    const result = rankAndFilter(candidates, {
      targetDurationMs: 60 * 60 * 1000,
      perArtistCap: 2,
      initialArtistCounts: new Map([["X", 2]]), // X already at cap
      ...NO_SHUFFLE,
    });
    expect(result.map((t) => t.trackId)).toEqual(["new3"]);
  });

  it("skips excludeIds", () => {
    const candidates = [
      track("a", { finalScore: 0.9 }),
      track("b", { finalScore: 0.8 }),
      track("c", { finalScore: 0.7 }),
    ];
    const result = rankAndFilter(candidates, {
      targetDurationMs: 60 * 60 * 1000,
      perArtistCap: 10,
      excludeIds: new Set(["b"]),
      ...NO_SHUFFLE,
    });
    expect(result.map((t) => t.trackId)).toEqual(["a", "c"]);
  });

  it("guarantees requiredTrackIds regardless of score", () => {
    const candidates = [
      track("hi", { finalScore: 0.9 }),
      track("low", { finalScore: 0.01 }),
      track("mid", { finalScore: 0.5 }),
    ];
    const result = rankAndFilter(candidates, {
      targetDurationMs: 10 * 60 * 1000,
      perArtistCap: 10,
      requiredTrackIds: ["low"],
      ...NO_SHUFFLE,
    });
    expect(result.map((t) => t.trackId)).toContain("low");
  });

  it("required tracks bypass the per-artist cap themselves", () => {
    // 4 Metallica seeds, cap 3 → all 4 still appear.
    const candidates = [
      track("m1", {
        finalScore: 0.9,
        primaryArtistId: "metallica",
        durationMs: 60_000,
      }),
      track("m2", {
        finalScore: 0.85,
        primaryArtistId: "metallica",
        durationMs: 60_000,
      }),
      track("m3", {
        finalScore: 0.8,
        primaryArtistId: "metallica",
        durationMs: 60_000,
      }),
      track("m4", {
        finalScore: 0.1, // low enough that only required-path gets it
        primaryArtistId: "metallica",
        durationMs: 60_000,
      }),
      track("other", {
        finalScore: 0.5,
        primaryArtistId: "other",
        durationMs: 60_000,
      }),
    ];
    const result = rankAndFilter(candidates, {
      targetDurationMs: 10 * 60 * 1000,
      perArtistCap: 3,
      requiredTrackIds: ["m1", "m2", "m3", "m4"],
      ...NO_SHUFFLE,
    });
    const metallicaIds = result
      .filter((t) => t.primaryArtistId === "metallica")
      .map((t) => t.trackId);
    expect(metallicaIds.sort()).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("3-Metallica-seeds-with-cap-3 regression: no extra metallica tracks appear", () => {
    const candidates = [
      // 3 seeds
      track("seed1", {
        finalScore: 0.99,
        primaryArtistId: "metallica",
        durationMs: 60_000,
      }),
      track("seed2", {
        finalScore: 0.98,
        primaryArtistId: "metallica",
        durationMs: 60_000,
      }),
      track("seed3", {
        finalScore: 0.97,
        primaryArtistId: "metallica",
        durationMs: 60_000,
      }),
      // non-seed metallica track that would otherwise be top-ranked
      track("extra", {
        finalScore: 0.96,
        primaryArtistId: "metallica",
        durationMs: 60_000,
      }),
      // another artist that should be allowed in
      track("megadeth", {
        finalScore: 0.5,
        primaryArtistId: "megadeth",
        durationMs: 60_000,
      }),
    ];
    const result = rankAndFilter(candidates, {
      targetDurationMs: 10 * 60 * 1000,
      perArtistCap: 3,
      requiredTrackIds: ["seed1", "seed2", "seed3"],
      ...NO_SHUFFLE,
    });
    const ids = result.map((t) => t.trackId);
    expect(ids).toContain("seed1");
    expect(ids).toContain("seed2");
    expect(ids).toContain("seed3");
    expect(ids).not.toContain("extra");
    expect(ids).toContain("megadeth");
  });

  it("keeps all required tracks even when they alone exceed the target duration", () => {
    const candidates = [
      track("r1", {
        finalScore: 0.1,
        durationMs: 4 * 60_000,
        primaryArtistId: "a",
      }),
      track("r2", {
        finalScore: 0.1,
        durationMs: 4 * 60_000,
        primaryArtistId: "b",
      }),
      track("r3", {
        finalScore: 0.1,
        durationMs: 4 * 60_000,
        primaryArtistId: "c",
      }),
      track("filler", {
        finalScore: 0.9,
        durationMs: 4 * 60_000,
        primaryArtistId: "d",
      }),
    ];
    const result = rankAndFilter(candidates, {
      targetDurationMs: 5 * 60_000, // required tracks total 12min, target 5min
      perArtistCap: 10,
      requiredTrackIds: ["r1", "r2", "r3"],
      ...NO_SHUFFLE,
    });
    const ids = result.map((t) => t.trackId);
    expect(ids).toContain("r1");
    expect(ids).toContain("r2");
    expect(ids).toContain("r3");
    // Duration already blown past target by required tracks → no filler added.
    expect(ids).not.toContain("filler");
  });

  it("breaks finalScore ties by trackId ASC for determinism", () => {
    const candidates = [
      track("zebra", { finalScore: 0.5, durationMs: 60_000 }),
      track("apple", { finalScore: 0.5, durationMs: 60_000 }),
      track("mango", { finalScore: 0.5, durationMs: 60_000 }),
    ];
    const result = rankAndFilter(candidates, {
      targetDurationMs: 10 * 60 * 1000,
      perArtistCap: 10,
      ...NO_SHUFFLE,
    });
    expect(result.map((t) => t.trackId)).toEqual(["apple", "mango", "zebra"]);
  });

  it("required tracks still consume duration budget", () => {
    const candidates = [
      track("req", {
        finalScore: 0.1,
        durationMs: 4 * 60_000,
        primaryArtistId: "r",
      }),
      track("hi", {
        finalScore: 0.9,
        durationMs: 4 * 60_000,
        primaryArtistId: "h",
      }),
    ];
    const result = rankAndFilter(candidates, {
      targetDurationMs: 5 * 60_000,
      perArtistCap: 10,
      requiredTrackIds: ["req"],
      ...NO_SHUFFLE,
    });
    // req alone is 4min, then one more push crosses 5min target.
    expect(result.map((t) => t.trackId)).toEqual(["req", "hi"]);
  });

  it("enforces MAX_PLAYLIST_TRACKS hard cap even if duration target demands more", () => {
    const candidates = Array.from({ length: 150 }, (_, i) =>
      track(`t${i.toString().padStart(3, "0")}`, {
        finalScore: 1 - i / 1000,
        primaryArtistId: `artist-${i}`,
        durationMs: 60_000,
      }),
    );
    const result = rankAndFilter(candidates, {
      targetDurationMs: 200 * 60_000, // would need 200 tracks
      perArtistCap: 10,
      ...NO_SHUFFLE,
    });
    expect(result.length).toBe(MAX_PLAYLIST_TRACKS);
  });

  it("window shuffle never moves a track outside its window", () => {
    const windowSize = 4;
    // Deterministic: always return 0 → picks `start` every iteration,
    // which rotates elements but keeps them within their window.
    const candidates = Array.from({ length: 20 }, (_, i) =>
      track(`t${i}`, {
        finalScore: 1 - i / 100, // strictly descending, no ties
        primaryArtistId: `a${i}`,
        durationMs: 60_000,
      }),
    );
    const result = rankAndFilter(candidates, {
      targetDurationMs: 60 * 60_000,
      perArtistCap: 10,
      shuffleWindowSize: windowSize,
      rng: seqRng([0.1, 0.5, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4]),
    });
    for (let pos = 0; pos < result.length; pos += 1) {
      const id = result[pos]!.trackId;
      const sortedIndex = Number(id.replace("t", ""));
      const windowStart = Math.floor(sortedIndex / windowSize) * windowSize;
      const windowEnd = windowStart + windowSize - 1;
      expect(pos).toBeGreaterThanOrEqual(windowStart);
      expect(pos).toBeLessThanOrEqual(windowEnd);
    }
  });

  it("returns fewer tracks than requested if the library is too small", () => {
    const candidates = [
      track("a", { finalScore: 0.5, durationMs: 60_000 }),
      track("b", { finalScore: 0.4, durationMs: 60_000 }),
    ];
    const result = rankAndFilter(candidates, {
      targetDurationMs: 60 * 60 * 1000, // 60min, library is 2min
      perArtistCap: 10,
      ...NO_SHUFFLE,
    });
    expect(result.length).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// normalizeTitleForDedup — collapse variant markers to a canonical core
// ──────────────────────────────────────────────────────────────────────────

describe("normalizeTitleForDedup", () => {
  it("collapses parenthetical variant markers", () => {
    expect(normalizeTitleForDedup("Call on Me")).toBe("call on me");
    expect(normalizeTitleForDedup("Call on Me (Radio Edit)")).toBe("call on me");
    expect(normalizeTitleForDedup("Call on Me (Radio Mix)")).toBe("call on me");
  });

  it("collapses bracketed + brace variant markers", () => {
    expect(normalizeTitleForDedup("Hey Jude [Remastered 2015]")).toBe("hey jude");
    expect(normalizeTitleForDedup("Song {Bonus Track}")).toBe("song");
  });

  it("strips dash-separated variant suffixes", () => {
    expect(normalizeTitleForDedup("Call on Me - Radio Mix")).toBe("call on me");
    expect(normalizeTitleForDedup("Bohemian Rhapsody - Remastered 2011")).toBe(
      "bohemian rhapsody",
    );
    expect(normalizeTitleForDedup("Someone Like You - Live")).toBe(
      "someone like you",
    );
  });

  it("keeps literal hyphens in the title (no surrounding whitespace)", () => {
    // Dash strip only fires on `\s+-\s+` — titles with internal hyphens
    // like "Rock-a-Bye" survive. Without this, many legit titles would
    // lose everything after the hyphen.
    expect(normalizeTitleForDedup("Rock-a-Bye")).toBe("rock a bye");
  });

  it("strips trailing feat./ft./featuring clauses", () => {
    expect(normalizeTitleForDedup("Hey Jude feat. The Beatles")).toBe("hey jude");
    expect(normalizeTitleForDedup("Love Yourself ft Ed Sheeran")).toBe(
      "love yourself",
    );
    expect(normalizeTitleForDedup("Song featuring someone")).toBe("song");
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    expect(normalizeTitleForDedup("  CALL ON ME   ")).toBe("call on me");
    expect(normalizeTitleForDedup("Call On Me")).toBe("call on me");
  });

  it("strips punctuation to spaces and collapses whitespace", () => {
    expect(normalizeTitleForDedup("Don't Stop Me Now!")).toBe(
      "don t stop me now",
    );
  });

  it("falls back to the raw lowercased title when normalization empties the string", () => {
    // Title is entirely parenthetical — avoid mass-collapsing tracks
    // to a single empty key.
    expect(normalizeTitleForDedup("(Live)")).toBe("(live)");
  });

  it("does NOT strip 'remix' — remixes are distinct artistic works", () => {
    // Intentional design choice. A Daft Punk Remix of a song is a
    // different track than the original; keep both in the library and
    // let the user have them both in the playlist.
    expect(normalizeTitleForDedup("Song (Daft Punk Remix)")).toBe("song");
    expect(normalizeTitleForDedup("Song - Daft Punk Remix")).toBe("song");
    // But if the whole title is just "Remix", it survives.
    expect(normalizeTitleForDedup("Remix")).toBe("remix");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// rankAndFilter — dedup of near-duplicate variants
// ──────────────────────────────────────────────────────────────────────────

describe("rankAndFilter dedup", () => {
  const NO_SHUFFLE = { shuffleWindowSize: 1 as const };

  it("keeps only the highest-scoring variant of a song by the same artist", () => {
    // Three variants by the same artist, same normalized core.
    // rankAndFilter sorts by finalScore DESC before walking, so the
    // 0.9 variant claims the dedup key and the others are dropped.
    const candidates: ScoredTrack[] = [
      track("a1", {
        name: "Call on Me (Radio Edit)",
        primaryArtistId: "artist-prydz",
        finalScore: 0.7,
      }),
      track("a2", {
        name: "Call on Me",
        primaryArtistId: "artist-prydz",
        finalScore: 0.9,
      }),
      track("a3", {
        name: "Call on Me - Radio Mix",
        primaryArtistId: "artist-prydz",
        finalScore: 0.5,
      }),
    ];
    const result = rankAndFilter(candidates, {
      targetDurationMs: 60 * 60 * 1000,
      perArtistCap: 10,
      ...NO_SHUFFLE,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.trackId).toBe("a2");
  });

  it("keeps same-title tracks by different artists (dedup key includes artist)", () => {
    // Eric Prydz and a hypothetical cover by a different artist both
    // called "Call on Me" — distinct songs, both should appear.
    const candidates: ScoredTrack[] = [
      track("prydz", {
        name: "Call on Me",
        primaryArtistId: "artist-prydz",
        finalScore: 0.9,
      }),
      track("cover", {
        name: "Call on Me",
        primaryArtistId: "artist-cover",
        finalScore: 0.8,
      }),
    ];
    const result = rankAndFilter(candidates, {
      targetDurationMs: 60 * 60 * 1000,
      perArtistCap: 10,
      ...NO_SHUFFLE,
    });
    expect(result.map((r) => r.trackId).sort()).toEqual(["cover", "prydz"]);
  });

  it("drops non-seed variants that collide with a required seed track", () => {
    // Seed is "Call on Me"; library has a high-scoring "(Radio Edit)"
    // variant by the same artist. The seed is required, so it stays;
    // the variant must be filtered out despite its high score.
    const candidates: ScoredTrack[] = [
      track("seed", {
        name: "Call on Me",
        primaryArtistId: "artist-prydz",
        finalScore: 0.2, // low score — would normally lose to the variant
      }),
      track("variant", {
        name: "Call on Me (Radio Edit)",
        primaryArtistId: "artist-prydz",
        finalScore: 0.95,
      }),
      // Unrelated track to prove we're not filtering everything.
      track("other", {
        name: "Some Other Song",
        primaryArtistId: "artist-prydz",
        finalScore: 0.8,
      }),
    ];
    const result = rankAndFilter(candidates, {
      targetDurationMs: 60 * 60 * 1000,
      perArtistCap: 10,
      requiredTrackIds: ["seed"],
      ...NO_SHUFFLE,
    });
    const ids = result.map((r) => r.trackId);
    expect(ids).toContain("seed");
    expect(ids).not.toContain("variant");
    expect(ids).toContain("other");
  });

  it("drops top-up candidates that match the dedup key of an existing track", () => {
    // Top-up flow: a "Call on Me" is already in the playlist (passed
    // via excludeIds). A "(Radio Edit)" variant shouldn't get picked
    // as a top-up — the user already has that song.
    const existing = track("existing", {
      name: "Call on Me",
      primaryArtistId: "artist-prydz",
      finalScore: 0.5,
    });
    const variant = track("variant", {
      name: "Call on Me (Radio Edit)",
      primaryArtistId: "artist-prydz",
      finalScore: 0.95,
    });
    const fresh = track("fresh", {
      name: "New Song",
      primaryArtistId: "artist-prydz",
      finalScore: 0.8,
    });
    const result = rankAndFilter([existing, variant, fresh], {
      targetDurationMs: 60 * 60 * 1000,
      perArtistCap: 10,
      excludeIds: new Set(["existing"]),
      ...NO_SHUFFLE,
    });
    const ids = result.map((r) => r.trackId);
    expect(ids).not.toContain("variant");
    expect(ids).toContain("fresh");
  });
});
