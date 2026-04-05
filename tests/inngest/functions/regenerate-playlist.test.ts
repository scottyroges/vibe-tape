import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindByIdWithRecipe,
  mockUpdateTracks,
  mockSetStatus,
  mockSetFailed,
  mockFindAllWithScoringFieldsByUser,
  mockFindByIds,
  mockGetValidToken,
  mockReplacePlaylistTracks,
} = vi.hoisted(() => ({
  mockFindByIdWithRecipe: vi.fn(),
  mockUpdateTracks: vi.fn(),
  mockSetStatus: vi.fn(),
  mockSetFailed: vi.fn(),
  mockFindAllWithScoringFieldsByUser: vi.fn(),
  mockFindByIds: vi.fn(),
  mockGetValidToken: vi.fn(),
  mockReplacePlaylistTracks: vi.fn(),
}));

vi.mock("@/repositories/playlist.repository", () => ({
  playlistRepository: {
    findByIdWithRecipe: mockFindByIdWithRecipe,
    updateTracks: mockUpdateTracks,
    setStatus: mockSetStatus,
    setFailed: mockSetFailed,
  },
}));

vi.mock("@/repositories/track.repository", () => ({
  trackRepository: {
    findAllWithScoringFieldsByUser: mockFindAllWithScoringFieldsByUser,
    findByIds: mockFindByIds,
  },
}));

vi.mock("@/lib/spotify-token", () => ({
  getValidToken: mockGetValidToken,
}));

vi.mock("@/lib/spotify", () => ({
  replacePlaylistTracks: mockReplacePlaylistTracks,
}));

// `regenerate-playlist` imports `computePerArtistCap` from
// `generate-playlist`, which imports `@/lib/claude` at module top level.
// Stub the Anthropic client so the SDK doesn't explode in tests.
vi.mock("@/lib/claude", () => ({
  generatePlaylistCriteria: vi.fn(),
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

import { regeneratePlaylist } from "@/inngest/functions/regenerate-playlist";

type MockStep = { run: ReturnType<typeof vi.fn> };

function createMockStep(): MockStep {
  return {
    run: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
  };
}

function makeLibraryRow(id: string, primaryArtistId = "a1") {
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
    primaryArtistId,
    durationMs: 200_000,
  };
}

const RECIPE_TARGET = {
  mood: "uplifting" as const,
  energy: "high" as const,
  danceability: "high" as const,
  genres: ["pop"],
  tags: ["summer"],
};

function makePlaylistRow(
  overrides: {
    status?: "PENDING" | "SAVED";
    spotifyPlaylistId?: string | null;
    generatedTrackIds?: string[];
  } = {}
) {
  return {
    id: "pl-1",
    userId: "u1",
    spotifyPlaylistId: overrides.spotifyPlaylistId ?? null,
    vibeName: "Night Drive",
    vibeDescription: "desc",
    seedSongIds: ["s1", "s2", "s3"],
    status: overrides.status ?? "PENDING",
    generatedTrackIds: overrides.generatedTrackIds ?? ["s1", "s2", "s3", "lib1"],
    targetDurationMinutes: 60,
    userIntent: null,
    claudeTarget: RECIPE_TARGET,
    mathTarget: RECIPE_TARGET,
    errorMessage: null,
    artImageUrl: null,
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("regeneratePlaylist", () => {
  const { handler, opts } = regeneratePlaylist as unknown as {
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
    mockFindByIdWithRecipe.mockResolvedValue(makePlaylistRow());
    mockFindAllWithScoringFieldsByUser.mockResolvedValue([
      makeLibraryRow("s1", "a1"),
      makeLibraryRow("s2", "a2"),
      makeLibraryRow("s3", "a3"),
      makeLibraryRow("lib1", "a4"),
      makeLibraryRow("lib2", "a5"),
      makeLibraryRow("lib3", "a6"),
    ]);
    mockUpdateTracks.mockResolvedValue(undefined);
    mockSetStatus.mockResolvedValue(undefined);
    mockSetFailed.mockResolvedValue(undefined);
    mockGetValidToken.mockResolvedValue({ accessToken: "tok" });
    mockFindByIds.mockResolvedValue([]);
    mockReplacePlaylistTracks.mockResolvedValue(undefined);
  });

  it("registers with the right id + trigger + concurrency key", () => {
    expect(opts.id).toBe("regenerate-playlist");
    expect(opts.triggers).toEqual([
      { event: "playlist/regenerate.requested" },
    ]);
    expect(opts.concurrency).toEqual([
      { key: "event.data.playlistId", limit: 1 },
    ]);
  });

  it("re-scores library, updates tracks, and restores PENDING when prior was PENDING", async () => {
    const step = createMockStep();
    await handler({
      event: {
        data: { playlistId: "pl-1", priorStatus: "PENDING" },
      },
      step,
    });

    expect(mockUpdateTracks).toHaveBeenCalledTimes(1);
    const [id, trackIds] = mockUpdateTracks.mock.calls[0]!;
    expect(id).toBe("pl-1");
    // Seeds remain hard-guaranteed in the re-roll.
    for (const seed of ["s1", "s2", "s3"]) {
      expect(trackIds).toContain(seed);
    }
    expect(mockSetStatus).toHaveBeenCalledWith("pl-1", "PENDING");
    // Did NOT touch Spotify.
    expect(mockReplacePlaylistTracks).not.toHaveBeenCalled();
  });

  it("replaces live Spotify tracks + restores SAVED when prior was SAVED", async () => {
    mockFindByIdWithRecipe.mockResolvedValue(
      makePlaylistRow({ status: "SAVED", spotifyPlaylistId: "sp-pl-xyz" })
    );
    mockFindByIds.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({
        id,
        spotifyId: `sp-${id}`,
        name: id,
        album: "",
        albumArtUrl: null,
        vibeMood: null,
        vibeEnergy: null,
        vibeDanceability: null,
        vibeGenres: [],
        vibeTags: [],
        vibeVersion: 1,
        vibeUpdatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );

    const step = createMockStep();
    await handler({
      event: {
        data: { playlistId: "pl-1", priorStatus: "SAVED" },
      },
      step,
    });

    expect(mockReplacePlaylistTracks).toHaveBeenCalledTimes(1);
    const [token, spotifyPlaylistId, uris] =
      mockReplacePlaylistTracks.mock.calls[0]!;
    expect(token).toBe("tok");
    expect(spotifyPlaylistId).toBe("sp-pl-xyz");
    expect(uris[0]).toMatch(/^spotify:track:sp-/);
    expect(mockSetStatus).toHaveBeenCalledWith("pl-1", "SAVED");
  });

  it("throws when the playlist is missing its recipe targets", async () => {
    mockFindByIdWithRecipe.mockResolvedValue({
      ...makePlaylistRow(),
      claudeTarget: null,
      mathTarget: null,
    });

    const step = createMockStep();
    await expect(
      handler({
        event: { data: { playlistId: "pl-1", priorStatus: "PENDING" } },
        step,
      })
    ).rejects.toThrow(/recipe targets/);
    expect(mockUpdateTracks).not.toHaveBeenCalled();
  });

  it("onFailure restores prior PENDING status (does not trap the row in FAILED)", async () => {
    await opts.onFailure({
      event: {
        data: {
          event: { data: { playlistId: "pl-1", priorStatus: "PENDING" } },
        },
      },
    });
    expect(mockSetStatus).toHaveBeenCalledWith("pl-1", "PENDING");
    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  it("onFailure restores prior SAVED status — avoids stripping Spotify actions", async () => {
    await opts.onFailure({
      event: {
        data: {
          event: { data: { playlistId: "pl-1", priorStatus: "SAVED" } },
        },
      },
    });
    expect(mockSetStatus).toHaveBeenCalledWith("pl-1", "SAVED");
    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  it("onFailure falls back to setFailed when the event is missing priorStatus", async () => {
    await opts.onFailure({
      event: { data: { event: { data: { playlistId: "pl-1" } } } },
    });
    expect(mockSetFailed).toHaveBeenCalledWith("pl-1", "regeneration failed");
    expect(mockSetStatus).not.toHaveBeenCalled();
  });
});
