import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSend,
  mockFindOwnedTrackIds,
  mockFindByIdsWithDisplayFields,
  mockCreatePlaceholder,
  mockFindById,
  mockFindByIdWithTracks,
  mockMarkSaved,
  mockDeletePlaylist,
  mockSetStatus,
  mockGetValidToken,
  mockCreateSpotifyPlaylist,
  mockAddTracksToPlaylist,
} = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue(undefined),
  mockFindOwnedTrackIds: vi.fn(),
  mockFindByIdsWithDisplayFields: vi.fn(),
  mockCreatePlaceholder: vi.fn(),
  mockFindById: vi.fn(),
  mockFindByIdWithTracks: vi.fn(),
  mockMarkSaved: vi.fn(),
  mockDeletePlaylist: vi.fn(),
  mockSetStatus: vi.fn(),
  mockGetValidToken: vi.fn(),
  mockCreateSpotifyPlaylist: vi.fn(),
  mockAddTracksToPlaylist: vi.fn(),
}));

vi.mock("@/lib/inngest", () => ({
  inngest: { send: mockSend },
}));

vi.mock("@/repositories/track.repository", () => ({
  trackRepository: {
    findOwnedTrackIds: mockFindOwnedTrackIds,
    findByIdsWithDisplayFields: mockFindByIdsWithDisplayFields,
  },
}));

vi.mock("@/repositories/playlist.repository", () => ({
  playlistRepository: {
    createPlaceholder: mockCreatePlaceholder,
    findById: mockFindById,
    findByIdWithTracks: mockFindByIdWithTracks,
    markSaved: mockMarkSaved,
    delete: mockDeletePlaylist,
    setStatus: mockSetStatus,
  },
}));

vi.mock("@/lib/spotify-token", () => ({
  getValidToken: mockGetValidToken,
}));

vi.mock("@/lib/spotify", () => ({
  createPlaylist: mockCreateSpotifyPlaylist,
  addTracksToPlaylist: mockAddTracksToPlaylist,
}));

vi.mock("server-only", () => ({}));

vi.mock("@/server/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { router, createCallerFactory } from "@/server/trpc";
import { playlistRouter } from "@/server/routers/playlist";

const createCaller = createCallerFactory(router({ playlist: playlistRouter }));

function authedCaller(userId = "user-1") {
  return createCaller({
    session: { user: { id: userId } } as never,
    userId,
  });
}

const SEEDS = ["t1", "t2", "t3"];

describe("playlistRouter.generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindOwnedTrackIds.mockResolvedValue(new Set(SEEDS));
    mockCreatePlaceholder.mockResolvedValue("pl-1");
  });

  it("creates a placeholder and fires the Inngest event on happy path", async () => {
    const caller = authedCaller();
    const result = await caller.playlist.generate({ seedTrackIds: SEEDS });

    expect(result).toEqual({ playlistId: "pl-1" });
    expect(mockFindOwnedTrackIds).toHaveBeenCalledWith("user-1", SEEDS);
    expect(mockCreatePlaceholder).toHaveBeenCalledWith("user-1", {
      seedTrackIds: SEEDS,
      targetDurationMinutes: 60,
      userIntent: null,
    });
    expect(mockSend).toHaveBeenCalledWith({
      name: "playlist/generate.requested",
      data: {
        userId: "user-1",
        playlistId: "pl-1",
        seedTrackIds: SEEDS,
        targetDurationMinutes: 60,
        userIntent: null,
      },
    });
  });

  it("passes through a custom targetDurationMinutes", async () => {
    const caller = authedCaller();
    await caller.playlist.generate({
      seedTrackIds: SEEDS,
      targetDurationMinutes: 90,
    });

    expect(mockCreatePlaceholder).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ targetDurationMinutes: 90 })
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ targetDurationMinutes: 90 }),
      })
    );
  });

  it("threads userIntent through placeholder + event when provided", async () => {
    const caller = authedCaller();
    await caller.playlist.generate({
      seedTrackIds: SEEDS,
      userIntent: "rainy morning",
    });

    expect(mockCreatePlaceholder).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ userIntent: "rainy morning" })
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userIntent: "rainy morning" }),
      })
    );
  });

  it("normalizes whitespace-only userIntent to null", async () => {
    const caller = authedCaller();
    await caller.playlist.generate({
      seedTrackIds: SEEDS,
      userIntent: "   ",
    });

    expect(mockCreatePlaceholder).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ userIntent: null })
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userIntent: null }),
      })
    );
  });

  it("trims userIntent before persisting", async () => {
    const caller = authedCaller();
    await caller.playlist.generate({
      seedTrackIds: SEEDS,
      userIntent: "  late night drive  ",
    });

    expect(mockCreatePlaceholder).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ userIntent: "late night drive" })
    );
  });

  it("rejects userIntent over 280 characters", async () => {
    const caller = authedCaller();
    const tooLong = "a".repeat(281);

    await expect(
      caller.playlist.generate({ seedTrackIds: SEEDS, userIntent: tooLong })
    ).rejects.toThrow();
    expect(mockCreatePlaceholder).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("accepts userIntent at exactly 280 characters", async () => {
    const caller = authedCaller();
    const exact = "a".repeat(280);

    await expect(
      caller.playlist.generate({ seedTrackIds: SEEDS, userIntent: exact })
    ).resolves.toEqual({ playlistId: "pl-1" });
  });

  it("rejects fewer than 3 seeds", async () => {
    const caller = authedCaller();
    mockFindOwnedTrackIds.mockResolvedValue(new Set(["t1", "t2"]));

    await expect(
      caller.playlist.generate({ seedTrackIds: ["t1", "t2"] })
    ).rejects.toThrow();
    expect(mockCreatePlaceholder).not.toHaveBeenCalled();
  });

  it("rejects more than 5 seeds", async () => {
    const caller = authedCaller();
    const tooMany = ["t1", "t2", "t3", "t4", "t5", "t6"];

    await expect(
      caller.playlist.generate({ seedTrackIds: tooMany })
    ).rejects.toThrow();
    expect(mockCreatePlaceholder).not.toHaveBeenCalled();
  });

  it("rejects targetDurationMinutes below 15", async () => {
    const caller = authedCaller();

    await expect(
      caller.playlist.generate({
        seedTrackIds: SEEDS,
        targetDurationMinutes: 10,
      })
    ).rejects.toThrow();
  });

  it("rejects targetDurationMinutes above 240", async () => {
    const caller = authedCaller();

    await expect(
      caller.playlist.generate({
        seedTrackIds: SEEDS,
        targetDurationMinutes: 300,
      })
    ).rejects.toThrow();
  });

  it("rejects seeds the user does not own", async () => {
    mockFindOwnedTrackIds.mockResolvedValue(new Set(["t1", "t2"])); // t3 missing

    const caller = authedCaller();
    await expect(
      caller.playlist.generate({ seedTrackIds: SEEDS })
    ).rejects.toThrow(/t3/);

    expect(mockCreatePlaceholder).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getById / save / discard (PR F)
// ─────────────────────────────────────────────────────────────────────────

function makePlaylist(
  overrides: {
    id?: string;
    userId?: string;
    status?: "GENERATING" | "PENDING" | "SAVED" | "FAILED";
    createdAt?: Date;
    spotifyPlaylistId?: string | null;
    errorMessage?: string | null;
    vibeName?: string;
    vibeDescription?: string | null;
    seedSongIds?: string[];
    generatedTrackIds?: string[];
    tracks?: Array<{
      id: string;
      spotifyId: string;
      name: string;
      album: string;
      albumArtUrl: string | null;
      artistsDisplay: string;
      vibeMood: string | null;
      vibeEnergy: string | null;
      vibeDanceability: string | null;
      vibeGenres: string[];
      vibeTags: string[];
      vibeVersion: number;
      vibeUpdatedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
  } = {}
) {
  return {
    id: overrides.id ?? "pl-1",
    userId: overrides.userId ?? "user-1",
    status: overrides.status ?? "PENDING",
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: new Date(),
    vibeName: overrides.vibeName ?? "Golden Hour",
    vibeDescription:
      overrides.vibeDescription === undefined
        ? "Windows-down anthems."
        : overrides.vibeDescription,
    seedSongIds: overrides.seedSongIds ?? ["s1", "s2", "s3"],
    generatedTrackIds: overrides.generatedTrackIds ?? ["g1", "g2"],
    targetDurationMinutes: 60,
    userIntent: null,
    claudeTarget: null,
    mathTarget: null,
    errorMessage:
      overrides.errorMessage === undefined ? null : overrides.errorMessage,
    spotifyPlaylistId:
      overrides.spotifyPlaylistId === undefined
        ? null
        : overrides.spotifyPlaylistId,
    artImageUrl: null,
    lastSyncedAt: null,
    tracks: overrides.tracks ?? [
      makeTrackRow("g1"),
      makeTrackRow("g2"),
    ],
  };
}

function makeTrackRow(id: string, spotifyId = `sp-${id}`) {
  return {
    id,
    spotifyId,
    name: `Track ${id}`,
    album: "Album",
    albumArtUrl: null,
    artistsDisplay: "Some Artist",
    vibeMood: null,
    vibeEnergy: null,
    vibeDanceability: null,
    vibeGenres: [],
    vibeTags: [],
    vibeVersion: 0,
    vibeUpdatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("playlistRouter.getById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindByIdsWithDisplayFields.mockResolvedValue([]);
  });

  it("returns playlist + resolved generated tracks + seed tracks", async () => {
    mockFindById.mockResolvedValue(
      makePlaylist({
        seedSongIds: ["s1", "s2"],
        generatedTrackIds: ["g1", "g2"],
      })
    );
    mockFindByIdsWithDisplayFields.mockResolvedValue([
      makeTrackRow("g1"),
      makeTrackRow("g2"),
      makeTrackRow("s1"),
      makeTrackRow("s2"),
    ]);

    const caller = authedCaller();
    const result = await caller.playlist.getById({ id: "pl-1" });

    expect(result.id).toBe("pl-1");
    expect(result.tracks.map((t) => t.id)).toEqual(["g1", "g2"]);
    expect(result.seeds.map((t) => t.id)).toEqual(["s1", "s2"]);
  });

  it("fetches display fields once for the union of generated + seed ids", async () => {
    // Overlap case: s1 is both a seed AND in generatedTrackIds (seeds
    // are required tracks at generate time). A naive two-query impl
    // would fetch s1 twice.
    mockFindById.mockResolvedValue(
      makePlaylist({
        seedSongIds: ["s1", "s2"],
        generatedTrackIds: ["s1", "g1"],
      })
    );
    mockFindByIdsWithDisplayFields.mockResolvedValue([
      makeTrackRow("s1"),
      makeTrackRow("s2"),
      makeTrackRow("g1"),
    ]);

    const caller = authedCaller();
    await caller.playlist.getById({ id: "pl-1" });

    expect(mockFindByIdsWithDisplayFields).toHaveBeenCalledTimes(1);
    const idsPassed = mockFindByIdsWithDisplayFields.mock.calls[0]![0];
    // Union of generatedTrackIds + seedSongIds, no duplicates.
    expect(idsPassed.sort()).toEqual(["g1", "s1", "s2"]);
  });

  it("rejects playlists owned by another user with NOT_FOUND", async () => {
    mockFindById.mockResolvedValue(makePlaylist({ userId: "someone-else" }));
    const caller = authedCaller();
    await expect(caller.playlist.getById({ id: "pl-1" })).rejects.toThrow();
  });

  it("flips status to FAILED when the row is stuck GENERATING past the TTL", async () => {
    mockFindById.mockResolvedValue(
      makePlaylist({
        status: "GENERATING",
        createdAt: new Date(Date.now() - 10 * 60_000), // 10 minutes ago
      })
    );

    const caller = authedCaller();
    const result = await caller.playlist.getById({ id: "pl-1" });

    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toBe("Generation timed out");
  });

  it("leaves a fresh GENERATING row alone", async () => {
    mockFindById.mockResolvedValue(
      makePlaylist({ status: "GENERATING", createdAt: new Date() })
    );

    const caller = authedCaller();
    const result = await caller.playlist.getById({ id: "pl-1" });

    expect(result.status).toBe("GENERATING");
  });

  it("preserves an existing errorMessage on a stuck row", async () => {
    mockFindById.mockResolvedValue(
      makePlaylist({
        status: "GENERATING",
        createdAt: new Date(Date.now() - 10 * 60_000),
        errorMessage: "specific cause",
      })
    );

    const caller = authedCaller();
    const result = await caller.playlist.getById({ id: "pl-1" });

    expect(result.errorMessage).toBe("specific cause");
  });

  it("orders seed tracks to match seedSongIds regardless of query order", async () => {
    mockFindById.mockResolvedValue(
      makePlaylist({
        seedSongIds: ["s3", "s1", "s2"],
        generatedTrackIds: [],
      })
    );
    mockFindByIdsWithDisplayFields.mockResolvedValue([
      makeTrackRow("s1"),
      makeTrackRow("s2"),
      makeTrackRow("s3"),
    ]);

    const caller = authedCaller();
    const result = await caller.playlist.getById({ id: "pl-1" });
    expect(result.seeds.map((t) => t.id)).toEqual(["s3", "s1", "s2"]);
  });
});

describe("playlistRouter.save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindByIdWithTracks.mockResolvedValue(
      makePlaylist({ status: "PENDING" })
    );
    mockGetValidToken.mockResolvedValue({ accessToken: "token-123" });
    mockCreateSpotifyPlaylist.mockResolvedValue("sp-pl-xyz");
    mockAddTracksToPlaylist.mockResolvedValue(undefined);
    mockMarkSaved.mockResolvedValue(undefined);
  });

  it("creates Spotify playlist, appends tracks, and markSaved on happy path", async () => {
    const caller = authedCaller();
    const result = await caller.playlist.save({ playlistId: "pl-1" });

    expect(result).toEqual({ spotifyPlaylistId: "sp-pl-xyz" });
    expect(mockCreateSpotifyPlaylist).toHaveBeenCalledWith("token-123", {
      name: "Golden Hour",
      description: "Windows-down anthems.",
      public: false,
    });
    expect(mockAddTracksToPlaylist).toHaveBeenCalledWith(
      "token-123",
      "sp-pl-xyz",
      ["spotify:track:sp-g1", "spotify:track:sp-g2"]
    );
    expect(mockMarkSaved).toHaveBeenCalledWith("pl-1", "sp-pl-xyz");
  });

  it("rejects non-PENDING playlists with BAD_REQUEST", async () => {
    mockFindByIdWithTracks.mockResolvedValue(
      makePlaylist({ status: "SAVED", spotifyPlaylistId: "sp-x" })
    );
    const caller = authedCaller();
    await expect(
      caller.playlist.save({ playlistId: "pl-1" })
    ).rejects.toThrow(/PENDING/);

    expect(mockCreateSpotifyPlaylist).not.toHaveBeenCalled();
    expect(mockMarkSaved).not.toHaveBeenCalled();
  });

  it("rejects playlists owned by another user with NOT_FOUND", async () => {
    mockFindByIdWithTracks.mockResolvedValue(
      makePlaylist({ userId: "someone-else" })
    );
    const caller = authedCaller();
    await expect(
      caller.playlist.save({ playlistId: "pl-1" })
    ).rejects.toThrow();

    expect(mockCreateSpotifyPlaylist).not.toHaveBeenCalled();
  });

  it("throws UNAUTHORIZED when no valid Spotify token", async () => {
    mockGetValidToken.mockResolvedValue(null);
    const caller = authedCaller();
    await expect(
      caller.playlist.save({ playlistId: "pl-1" })
    ).rejects.toThrow(/Spotify/);
    expect(mockCreateSpotifyPlaylist).not.toHaveBeenCalled();
  });

  it("does not call markSaved when addTracksToPlaylist throws (partial failure)", async () => {
    mockAddTracksToPlaylist.mockRejectedValue(new Error("rate limit"));

    const caller = authedCaller();
    await expect(
      caller.playlist.save({ playlistId: "pl-1" })
    ).rejects.toThrow(/rate limit/);

    // createPlaylist DID succeed — the orphan is accepted per plan.
    expect(mockCreateSpotifyPlaylist).toHaveBeenCalled();
    // But the DB row stays at PENDING because markSaved was never called.
    expect(mockMarkSaved).not.toHaveBeenCalled();
  });

  it("uses empty string for description when vibeDescription is null", async () => {
    mockFindByIdWithTracks.mockResolvedValue(
      makePlaylist({ status: "PENDING", vibeDescription: null })
    );
    const caller = authedCaller();
    await caller.playlist.save({ playlistId: "pl-1" });

    expect(mockCreateSpotifyPlaylist).toHaveBeenCalledWith(
      "token-123",
      expect.objectContaining({ description: "" })
    );
  });
});

describe("playlistRouter.discard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeletePlaylist.mockResolvedValue(undefined);
  });

  it("deletes a PENDING playlist", async () => {
    mockFindById.mockResolvedValue(makePlaylist({ status: "PENDING" }));
    const caller = authedCaller();
    const result = await caller.playlist.discard({ playlistId: "pl-1" });

    expect(result).toEqual({ ok: true });
    expect(mockDeletePlaylist).toHaveBeenCalledWith("pl-1");
  });

  it("deletes a FAILED playlist", async () => {
    mockFindById.mockResolvedValue(makePlaylist({ status: "FAILED" }));
    const caller = authedCaller();
    await caller.playlist.discard({ playlistId: "pl-1" });
    expect(mockDeletePlaylist).toHaveBeenCalledWith("pl-1");
  });

  it("deletes a GENERATING playlist", async () => {
    mockFindById.mockResolvedValue(makePlaylist({ status: "GENERATING" }));
    const caller = authedCaller();
    await caller.playlist.discard({ playlistId: "pl-1" });
    expect(mockDeletePlaylist).toHaveBeenCalledWith("pl-1");
  });

  it("rejects a SAVED playlist with BAD_REQUEST", async () => {
    mockFindById.mockResolvedValue(
      makePlaylist({ status: "SAVED", spotifyPlaylistId: "sp-x" })
    );
    const caller = authedCaller();
    await expect(
      caller.playlist.discard({ playlistId: "pl-1" })
    ).rejects.toThrow(/saved/i);
    expect(mockDeletePlaylist).not.toHaveBeenCalled();
  });

  it("rejects a playlist owned by another user with NOT_FOUND", async () => {
    mockFindById.mockResolvedValue(makePlaylist({ userId: "someone-else" }));
    const caller = authedCaller();
    await expect(
      caller.playlist.discard({ playlistId: "pl-1" })
    ).rejects.toThrow();
    expect(mockDeletePlaylist).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the playlist doesn't exist", async () => {
    mockFindById.mockResolvedValue(null);
    const caller = authedCaller();
    await expect(
      caller.playlist.discard({ playlistId: "pl-1" })
    ).rejects.toThrow();
    expect(mockDeletePlaylist).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// regenerate / topUp (PR G)
// ─────────────────────────────────────────────────────────────────────────

describe("playlistRouter.regenerate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetStatus.mockResolvedValue(undefined);
  });

  it("flips PENDING → GENERATING and fires the regenerate event", async () => {
    mockFindById.mockResolvedValue(makePlaylist({ status: "PENDING" }));

    const caller = authedCaller();
    const result = await caller.playlist.regenerate({ playlistId: "pl-1" });

    expect(result).toEqual({ playlistId: "pl-1" });
    expect(mockSetStatus).toHaveBeenCalledWith("pl-1", "GENERATING");
    expect(mockSend).toHaveBeenCalledWith({
      name: "playlist/regenerate.requested",
      data: {
        userId: "user-1",
        playlistId: "pl-1",
        priorStatus: "PENDING",
      },
    });
  });

  it("threads priorStatus=SAVED through when the playlist was saved", async () => {
    mockFindById.mockResolvedValue(
      makePlaylist({ status: "SAVED", spotifyPlaylistId: "sp-x" })
    );

    const caller = authedCaller();
    await caller.playlist.regenerate({ playlistId: "pl-1" });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ priorStatus: "SAVED" }),
      })
    );
  });

  it("rejects a GENERATING playlist with BAD_REQUEST", async () => {
    mockFindById.mockResolvedValue(makePlaylist({ status: "GENERATING" }));
    const caller = authedCaller();
    await expect(
      caller.playlist.regenerate({ playlistId: "pl-1" })
    ).rejects.toThrow(/GENERATING/);
    expect(mockSetStatus).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("rejects a FAILED playlist with BAD_REQUEST", async () => {
    mockFindById.mockResolvedValue(makePlaylist({ status: "FAILED" }));
    const caller = authedCaller();
    await expect(
      caller.playlist.regenerate({ playlistId: "pl-1" })
    ).rejects.toThrow();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("rejects a playlist owned by another user with NOT_FOUND", async () => {
    mockFindById.mockResolvedValue(
      makePlaylist({ userId: "someone-else", status: "PENDING" })
    );
    const caller = authedCaller();
    await expect(
      caller.playlist.regenerate({ playlistId: "pl-1" })
    ).rejects.toThrow();
    expect(mockSetStatus).not.toHaveBeenCalled();
  });
});

describe("playlistRouter.topUp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetStatus.mockResolvedValue(undefined);
  });

  it("flips PENDING → GENERATING and fires the top-up event", async () => {
    mockFindById.mockResolvedValue(makePlaylist({ status: "PENDING" }));

    const caller = authedCaller();
    const result = await caller.playlist.topUp({ playlistId: "pl-1" });

    expect(result).toEqual({ playlistId: "pl-1" });
    expect(mockSetStatus).toHaveBeenCalledWith("pl-1", "GENERATING");
    expect(mockSend).toHaveBeenCalledWith({
      name: "playlist/top-up.requested",
      data: {
        userId: "user-1",
        playlistId: "pl-1",
        priorStatus: "PENDING",
      },
    });
  });

  it("threads priorStatus=SAVED through when the playlist was saved", async () => {
    mockFindById.mockResolvedValue(
      makePlaylist({ status: "SAVED", spotifyPlaylistId: "sp-x" })
    );
    const caller = authedCaller();
    await caller.playlist.topUp({ playlistId: "pl-1" });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ priorStatus: "SAVED" }),
      })
    );
  });

  it("rejects a GENERATING playlist with BAD_REQUEST", async () => {
    mockFindById.mockResolvedValue(makePlaylist({ status: "GENERATING" }));
    const caller = authedCaller();
    await expect(
      caller.playlist.topUp({ playlistId: "pl-1" })
    ).rejects.toThrow();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("rejects a FAILED playlist with BAD_REQUEST", async () => {
    mockFindById.mockResolvedValue(makePlaylist({ status: "FAILED" }));
    const caller = authedCaller();
    await expect(
      caller.playlist.topUp({ playlistId: "pl-1" })
    ).rejects.toThrow();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
