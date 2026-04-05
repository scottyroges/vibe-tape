import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindAllWithScoringFieldsByUser } = vi.hoisted(() => ({
  mockFindAllWithScoringFieldsByUser: vi.fn(),
}));

vi.mock("@/repositories/track.repository", () => ({
  trackRepository: {
    findAllWithScoringFieldsByUser: mockFindAllWithScoringFieldsByUser,
  },
}));

import { scoreLibrary } from "@/inngest/helpers/score-library";
import type { VibeProfile } from "@/lib/vibe-profile";

function makeRow(overrides: {
  id: string;
  mood?: string | null;
  genres?: string[];
  durationMs?: number | null;
}) {
  return {
    id: overrides.id,
    spotifyId: `sp-${overrides.id}`,
    name: overrides.id,
    album: "Album",
    albumArtUrl: null,
    vibeMood: overrides.mood ?? "uplifting",
    vibeEnergy: "high",
    vibeDanceability: "high",
    vibeGenres: overrides.genres ?? ["pop"],
    vibeTags: ["summer"],
    vibeVersion: 1,
    vibeUpdatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    primaryArtistId: `a-${overrides.id}`,
    durationMs: "durationMs" in overrides ? overrides.durationMs : 200_000,
  };
}

const CLAUDE_TARGET: VibeProfile = {
  mood: "uplifting",
  energy: "high",
  danceability: "high",
  genres: ["pop"],
  tags: ["summer"],
};

const MATH_TARGET: VibeProfile = {
  mood: "uplifting",
  energy: "high",
  danceability: "high",
  genres: ["pop"],
  tags: ["summer"],
};

const DEGENERATE: VibeProfile = {
  mood: null,
  energy: null,
  danceability: null,
  genres: [],
  tags: [],
};

describe("scoreLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scores every row with claude + math + averaged final", async () => {
    mockFindAllWithScoringFieldsByUser.mockResolvedValue([
      makeRow({ id: "t1" }),
      makeRow({ id: "t2", mood: "melancholic", genres: ["indie"] }),
    ]);

    const result = await scoreLibrary("u1", {
      claude: CLAUDE_TARGET,
      math: MATH_TARGET,
    });

    expect(result).toHaveLength(2);
    const byId = new Map(result.map((r) => [r.trackId, r]));
    const t1 = byId.get("t1")!;
    const t2 = byId.get("t2")!;

    // t1 is a perfect match on both — finalScore should be 1.
    expect(t1.claudeScore).toBeCloseTo(1);
    expect(t1.mathScore).toBeCloseTo(1);
    expect(t1.finalScore).toBeCloseTo(1);

    // t2 mismatches mood+genres — should score below t1 on both sides
    // and also below t1's final. We don't assert the exact blending
    // formula here: that's `computeFinalScore`'s responsibility (with
    // degenerate-target fallback), and locking in `(a+b)/2` would
    // silently regress the day someone points the test at a
    // degenerate target.
    expect(t2.claudeScore).toBeLessThan(t1.claudeScore);
    expect(t2.mathScore).toBeLessThan(t1.mathScore);
    expect(t2.finalScore).toBeLessThan(t1.finalScore);
  });

  it("falls back to the non-degenerate side when claude target is empty", async () => {
    mockFindAllWithScoringFieldsByUser.mockResolvedValue([
      makeRow({ id: "t1" }),
    ]);

    const result = await scoreLibrary("u1", {
      claude: DEGENERATE,
      math: MATH_TARGET,
    });

    expect(result[0]!.finalScore).toBeCloseTo(result[0]!.mathScore);
  });

  it("coerces null durationMs to 0", async () => {
    mockFindAllWithScoringFieldsByUser.mockResolvedValue([
      makeRow({ id: "t1", durationMs: null }),
    ]);

    const result = await scoreLibrary("u1", {
      claude: CLAUDE_TARGET,
      math: MATH_TARGET,
    });

    expect(result[0]!.durationMs).toBe(0);
  });

  it("returns an empty array for an empty library", async () => {
    mockFindAllWithScoringFieldsByUser.mockResolvedValue([]);

    const result = await scoreLibrary("u1", {
      claude: CLAUDE_TARGET,
      math: MATH_TARGET,
    });

    expect(result).toEqual([]);
  });
});
