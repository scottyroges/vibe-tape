// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  buildPlaylistCriteriaPrompt,
  parsePlaylistCriteriaResponse,
  VIBE_DESCRIPTION_MAX_LENGTH,
  VIBE_NAME_MAX_LENGTH,
  type PlaylistCriteriaSeed,
} from "@/lib/prompts/generate-playlist-criteria";
import { CANONICAL_MOODS } from "@/lib/prompts/classify-tracks";
import { GENRE_VOCAB } from "@/lib/vibe-profile";

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function seed(
  overrides: Partial<PlaylistCriteriaSeed> = {},
): PlaylistCriteriaSeed {
  return {
    name: "Test Track",
    artist: "Test Artist",
    mood: "uplifting",
    energy: "high",
    danceability: "high",
    genres: ["pop"],
    tags: ["summer"],
    ...overrides,
  };
}

function validResponse() {
  return {
    target: {
      mood: "uplifting",
      energy: "high",
      danceability: "high",
      genres: ["hip-hop", "pop"],
      tags: ["summer", "driving"],
    },
    vibeName: "Summer Shotgun",
    vibeDescription: "Windows-down anthems you scream along to.",
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Prompt builder
// ──────────────────────────────────────────────────────────────────────────

describe("buildPlaylistCriteriaPrompt", () => {
  it("includes every canonical mood in the system prompt", () => {
    const { system } = buildPlaylistCriteriaPrompt([seed()]);
    for (const mood of CANONICAL_MOODS) {
      expect(system).toContain(mood);
    }
  });

  it("includes every canonical genre in the system prompt", () => {
    const { system } = buildPlaylistCriteriaPrompt([seed()]);
    for (const genre of GENRE_VOCAB) {
      expect(system).toContain(genre);
    }
  });

  it("describes the expected JSON shape", () => {
    const { system } = buildPlaylistCriteriaPrompt([seed()]);
    expect(system).toContain("target");
    expect(system).toContain("vibeName");
    expect(system).toContain("vibeDescription");
  });

  it("serializes seeds into the user prompt", () => {
    const seeds = [
      seed({ name: "Alpha", artist: "Artist A" }),
      seed({ name: "Beta", artist: "Artist B" }),
    ];
    const { user } = buildPlaylistCriteriaPrompt(seeds);
    expect(user).toContain("Alpha");
    expect(user).toContain("Artist A");
    expect(user).toContain("Beta");
    expect(user).toContain("Artist B");
  });

  it("omits the user-intent block when intent is undefined", () => {
    const { user } = buildPlaylistCriteriaPrompt([seed()]);
    expect(user).not.toContain("User intent");
  });

  it("omits the user-intent block when intent is an empty string", () => {
    const { user } = buildPlaylistCriteriaPrompt([seed()], "");
    expect(user).not.toContain("User intent");
  });

  it("omits the user-intent block when intent is only whitespace", () => {
    const { user } = buildPlaylistCriteriaPrompt([seed()], "   \t\n");
    expect(user).not.toContain("User intent");
  });

  it("includes the user-intent block verbatim when provided", () => {
    const { user } = buildPlaylistCriteriaPrompt(
      [seed()],
      "rainy Sunday coffee shop",
    );
    expect(user).toContain("User intent");
    expect(user).toContain("rainy Sunday coffee shop");
  });

  it("trims surrounding whitespace from the intent before inclusion", () => {
    const { user } = buildPlaylistCriteriaPrompt(
      [seed()],
      "  getting hyped for a run  ",
    );
    expect(user).toContain("getting hyped for a run");
    // The trimmed form appears, not the padded original.
    expect(user).not.toContain("  getting hyped");
  });

  it("seed-only prompt equals undefined-intent prompt (empty-string treated as absent)", () => {
    const a = buildPlaylistCriteriaPrompt([seed()]);
    const b = buildPlaylistCriteriaPrompt([seed()], "");
    expect(a.user).toBe(b.user);
    expect(a.system).toBe(b.system);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Response validator
// ──────────────────────────────────────────────────────────────────────────

describe("parsePlaylistCriteriaResponse", () => {
  it("accepts a well-formed response", () => {
    const parsed = parsePlaylistCriteriaResponse(validResponse());
    expect(parsed).not.toBeNull();
    expect(parsed?.target.mood).toBe("uplifting");
    expect(parsed?.target.genres).toEqual(["hip-hop", "pop"]);
    expect(parsed?.vibeName).toBe("Summer Shotgun");
  });

  it("accepts null mood, energy, danceability", () => {
    const parsed = parsePlaylistCriteriaResponse({
      ...validResponse(),
      target: {
        mood: null,
        energy: null,
        danceability: null,
        genres: ["pop"],
        tags: ["summer"],
      },
    });
    expect(parsed?.target.mood).toBeNull();
    expect(parsed?.target.energy).toBeNull();
    expect(parsed?.target.danceability).toBeNull();
  });

  it("normalizes mood casing", () => {
    const parsed = parsePlaylistCriteriaResponse({
      ...validResponse(),
      target: { ...validResponse().target, mood: "Uplifting" },
    });
    expect(parsed?.target.mood).toBe("uplifting");
  });

  it("rejects off-list moods", () => {
    const parsed = parsePlaylistCriteriaResponse({
      ...validResponse(),
      target: { ...validResponse().target, mood: "ethereal" },
    });
    expect(parsed).toBeNull();
  });

  it("rejects invalid energy / danceability values", () => {
    expect(
      parsePlaylistCriteriaResponse({
        ...validResponse(),
        target: { ...validResponse().target, energy: "extreme" },
      }),
    ).toBeNull();
    expect(
      parsePlaylistCriteriaResponse({
        ...validResponse(),
        target: { ...validResponse().target, danceability: 3 },
      }),
    ).toBeNull();
  });

  it("rejects non-array genres / tags", () => {
    expect(
      parsePlaylistCriteriaResponse({
        ...validResponse(),
        target: { ...validResponse().target, genres: "pop" },
      }),
    ).toBeNull();
    expect(
      parsePlaylistCriteriaResponse({
        ...validResponse(),
        target: { ...validResponse().target, tags: null },
      }),
    ).toBeNull();
  });

  it("rejects arrays containing non-string or empty entries", () => {
    expect(
      parsePlaylistCriteriaResponse({
        ...validResponse(),
        target: { ...validResponse().target, genres: ["pop", 42] },
      }),
    ).toBeNull();
    expect(
      parsePlaylistCriteriaResponse({
        ...validResponse(),
        target: { ...validResponse().target, tags: ["summer", "  "] },
      }),
    ).toBeNull();
  });

  it("rejects missing target field", () => {
    const response: Record<string, unknown> = validResponse();
    delete response.target;
    expect(parsePlaylistCriteriaResponse(response)).toBeNull();
  });

  it("rejects missing vibeName field", () => {
    const response: Record<string, unknown> = validResponse();
    delete response.vibeName;
    expect(parsePlaylistCriteriaResponse(response)).toBeNull();
  });

  it("rejects missing vibeDescription field", () => {
    const response: Record<string, unknown> = validResponse();
    delete response.vibeDescription;
    expect(parsePlaylistCriteriaResponse(response)).toBeNull();
  });

  it("rejects empty genre or tag arrays (malformed Haiku output, not a deliberate choice)", () => {
    expect(
      parsePlaylistCriteriaResponse({
        ...validResponse(),
        target: { ...validResponse().target, genres: [] },
      }),
    ).toBeNull();
    expect(
      parsePlaylistCriteriaResponse({
        ...validResponse(),
        target: { ...validResponse().target, tags: [] },
      }),
    ).toBeNull();
  });

  it("rejects non-object input", () => {
    expect(parsePlaylistCriteriaResponse(null)).toBeNull();
    expect(parsePlaylistCriteriaResponse("not json")).toBeNull();
    expect(parsePlaylistCriteriaResponse([])).toBeNull();
    expect(parsePlaylistCriteriaResponse(42)).toBeNull();
  });

  it("rejects empty vibeName", () => {
    expect(
      parsePlaylistCriteriaResponse({ ...validResponse(), vibeName: "" }),
    ).toBeNull();
    expect(
      parsePlaylistCriteriaResponse({ ...validResponse(), vibeName: "   " }),
    ).toBeNull();
  });

  it("rejects vibeName over 60 characters", () => {
    const tooLong = "x".repeat(VIBE_NAME_MAX_LENGTH + 1);
    expect(
      parsePlaylistCriteriaResponse({ ...validResponse(), vibeName: tooLong }),
    ).toBeNull();
  });

  it("accepts vibeName at exactly 60 characters", () => {
    const exact = "x".repeat(VIBE_NAME_MAX_LENGTH);
    const parsed = parsePlaylistCriteriaResponse({
      ...validResponse(),
      vibeName: exact,
    });
    expect(parsed?.vibeName).toBe(exact);
  });

  it("rejects vibeDescription over 120 characters", () => {
    const tooLong = "x".repeat(VIBE_DESCRIPTION_MAX_LENGTH + 1);
    expect(
      parsePlaylistCriteriaResponse({
        ...validResponse(),
        vibeDescription: tooLong,
      }),
    ).toBeNull();
  });

  it("accepts vibeDescription at exactly 120 characters", () => {
    const exact = "x".repeat(VIBE_DESCRIPTION_MAX_LENGTH);
    const parsed = parsePlaylistCriteriaResponse({
      ...validResponse(),
      vibeDescription: exact,
    });
    expect(parsed?.vibeDescription).toBe(exact);
  });

  it("trims whitespace from vibeName and vibeDescription", () => {
    const parsed = parsePlaylistCriteriaResponse({
      ...validResponse(),
      vibeName: "  Summer Shotgun  ",
      vibeDescription: "  Windows-down anthems.  ",
    });
    expect(parsed?.vibeName).toBe("Summer Shotgun");
    expect(parsed?.vibeDescription).toBe("Windows-down anthems.");
  });

  it("trims whitespace from genre / tag entries", () => {
    const parsed = parsePlaylistCriteriaResponse({
      ...validResponse(),
      target: {
        ...validResponse().target,
        genres: ["  pop  ", "hip-hop"],
        tags: [" summer ", "driving"],
      },
    });
    expect(parsed?.target.genres).toEqual(["pop", "hip-hop"]);
    expect(parsed?.target.tags).toEqual(["summer", "driving"]);
  });
});
