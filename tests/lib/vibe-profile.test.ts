// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  deriveVibeProfile,
  MAX_GENRES,
  MAX_TAGS,
  type DeriveVibeProfileInput,
  type VibeProfile,
} from "@/lib/vibe-profile";

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function baseInput(
  overrides: Partial<DeriveVibeProfileInput> = {},
): DeriveVibeProfileInput {
  return {
    claude: null,
    trackSpotify: null,
    trackLastfm: null,
    artistLastfmTags: [],
    artistNames: [],
    ...overrides,
  };
}

function claude(
  mood: string | null,
  energy: string | null,
  danceability: string | null,
  vibeTags: string[],
): DeriveVibeProfileInput["claude"] {
  return { mood, energy, danceability, vibeTags };
}

// ──────────────────────────────────────────────────────────────────────────
// Tag normalization (via deriveVibeProfile's public surface)
// ──────────────────────────────────────────────────────────────────────────

describe("normalization: whitespace + case", () => {
  it("lowercases and collapses whitespace", () => {
    const result = deriveVibeProfile(
      baseInput({
        claude: claude(null, null, null, ["Hip-Hop", "HIPHOP", "hip hop"]),
      }),
    );
    expect(result.genres).toEqual(["hip-hop"]);
  });

  it("trims and collapses repeated internal whitespace", () => {
    const result = deriveVibeProfile(
      baseInput({
        claude: claude(null, null, null, ["  post   punk  "]),
      }),
    );
    expect(result.genres).toContain("post-punk");
  });

  it("empty / whitespace-only tags are dropped", () => {
    const result = deriveVibeProfile(
      baseInput({
        claude: claude(null, null, null, ["", "   ", "\t\n"]),
      }),
    );
    expect(result.genres).toEqual([]);
    expect(result.tags).toEqual([]);
  });
});

describe("normalization: synonyms", () => {
  it("rnb / r and b / r & b → r&b", () => {
    const result1 = deriveVibeProfile(
      baseInput({ claude: claude(null, null, null, ["rnb"]) }),
    );
    const result2 = deriveVibeProfile(
      baseInput({ claude: claude(null, null, null, ["r and b"]) }),
    );
    const result3 = deriveVibeProfile(
      baseInput({ claude: claude(null, null, null, ["r & b"]) }),
    );
    const result4 = deriveVibeProfile(
      baseInput({ claude: claude(null, null, null, ["R&B"]) }),
    );
    expect(result1.genres).toEqual(["r&b"]);
    expect(result2.genres).toEqual(["r&b"]);
    expect(result3.genres).toEqual(["r&b"]);
    expect(result4.genres).toEqual(["r&b"]);
  });

  it("alternative rock variants collapse", () => {
    const result = deriveVibeProfile(
      baseInput({
        claude: claude(null, null, null, [
          "Alternative Rock",
          "alternative-rock",
          "alternative rock",
        ]),
      }),
    );
    expect(result.genres).toEqual(["alternative-rock"]);
  });

  it("nu metal / post punk revival collapse", () => {
    const result = deriveVibeProfile(
      baseInput({
        claude: claude(null, null, null, [
          "nu metal",
          "nu-metal",
          "post punk",
          "post-punk revival",
        ]),
      }),
    );
    expect(result.genres).toContain("nu-metal");
    expect(result.genres).toContain("post-punk");
  });
});

describe("normalization: ignore list", () => {
  it.each([
    "love",
    "cover",
    "seen live",
    "female vocalists",
    "favourites",
    "soundtrack",
  ])("drops %s", (tag) => {
    const result = deriveVibeProfile(
      baseInput({ claude: claude(null, null, null, [tag]) }),
    );
    expect(result.tags).not.toContain(tag);
    expect(result.genres).not.toContain(tag);
  });
});

describe("normalization: artist-name filter", () => {
  it("drops tag matching the track's artist", () => {
    const result = deriveVibeProfile(
      baseInput({
        artistNames: ["Kanye West"],
        artistLastfmTags: ["kanye west", "hip-hop"],
      }),
    );
    expect(result.tags).not.toContain("kanye west");
    expect(result.genres).toContain("hip-hop");
  });

  it("artist-name filter is case and whitespace normalized", () => {
    const result = deriveVibeProfile(
      baseInput({
        artistNames: ["Kanye West"],
        artistLastfmTags: ["KANYE   WEST"],
      }),
    );
    expect(result.tags).toEqual([]);
  });

  it("multi-artist track: any artist match drops the tag", () => {
    const result = deriveVibeProfile(
      baseInput({
        artistNames: ["Kanye West", "Jay-Z"],
        claude: claude(null, null, null, ["jay-z", "hip-hop"]),
      }),
    );
    expect(result.tags).toEqual([]);
    expect(result.genres).toEqual(["hip-hop"]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Genre vs tag split
// ──────────────────────────────────────────────────────────────────────────

describe("genre vs tag classification", () => {
  it("hip-hop → genres", () => {
    const result = deriveVibeProfile(
      baseInput({ claude: claude(null, null, null, ["hip-hop"]) }),
    );
    expect(result.genres).toEqual(["hip-hop"]);
    expect(result.tags).toEqual([]);
  });

  it("driving → tags", () => {
    const result = deriveVibeProfile(
      baseInput({ claude: claude(null, null, null, ["driving"]) }),
    );
    expect(result.tags).toEqual(["driving"]);
    expect(result.genres).toEqual([]);
  });

  it("80s → tags (era, not genre)", () => {
    const result = deriveVibeProfile(
      baseInput({ claude: claude(null, null, null, ["80s"]) }),
    );
    expect(result.tags).toEqual(["80s"]);
    expect(result.genres).toEqual([]);
  });

  it("indie-rock → genres", () => {
    const result = deriveVibeProfile(
      baseInput({ claude: claude(null, null, null, ["indie-rock"]) }),
    );
    expect(result.genres).toEqual(["indie-rock"]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Decade normalization
// ──────────────────────────────────────────────────────────────────────────

describe("decade normalization", () => {
  it.each([
    ["1950s", "50s"],
    ["1960s", "60s"],
    ["1970s", "70s"],
    ["1980s", "80s"],
    ["1990s", "90s"],
  ])("1900s long form %s → short form %s", (input, expected) => {
    const result = deriveVibeProfile(
      baseInput({ claude: claude(null, null, null, [input]) }),
    );
    expect(result.tags).toEqual([expected]);
  });

  it.each(["2000s", "2010s", "2020s"])(
    "2000s+ long form %s passes through",
    (decade) => {
      const result = deriveVibeProfile(
        baseInput({ claude: claude(null, null, null, [decade]) }),
      );
      expect(result.tags).toEqual([decade]);
    },
  );

  it("early-2000s → 2000s", () => {
    const result = deriveVibeProfile(
      baseInput({ claude: claude(null, null, null, ["early-2000s"]) }),
    );
    expect(result.tags).toEqual(["2000s"]);
  });

  it.each([
    ["1979", "70s"],
    ["1985", "80s"],
    ["1999", "90s"],
    ["2011", "2010s"],
    ["2020", "2020s"],
    ["2007", "2000s"],
  ])("specific year %s → decade %s", (year, decade) => {
    const result = deriveVibeProfile(
      baseInput({ claude: claude(null, null, null, [year]) }),
    );
    expect(result.tags).toEqual([decade]);
  });

  it("1980s from one source + 80s from another dedupe with hit promotion", () => {
    const result = deriveVibeProfile(
      baseInput({
        claude: claude(null, null, null, ["80s"]),
        trackLastfm: { tags: ["1980s"] },
      }),
    );
    expect(result.tags).toEqual(["80s"]);
  });

  it("Spotify derivedEra 1980s feeds through as 80s", () => {
    const result = deriveVibeProfile(
      baseInput({ trackSpotify: { derivedEra: "1980s" } }),
    );
    expect(result.tags).toEqual(["80s"]);
  });

  it("Spotify derivedEra 2020s passes through", () => {
    const result = deriveVibeProfile(
      baseInput({ trackSpotify: { derivedEra: "2020s" } }),
    );
    expect(result.tags).toEqual(["2020s"]);
  });

  it("Spotify derivedEra 1980s + Last.fm 80s dedupe with hit promotion", () => {
    // After normalization both become "80s". With hitCount=2, the entry
    // outranks any single-hit tag.
    const result = deriveVibeProfile(
      baseInput({
        trackSpotify: { derivedEra: "1980s" },
        trackLastfm: { tags: ["80s", "driving"] },
      }),
    );
    // 80s: hitCount=2, driving: hitCount=1 — so 80s is first.
    expect(result.tags).toEqual(["80s", "driving"]);
  });

  it("Spotify derivedEra 80s + Last.fm 80s dedupe to single entry", () => {
    const result = deriveVibeProfile(
      baseInput({
        trackSpotify: { derivedEra: "80s" },
        trackLastfm: { tags: ["80s"] },
      }),
    );
    expect(result.tags).toEqual(["80s"]);
  });

  it("compound decade tags pass through as single tokens", () => {
    const result = deriveVibeProfile(
      baseInput({ claude: claude(null, null, null, ["80s funk"]) }),
    );
    expect(result.tags).toEqual(["80s funk"]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Deduplication
// ──────────────────────────────────────────────────────────────────────────

describe("deduplication", () => {
  it("same canonical tag across all sources appears once", () => {
    const result = deriveVibeProfile(
      baseInput({
        claude: claude(null, null, null, ["hip-hop"]),
        trackLastfm: { tags: ["hip hop"] },
        artistLastfmTags: ["HIPHOP"],
      }),
    );
    expect(result.genres).toEqual(["hip-hop"]);
  });

  it("multi-source hits rank above single-source hits", () => {
    const result = deriveVibeProfile(
      baseInput({
        claude: claude(null, null, null, ["hip-hop", "driving"]),
        trackLastfm: { tags: ["rap"] },
        artistLastfmTags: ["rap"],
      }),
    );
    // rap: hitCount=2, hip-hop: hitCount=1
    expect(result.genres).toEqual(["rap", "hip-hop"]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Ranking (worked example from the plan)
// ──────────────────────────────────────────────────────────────────────────

describe("ranking: plan's worked example", () => {
  it("produces the expected ordered genres and tags", () => {
    const result = deriveVibeProfile(
      baseInput({
        claude: claude(null, null, null, ["hip-hop", "energetic", "driving"]),
        trackLastfm: { tags: ["hip-hop", "rap", "party"] },
        artistLastfmTags: ["hip-hop", "rap", "80s"],
      }),
    );
    // hip-hop: hitCount=3, rap: hitCount=2, others: hitCount=1
    expect(result.genres).toEqual(["hip-hop", "rap"]);
    // 'party' is in the ignore list, so it's dropped
    expect(result.tags).toEqual(["energetic", "driving", "80s"]);
  });
});

describe("ranking: source precedence tie-breaker", () => {
  it("among single-hit tags, Claude outranks Last.fm track", () => {
    const result = deriveVibeProfile(
      baseInput({
        claude: claude(null, null, null, ["foo"]),
        trackLastfm: { tags: ["bar"] },
      }),
    );
    // foo (sourceRank=0) before bar (sourceRank=1)
    expect(result.tags).toEqual(["foo", "bar"]);
  });

  it("Last.fm track outranks Last.fm artist", () => {
    const result = deriveVibeProfile(
      baseInput({
        trackLastfm: { tags: ["foo"] },
        artistLastfmTags: ["bar"],
      }),
    );
    expect(result.tags).toEqual(["foo", "bar"]);
  });

  it("Claude and Spotify derivedEra are tied at sourceRank 0", () => {
    // Two single-hit tags at sourceRank 0: Claude's "foo" at index 0 and
    // Spotify's "80s" at index 0. Ties broken by within-source index, but
    // both are 0 — order is arbitrary, but deterministic by insertion.
    const result = deriveVibeProfile(
      baseInput({
        claude: claude(null, null, null, ["foo"]),
        trackSpotify: { derivedEra: "80s" },
      }),
    );
    expect(result.tags).toContain("foo");
    expect(result.tags).toContain("80s");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Mood clustering
// ──────────────────────────────────────────────────────────────────────────

describe("mood clustering", () => {
  it.each([
    ["uplifting", "uplifting"],
    ["joyful", "uplifting"],
    ["spiritual", "uplifting"],
    ["transcendent", "uplifting"],
    ["angst-driven", "aggressive"],
    ["sultry", "romantic"],
    ["reflective", "nostalgic"],
    ["contemplative", "nostalgic"],
    ["ethereal", "dreamy"],
    ["chill", "peaceful"],
  ])("%s → %s", (input, expected) => {
    const result = deriveVibeProfile(
      baseInput({ claude: claude(input, null, null, []) }),
    );
    expect(result.mood).toBe(expected);
  });

  it.each(["soulful", "groovy", "thriller", "mechanical", "unknown-mood"])(
    "intentionally-excluded or unknown mood %s → null",
    (input) => {
      const result = deriveVibeProfile(
        baseInput({ claude: claude(input, null, null, []) }),
      );
      expect(result.mood).toBeNull();
    },
  );

  it("null mood → null", () => {
    const result = deriveVibeProfile(
      baseInput({ claude: claude(null, null, null, []) }),
    );
    expect(result.mood).toBeNull();
  });

  it("mood is normalized for lookup (case, whitespace)", () => {
    const result = deriveVibeProfile(
      baseInput({ claude: claude("  Joyful  ", null, null, []) }),
    );
    expect(result.mood).toBe("uplifting");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Energy / danceability pass-through
// ──────────────────────────────────────────────────────────────────────────

describe("energy and danceability", () => {
  it.each(["low", "medium", "high"])("valid energy %s passes through", (v) => {
    const result = deriveVibeProfile(
      baseInput({ claude: claude(null, v, v, []) }),
    );
    expect(result.energy).toBe(v);
    expect(result.danceability).toBe(v);
  });

  it("null energy / danceability → null", () => {
    const result = deriveVibeProfile(
      baseInput({ claude: claude(null, null, null, []) }),
    );
    expect(result.energy).toBeNull();
    expect(result.danceability).toBeNull();
  });

  it("invalid energy value → null", () => {
    const result = deriveVibeProfile(
      baseInput({ claude: claude(null, "ultra" as string, "extreme", []) }),
    );
    expect(result.energy).toBeNull();
    expect(result.danceability).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Missing-source behavior
// ──────────────────────────────────────────────────────────────────────────

describe("missing source behavior", () => {
  it("claude null: mood/energy/danceability all null, tags still come from other sources", () => {
    const result = deriveVibeProfile(
      baseInput({
        claude: null,
        trackLastfm: { tags: ["hip-hop", "driving"] },
        trackSpotify: { derivedEra: "80s" },
      }),
    );
    expect(result.mood).toBeNull();
    expect(result.energy).toBeNull();
    expect(result.danceability).toBeNull();
    expect(result.genres).toEqual(["hip-hop"]);
    expect(result.tags).toContain("driving");
    expect(result.tags).toContain("80s");
  });

  it("no Last.fm data: tags come from Claude and Spotify era only", () => {
    const result = deriveVibeProfile(
      baseInput({
        claude: claude("joyful", "high", "high", ["hip-hop", "energetic"]),
        trackSpotify: { derivedEra: "2020s" },
      }),
    );
    expect(result.mood).toBe("uplifting");
    expect(result.genres).toEqual(["hip-hop"]);
    expect(result.tags).toContain("energetic");
    expect(result.tags).toContain("2020s");
  });

  it("no Spotify era: other sources still produce output", () => {
    const result = deriveVibeProfile(
      baseInput({
        claude: claude("joyful", "high", "medium", ["rock"]),
      }),
    );
    expect(result.genres).toEqual(["rock"]);
    expect(result.mood).toBe("uplifting");
  });

  it("trackSpotify with null derivedEra is treated as absent", () => {
    const result = deriveVibeProfile(
      baseInput({
        trackSpotify: { derivedEra: null },
        claude: claude(null, null, null, ["rock"]),
      }),
    );
    expect(result.genres).toEqual(["rock"]);
    expect(result.tags).toEqual([]);
  });

  it("everything empty → empty profile", () => {
    const result = deriveVibeProfile(baseInput({}));
    const expected: VibeProfile = {
      mood: null,
      energy: null,
      danceability: null,
      genres: [],
      tags: [],
    };
    expect(result).toEqual(expected);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Array caps
// ──────────────────────────────────────────────────────────────────────────

describe("array caps", () => {
  it("caps genres at MAX_GENRES", () => {
    const manyGenres = [
      "rock",
      "pop",
      "jazz",
      "blues",
      "folk",
      "country",
      "metal",
      "punk",
      "indie",
      "alternative",
      "dance",
      "funk",
    ];
    expect(manyGenres.length).toBeGreaterThan(MAX_GENRES);
    const result = deriveVibeProfile(
      baseInput({ claude: claude(null, null, null, manyGenres) }),
    );
    expect(result.genres).toHaveLength(MAX_GENRES);
  });

  it("caps tags at MAX_TAGS", () => {
    const manyTags = Array.from({ length: 20 }, (_, i) => `descriptor-${i}`);
    expect(manyTags.length).toBeGreaterThan(MAX_TAGS);
    const result = deriveVibeProfile(
      baseInput({ claude: claude(null, null, null, manyTags) }),
    );
    expect(result.tags).toHaveLength(MAX_TAGS);
  });

  it("caps are applied after ranking (lowest-ranked entries dropped)", () => {
    // 10 genres from Last.fm artist (sourceRank=2, all hitCount=1),
    // plus 1 genre from Claude (sourceRank=0, hitCount=1) —
    // the Claude one should survive the cap because it has lower sourceRank.
    const artistGenres = [
      "rock",
      "pop",
      "jazz",
      "blues",
      "folk",
      "country",
      "metal",
      "punk",
      "indie",
      "alternative",
    ];
    const result = deriveVibeProfile(
      baseInput({
        claude: claude(null, null, null, ["hyperpop"]),
        artistLastfmTags: artistGenres,
      }),
    );
    expect(result.genres).toHaveLength(MAX_GENRES);
    expect(result.genres[0]).toBe("hyperpop");
  });

  it("genre and tag caps are independent", () => {
    // 12 genres + 15 tags. Both should fill independently without competing.
    const genres = [
      "rock",
      "pop",
      "jazz",
      "blues",
      "folk",
      "country",
      "metal",
      "punk",
      "indie",
      "alternative",
      "dance",
      "funk",
    ];
    const tags = Array.from({ length: 15 }, (_, i) => `tag-${i}`);
    const result = deriveVibeProfile(
      baseInput({
        claude: claude(null, null, null, [...genres, ...tags]),
      }),
    );
    expect(result.genres).toHaveLength(MAX_GENRES);
    expect(result.tags).toHaveLength(MAX_TAGS);
  });
});
