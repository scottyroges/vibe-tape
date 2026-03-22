import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetValidToken,
  mockFetchLikedSongs,
  mockFetchArtists,
  mockUpsertMany,
  mockTrackFindStale,
  mockTrackUpdateDerivedEra,
  mockTrackSetEnrichmentVersion,
  mockArtistFindStale,
  mockArtistUpdateGenres,
  mockArtistSetEnrichmentVersion,
  mockUpdateSyncStatus,
  mockSetSyncStatus,
} = vi.hoisted(() => ({
  mockGetValidToken: vi.fn(),
  mockFetchLikedSongs: vi.fn(),
  mockFetchArtists: vi.fn(),
  mockUpsertMany: vi.fn(),
  mockTrackFindStale: vi.fn(),
  mockTrackUpdateDerivedEra: vi.fn(),
  mockTrackSetEnrichmentVersion: vi.fn(),
  mockArtistFindStale: vi.fn(),
  mockArtistUpdateGenres: vi.fn(),
  mockArtistSetEnrichmentVersion: vi.fn(),
  mockUpdateSyncStatus: vi.fn(),
  mockSetSyncStatus: vi.fn(),
}));

vi.mock("@/lib/spotify-token", () => ({
  getValidToken: mockGetValidToken,
}));

vi.mock("@/lib/spotify", () => ({
  fetchLikedSongs: mockFetchLikedSongs,
  fetchArtists: mockFetchArtists,
}));

vi.mock("@/lib/enrichment", () => ({
  CURRENT_ENRICHMENT_VERSION: 1,
  deriveEra: (date: string | null) => {
    if (!date) return null;
    const year = parseInt(date.slice(0, 4), 10);
    if (isNaN(year)) return null;
    return `${Math.floor(year / 10) * 10}s`;
  },
}));

vi.mock("@/repositories/track.repository", () => ({
  trackRepository: {
    upsertMany: mockUpsertMany,
    findStale: mockTrackFindStale,
    updateDerivedEra: mockTrackUpdateDerivedEra,
    setEnrichmentVersion: mockTrackSetEnrichmentVersion,
  },
}));

vi.mock("@/repositories/artist.repository", () => ({
  artistRepository: {
    findStale: mockArtistFindStale,
    updateGenres: mockArtistUpdateGenres,
    setEnrichmentVersion: mockArtistSetEnrichmentVersion,
  },
}));

vi.mock("@/repositories/user.repository", () => ({
  userRepository: {
    updateSyncMetrics: mockUpdateSyncStatus,
    setSyncStatus: mockSetSyncStatus,
  },
}));

vi.mock("@/lib/inngest", () => ({
  inngest: {
    createFunction: vi.fn((opts: Record<string, unknown>, handler: (...args: unknown[]) => unknown) => {
      return { handler, opts };
    }),
  },
}));

import { syncLibrary } from "@/inngest/functions/sync-library";

// Helper to simulate Inngest's step.run — just executes the callback immediately
function createMockStep() {
  return {
    run: vi.fn(
      async (_name: string, fn: () => Promise<unknown>) => fn()
    ),
  };
}

function makeSong(overrides: { spotifyId?: string; name?: string; spotifyReleaseDate?: string } = {}) {
  return {
    spotifyId: overrides.spotifyId ?? "sp1",
    name: overrides.name ?? "Song",
    artists: [{ spotifyId: "a1", name: "Artist" }],
    album: "Album",
    albumArtUrl: null,
    spotifyPopularity: 75,
    spotifyDurationMs: 210000,
    spotifyReleaseDate: overrides.spotifyReleaseDate ?? "2024-01-01",
    likedAt: "2024-01-01T00:00:00.000Z",
  };
}

function setupDefaultMocks() {
  mockGetValidToken.mockResolvedValue({ accessToken: "tok-123" });
  mockFetchLikedSongs.mockResolvedValue({
    songs: [makeSong()],
    nextUrl: null,
  });
  mockUpsertMany.mockResolvedValue(undefined);
  mockUpdateSyncStatus.mockResolvedValue(undefined);
  // Enrichment defaults: no stale entities
  mockArtistFindStale.mockResolvedValue([]);
  mockArtistUpdateGenres.mockResolvedValue(undefined);
  mockArtistSetEnrichmentVersion.mockResolvedValue(0);
  mockTrackFindStale.mockResolvedValue([]);
  mockTrackUpdateDerivedEra.mockResolvedValue(undefined);
  mockTrackSetEnrichmentVersion.mockResolvedValue(0);
  mockFetchArtists.mockResolvedValue(new Map());
}

describe("syncLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetSyncStatus.mockResolvedValue(undefined);
    setupDefaultMocks();
  });

  const { handler, opts } = syncLibrary as unknown as {
    handler: (...args: unknown[]) => unknown;
    opts: { onFailure: (...args: unknown[]) => Promise<void> };
  };

  it("runs all steps including enrichment in correct order", async () => {
    const step = createMockStep();
    const result = await handler({ event: { data: { userId: "user-1" } }, step });

    expect(result).toEqual({ synced: 1 });

    const stepNames = step.run.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(stepNames).toEqual([
      "set-syncing",
      "get-token",
      "fetch-songs-0",
      "upsert-data-0",
      "enrich-artists/spotify-genres-0",
      "enrich-artists/set-version-0",
      "enrich-tracks/era-0",
      "enrich-tracks/set-version-0",
      "update-status",
    ]);
  });

  it("fetches and upserts multiple chunks when nextUrl is returned", async () => {
    mockFetchLikedSongs
      .mockResolvedValueOnce({
        songs: [makeSong({ spotifyId: "sp1" })],
        nextUrl: "https://api.spotify.com/v1/me/tracks?offset=2000",
      })
      .mockResolvedValueOnce({
        songs: [makeSong({ spotifyId: "sp2" })],
        nextUrl: null,
      });

    const step = createMockStep();
    const result = await handler({
      event: { data: { userId: "user-1" } },
      step,
    });

    expect(result).toEqual({ synced: 2 });
    expect(mockFetchLikedSongs).toHaveBeenCalledTimes(2);
    expect(mockUpsertMany).toHaveBeenCalledTimes(2);
  });

  it("enriches artists with Spotify genres", async () => {
    mockArtistFindStale.mockResolvedValueOnce([
      { id: "a1", spotifyId: "sa1", name: "Artist 1", enrichmentVersion: 0 },
      { id: "a2", spotifyId: "sa2", name: "Artist 2", enrichmentVersion: 0 },
    ]);

    mockFetchArtists.mockResolvedValueOnce(
      new Map([
        ["sa1", ["pop", "rock"]],
        ["sa2", ["jazz"]],
      ])
    );

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(mockFetchArtists).toHaveBeenCalledWith("tok-123", ["sa1", "sa2"]);
    expect(mockArtistUpdateGenres).toHaveBeenCalledWith([
      { id: "a1", spotifyGenres: ["pop", "rock"] },
      { id: "a2", spotifyGenres: ["jazz"] },
    ]);
  });

  it("chunks artist genre enrichment", async () => {
    // First call: 500 artists (full chunk), second call: 0 (done)
    const staleArtists = Array.from({ length: 500 }, (_, i) => ({
      id: `a${i}`,
      spotifyId: `sa${i}`,
      name: `Artist ${i}`,
      enrichmentVersion: 0,
    }));
    mockArtistFindStale
      .mockResolvedValueOnce(staleArtists)
      .mockResolvedValueOnce([]);

    mockFetchArtists.mockResolvedValue(new Map());

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    const stepNames = step.run.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(stepNames).toContain("enrich-artists/spotify-genres-0");
    expect(stepNames).toContain("enrich-artists/spotify-genres-500");
  });

  it("derives era from spotifyReleaseDate", async () => {
    mockTrackFindStale.mockResolvedValueOnce([
      { id: "t1", spotifyReleaseDate: "2023-06-15", enrichmentVersion: 0 },
      { id: "t2", spotifyReleaseDate: "1995-01-01", enrichmentVersion: 0 },
    ]);

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(mockTrackUpdateDerivedEra).toHaveBeenCalledWith([
      { id: "t1", derivedEra: "2020s" },
      { id: "t2", derivedEra: "1990s" },
    ]);
  });

  it("skips tracks with null release date in era derivation", async () => {
    mockTrackFindStale.mockResolvedValueOnce([
      { id: "t1", spotifyReleaseDate: "2023-06-15", enrichmentVersion: 0 },
      { id: "t2", spotifyReleaseDate: null, enrichmentVersion: 0 },
    ]);

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(mockTrackUpdateDerivedEra).toHaveBeenCalledWith([
      { id: "t1", derivedEra: "2020s" },
    ]);
  });

  it("throws without catching when a step fails", async () => {
    mockGetValidToken.mockRejectedValue(new Error("token error"));

    const step = createMockStep();

    await expect(
      handler({ event: { data: { userId: "user-1" } }, step })
    ).rejects.toThrow("token error");

    expect(mockSetSyncStatus).toHaveBeenCalledWith("user-1", "SYNCING");
    expect(mockSetSyncStatus).not.toHaveBeenCalledWith("user-1", "FAILED");
  });

  it("onFailure sets status to FAILED", async () => {
    const failureEvent = { data: { event: { data: { userId: "user-1" } } } };

    await opts.onFailure({ event: failureEvent });

    expect(mockSetSyncStatus).toHaveBeenCalledWith("user-1", "FAILED");
  });

  it("rehydrates Date fields before upserting", async () => {
    const step = createMockStep();
    await handler({ event: { data: { userId: "u1" } }, step });

    const upsertedSongs = mockUpsertMany.mock.calls[0]![1];
    expect(upsertedSongs[0].likedAt).toBeInstanceOf(Date);
    expect(upsertedSongs[0].likedAt.toISOString()).toBe(
      "2024-01-01T00:00:00.000Z"
    );
  });
});
