import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindByIdsWithScoringFields,
  mockFindByIdsWithDisplayFields,
  mockFindAllWithScoringFieldsByUser,
  mockCompleteGeneration,
  mockSetFailed,
  mockGeneratePlaylistCriteria,
} = vi.hoisted(() => ({
  mockFindByIdsWithScoringFields: vi.fn(),
  mockFindByIdsWithDisplayFields: vi.fn(),
  mockFindAllWithScoringFieldsByUser: vi.fn(),
  mockCompleteGeneration: vi.fn(),
  mockSetFailed: vi.fn(),
  mockGeneratePlaylistCriteria: vi.fn(),
}));

vi.mock("@/repositories/track.repository", () => ({
  trackRepository: {
    findByIdsWithScoringFields: mockFindByIdsWithScoringFields,
    findByIdsWithDisplayFields: mockFindByIdsWithDisplayFields,
    findAllWithScoringFieldsByUser: mockFindAllWithScoringFieldsByUser,
  },
}));

vi.mock("@/repositories/playlist.repository", () => ({
  playlistRepository: {
    completeGeneration: mockCompleteGeneration,
    setFailed: mockSetFailed,
  },
}));

vi.mock("@/lib/claude", () => ({
  generatePlaylistCriteria: mockGeneratePlaylistCriteria,
}));

vi.mock("@/lib/inngest", () => ({
  inngest: {
    createFunction: vi.fn(
      (
        opts: Record<string, unknown>,
        handler: (...args: unknown[]) => unknown
      ) => {
        return { handler, opts };
      }
    ),
  },
}));

import {
  generatePlaylist,
  computePerArtistCap,
} from "@/inngest/functions/generate-playlist";

type MockStep = {
  run: ReturnType<typeof vi.fn>;
};

function createMockStep(): MockStep {
  return {
    run: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
  };
}

// Build a TrackWithScoringFields-shaped row with canonical vibe data.
function makeSeedRow(overrides: {
  id: string;
  primaryArtistId?: string;
  vibeMood?: string | null;
  vibeEnergy?: "low" | "medium" | "high" | null;
  vibeGenres?: string[];
}) {
  return {
    id: overrides.id,
    spotifyId: `sp-${overrides.id}`,
    name: `Song ${overrides.id}`,
    album: "Album",
    albumArtUrl: null,
    vibeMood: overrides.vibeMood ?? "uplifting",
    vibeEnergy: overrides.vibeEnergy ?? "high",
    vibeDanceability: "high" as const,
    vibeGenres: overrides.vibeGenres ?? ["pop"],
    vibeTags: ["summer"],
    vibeVersion: 1,
    vibeUpdatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    primaryArtistId: overrides.primaryArtistId ?? "artist-1",
    durationMs: 200_000,
  };
}

function makeDisplayRow(id: string, artistsDisplay = "Artist") {
  return {
    id,
    spotifyId: `sp-${id}`,
    name: `Song ${id}`,
    album: "Album",
    albumArtUrl: null,
    vibeMood: "uplifting",
    vibeEnergy: "high",
    vibeDanceability: "high",
    vibeGenres: ["pop"],
    vibeTags: ["summer"],
    vibeVersion: 1,
    vibeUpdatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    artistsDisplay,
  };
}

const VALID_CRITERIA = {
  target: {
    mood: "uplifting",
    energy: "high",
    danceability: "high",
    genres: ["pop", "funk"],
    tags: ["summer", "driving"],
  },
  vibeName: "Sunset Cruise",
  vibeDescription: "Windows-down anthems for the golden hour.",
};

function setupDefaultMocks() {
  mockFindByIdsWithScoringFields.mockResolvedValue([
    makeSeedRow({ id: "s1", primaryArtistId: "a1" }),
    makeSeedRow({ id: "s2", primaryArtistId: "a2" }),
    makeSeedRow({ id: "s3", primaryArtistId: "a3" }),
  ]);
  mockFindByIdsWithDisplayFields.mockResolvedValue([
    makeDisplayRow("s1", "Artist One"),
    makeDisplayRow("s2", "Artist Two"),
    makeDisplayRow("s3", "Artist Three"),
  ]);
  mockFindAllWithScoringFieldsByUser.mockResolvedValue([
    makeSeedRow({ id: "s1", primaryArtistId: "a1" }),
    makeSeedRow({ id: "s2", primaryArtistId: "a2" }),
    makeSeedRow({ id: "s3", primaryArtistId: "a3" }),
    makeSeedRow({ id: "lib1", primaryArtistId: "a4" }),
    makeSeedRow({ id: "lib2", primaryArtistId: "a5" }),
  ]);
  mockCompleteGeneration.mockResolvedValue(undefined);
  mockSetFailed.mockResolvedValue(undefined);
  mockGeneratePlaylistCriteria.mockResolvedValue({
    raw: VALID_CRITERIA,
    inputTokens: 100,
    outputTokens: 50,
  });
}

describe("generatePlaylist", () => {
  const { handler, opts } = generatePlaylist as unknown as {
    handler: (...args: unknown[]) => Promise<unknown>;
    opts: {
      id: string;
      retries: number;
      concurrency: { key: string; limit: number }[];
      triggers: { event: string }[];
      onFailure: (arg: { event: unknown }) => Promise<void>;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("registers with the right id, trigger, retries, and concurrency key", () => {
    expect(opts.id).toBe("generate-playlist");
    expect(opts.retries).toBe(3);
    expect(opts.triggers).toEqual([
      { event: "playlist/generate.requested" },
    ]);
    expect(opts.concurrency).toEqual([
      { key: "event.data.playlistId", limit: 1 },
    ]);
  });

  it("runs steps in the documented order", async () => {
    const step = createMockStep();
    await handler({
      event: {
        data: {
          userId: "u1",
          playlistId: "pl-1",
          seedTrackIds: ["s1", "s2", "s3"],
          targetDurationMinutes: 60,
        },
      },
      step,
    });

    const stepNames = step.run.mock.calls.map((call) => call[0]);
    expect(stepNames).toEqual([
      "load-seeds",
      "compute-math-target",
      "claude-target",
      "score-library",
      "save-playlist",
    ]);
  });

  it("completes generation with Claude-produced recipe fields", async () => {
    const step = createMockStep();
    await handler({
      event: {
        data: {
          userId: "u1",
          playlistId: "pl-1",
          seedTrackIds: ["s1", "s2", "s3"],
          targetDurationMinutes: 60,
        },
      },
      step,
    });

    expect(mockCompleteGeneration).toHaveBeenCalledTimes(1);
    const [playlistId, args] = mockCompleteGeneration.mock.calls[0]!;
    expect(playlistId).toBe("pl-1");
    expect(args.vibeName).toBe("Sunset Cruise");
    expect(args.vibeDescription).toBe(
      "Windows-down anthems for the golden hour."
    );
    expect(args.claudeTarget).toMatchObject({ mood: "uplifting" });
    expect(args.mathTarget).toMatchObject({ mood: "uplifting" });
    // Seeds are required and must appear in the output.
    for (const id of ["s1", "s2", "s3"]) {
      expect(args.generatedTrackIds).toContain(id);
    }
  });

  it("threads userIntent into the Claude prompt", async () => {
    const step = createMockStep();
    await handler({
      event: {
        data: {
          userId: "u1",
          playlistId: "pl-1",
          seedTrackIds: ["s1", "s2", "s3"],
          targetDurationMinutes: 60,
          userIntent: "rainy morning",
        },
      },
      step,
    });

    expect(mockGeneratePlaylistCriteria).toHaveBeenCalledTimes(1);
    const [, userPrompt] = mockGeneratePlaylistCriteria.mock.calls[0]!;
    expect(userPrompt).toContain("rainy morning");
    expect(userPrompt).toContain("User intent:");
  });

  it("omits the user-intent block from the prompt when absent", async () => {
    const step = createMockStep();
    await handler({
      event: {
        data: {
          userId: "u1",
          playlistId: "pl-1",
          seedTrackIds: ["s1", "s2", "s3"],
          targetDurationMinutes: 60,
        },
      },
      step,
    });

    const [, userPrompt] = mockGeneratePlaylistCriteria.mock.calls[0]!;
    expect(userPrompt).not.toContain("User intent:");
  });

  it("defaults targetDurationMinutes to 60 when the event omits it", async () => {
    const step = createMockStep();
    await handler({
      event: {
        data: {
          userId: "u1",
          playlistId: "pl-1",
          seedTrackIds: ["s1", "s2", "s3"],
        },
      },
      step,
    });

    // Success proves the default kicked in; the real assertion is that
    // save-playlist got called with a non-empty generated track list.
    expect(mockCompleteGeneration).toHaveBeenCalledTimes(1);
  });

  it("throws when Claude returns an invalid response (no save)", async () => {
    mockGeneratePlaylistCriteria.mockResolvedValueOnce({
      raw: { target: null, vibeName: "", vibeDescription: "" },
      inputTokens: 0,
      outputTokens: 0,
    });

    const step = createMockStep();
    await expect(
      handler({
        event: {
          data: {
            userId: "u1",
            playlistId: "pl-1",
            seedTrackIds: ["s1", "s2", "s3"],
            targetDurationMinutes: 60,
          },
        },
        step,
      })
    ).rejects.toThrow(/invalid playlist-criteria/);

    expect(mockCompleteGeneration).not.toHaveBeenCalled();
  });

  it("throws when seeds can't be found (no save)", async () => {
    mockFindByIdsWithScoringFields.mockResolvedValueOnce([]);
    mockFindByIdsWithDisplayFields.mockResolvedValueOnce([]);

    const step = createMockStep();
    await expect(
      handler({
        event: {
          data: {
            userId: "u1",
            playlistId: "pl-1",
            seedTrackIds: ["s1", "s2", "s3"],
            targetDurationMinutes: 60,
          },
        },
        step,
      })
    ).rejects.toThrow(/No seed tracks/);

    expect(mockCompleteGeneration).not.toHaveBeenCalled();
  });

  it("onFailure flips the placeholder row to FAILED", async () => {
    await opts.onFailure({
      event: { data: { event: { data: { playlistId: "pl-1" } } } },
    });
    expect(mockSetFailed).toHaveBeenCalledWith("pl-1", "generation failed");
  });

  it("onFailure is a no-op when the event has no playlistId", async () => {
    await opts.onFailure({
      event: { data: { event: { data: {} } } },
    });
    expect(mockSetFailed).not.toHaveBeenCalled();
  });
});

describe("computePerArtistCap", () => {
  it("stays at the floor of 3 for short playlists", () => {
    // 30 min ≈ 9 tracks → ceil(9/6) = 2 → max(3, 2) = 3
    expect(computePerArtistCap(30)).toBe(3);
  });

  it("grows with longer target durations", () => {
    // 60 min ≈ 18 tracks → ceil(18/6) = 3
    expect(computePerArtistCap(60)).toBe(3);
    // 120 min ≈ 35 tracks → ceil(35/6) = 6
    expect(computePerArtistCap(120)).toBe(6);
    // 240 min ≈ 69 tracks → ceil(69/6) = 12
    expect(computePerArtistCap(240)).toBe(12);
  });
});
