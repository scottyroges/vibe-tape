import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindByIdWithRecipe,
  mockAppendTracks,
  mockSetStatus,
  mockSetFailed,
  mockFindAllWithScoringFieldsByUser,
  mockFindByIdsWithScoringFields,
  mockFindByIds,
  mockGetValidToken,
  mockAddTracksToPlaylist,
} = vi.hoisted(() => ({
  mockFindByIdWithRecipe: vi.fn(),
  mockAppendTracks: vi.fn(),
  mockSetStatus: vi.fn(),
  mockSetFailed: vi.fn(),
  mockFindAllWithScoringFieldsByUser: vi.fn(),
  mockFindByIdsWithScoringFields: vi.fn(),
  mockFindByIds: vi.fn(),
  mockGetValidToken: vi.fn(),
  mockAddTracksToPlaylist: vi.fn(),
}));

vi.mock("@/repositories/playlist.repository", () => ({
  playlistRepository: {
    findByIdWithRecipe: mockFindByIdWithRecipe,
    appendTracks: mockAppendTracks,
    setStatus: mockSetStatus,
    setFailed: mockSetFailed,
  },
}));

vi.mock("@/repositories/track.repository", () => ({
  trackRepository: {
    findAllWithScoringFieldsByUser: mockFindAllWithScoringFieldsByUser,
    findByIdsWithScoringFields: mockFindByIdsWithScoringFields,
    findByIds: mockFindByIds,
  },
}));

vi.mock("@/lib/spotify-token", () => ({
  getValidToken: mockGetValidToken,
}));

vi.mock("@/lib/spotify", () => ({
  addTracksToPlaylist: mockAddTracksToPlaylist,
}));

// `top-up-playlist` imports `computePerArtistCap` from `generate-playlist`,
// which imports `@/lib/claude` at module top level. Stub the Anthropic
// client so the SDK doesn't explode in tests.
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

import {
  topUpPlaylist,
  computeTopUpExtraMs,
} from "@/inngest/functions/top-up-playlist";

type MockStep = { run: ReturnType<typeof vi.fn> };

function createMockStep(): MockStep {
  return {
    run: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
  };
}

function makeRow(id: string, primaryArtistId = "a1", durationMs = 200_000) {
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
    durationMs,
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
    targetDurationMinutes?: number;
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
    generatedTrackIds:
      overrides.generatedTrackIds ?? ["s1", "s2", "s3", "e1"],
    targetDurationMinutes: overrides.targetDurationMinutes ?? 60,
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

describe("computeTopUpExtraMs", () => {
  it("fills to target when the playlist is below target", () => {
    // 60min target, currently 40min → +20min.
    expect(computeTopUpExtraMs(60, 40 * 60_000)).toBe(20 * 60_000);
  });

  it("adds 25% of the original target when at target (60min → +15min)", () => {
    expect(computeTopUpExtraMs(60, 60 * 60_000)).toBe(15 * 60_000);
  });

  it("enforces the 10-minute floor for short playlists (30min → +10min)", () => {
    expect(computeTopUpExtraMs(30, 30 * 60_000)).toBe(10 * 60_000);
  });

  it("scales up for long playlists (240min → +60min)", () => {
    expect(computeTopUpExtraMs(240, 240 * 60_000)).toBe(60 * 60_000);
  });

  it("never adds a trivial sliver when the deficit is smaller than the increment", () => {
    // 60min target, 58min existing → deficit 2min, increment 15min.
    // Should choose the increment so the user gets a meaningful top-up.
    expect(computeTopUpExtraMs(60, 58 * 60_000)).toBe(15 * 60_000);
  });
});

describe("topUpPlaylist", () => {
  const { handler, opts } = topUpPlaylist as unknown as {
    handler: (...args: unknown[]) => Promise<unknown>;
    opts: {
      id: string;
      triggers: { event: string }[];
      concurrency: { key: string; limit: number }[];
      onFailure: (arg: { event: unknown }) => Promise<void>;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindByIdWithRecipe.mockResolvedValue(makePlaylistRow());
    mockFindByIdsWithScoringFields.mockResolvedValue([
      makeRow("s1", "a1"),
      makeRow("s2", "a2"),
      makeRow("s3", "a3"),
      makeRow("e1", "a4"),
    ]);
    // Library includes existing + several fresh tracks. Existing IDs
    // should get dropped by excludeIds.
    mockFindAllWithScoringFieldsByUser.mockResolvedValue([
      makeRow("s1", "a1"),
      makeRow("s2", "a2"),
      makeRow("s3", "a3"),
      makeRow("e1", "a4"),
      makeRow("new1", "a5"),
      makeRow("new2", "a6"),
      makeRow("new3", "a7"),
      makeRow("new4", "a8"),
    ]);
    mockAppendTracks.mockResolvedValue(undefined);
    mockSetStatus.mockResolvedValue(undefined);
    mockSetFailed.mockResolvedValue(undefined);
    mockGetValidToken.mockResolvedValue({ accessToken: "tok" });
    mockFindByIds.mockResolvedValue([]);
    mockAddTracksToPlaylist.mockResolvedValue(undefined);
  });

  it("registers with the right id + trigger + concurrency key", () => {
    expect(opts.id).toBe("top-up-playlist");
    expect(opts.triggers).toEqual([{ event: "playlist/top-up.requested" }]);
    expect(opts.concurrency).toEqual([
      { key: "event.data.playlistId", limit: 1 },
    ]);
  });

  it("appends new tracks only — never touches existing ids", async () => {
    const step = createMockStep();
    await handler({
      event: { data: { playlistId: "pl-1", priorStatus: "PENDING" } },
      step,
    });

    expect(mockAppendTracks).toHaveBeenCalledTimes(1);
    const [, newIds] = mockAppendTracks.mock.calls[0]!;
    // None of the existing ids should appear in the additions.
    for (const existing of ["s1", "s2", "s3", "e1"]) {
      expect(newIds).not.toContain(existing);
    }
    // The fresh tracks should be the ones getting added.
    for (const id of newIds) {
      expect(id).toMatch(/^new/);
    }
  });

  it("restores PENDING when prior was PENDING and skips Spotify", async () => {
    const step = createMockStep();
    await handler({
      event: { data: { playlistId: "pl-1", priorStatus: "PENDING" } },
      step,
    });
    expect(mockSetStatus).toHaveBeenCalledWith("pl-1", "PENDING");
    expect(mockAddTracksToPlaylist).not.toHaveBeenCalled();
  });

  it("appends to Spotify and restores SAVED when prior was SAVED", async () => {
    mockFindByIdWithRecipe.mockResolvedValue(
      makePlaylistRow({
        status: "SAVED",
        spotifyPlaylistId: "sp-pl-xyz",
      })
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
      event: { data: { playlistId: "pl-1", priorStatus: "SAVED" } },
      step,
    });

    expect(mockAddTracksToPlaylist).toHaveBeenCalledTimes(1);
    const [token, spotifyPlaylistId, uris] =
      mockAddTracksToPlaylist.mock.calls[0]!;
    expect(token).toBe("tok");
    expect(spotifyPlaylistId).toBe("sp-pl-xyz");
    expect(uris.length).toBeGreaterThan(0);
    for (const uri of uris) expect(uri).toMatch(/^spotify:track:sp-new/);
    expect(mockSetStatus).toHaveBeenCalledWith("pl-1", "SAVED");
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
    expect(mockSetFailed).toHaveBeenCalledWith("pl-1", "top-up failed");
    expect(mockSetStatus).not.toHaveBeenCalled();
  });
});
