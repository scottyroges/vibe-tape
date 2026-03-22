import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetValidToken,
  mockFetchLikedSongs,
  mockFetchArtists,
  mockUpsertMany,
  mockTrackFindStale,
  mockTrackFindStaleWithArtists,
  mockTrackFindStaleWithPrimaryArtist,
  mockTrackUpdateDerivedEra,
  mockTrackUpdateClaudeClassification,
  mockTrackUpdateLastfmTags,
  mockTrackSetEnrichmentVersion,
  mockArtistFindStale,
  mockArtistUpdateGenres,
  mockArtistUpdateLastfmTags,
  mockArtistSetEnrichmentVersion,
  mockUpdateSyncStatus,
  mockSetSyncStatus,
  mockBuildClassifyPrompt,
  mockClassifyTracks,
  mockGetArtistTopTags,
  mockGetTrackTopTags,
} = vi.hoisted(() => ({
  mockGetValidToken: vi.fn(),
  mockFetchLikedSongs: vi.fn(),
  mockFetchArtists: vi.fn(),
  mockUpsertMany: vi.fn(),
  mockTrackFindStale: vi.fn(),
  mockTrackFindStaleWithArtists: vi.fn(),
  mockTrackFindStaleWithPrimaryArtist: vi.fn(),
  mockTrackUpdateDerivedEra: vi.fn(),
  mockTrackUpdateClaudeClassification: vi.fn(),
  mockTrackUpdateLastfmTags: vi.fn(),
  mockTrackSetEnrichmentVersion: vi.fn(),
  mockArtistFindStale: vi.fn(),
  mockArtistUpdateGenres: vi.fn(),
  mockArtistUpdateLastfmTags: vi.fn(),
  mockArtistSetEnrichmentVersion: vi.fn(),
  mockUpdateSyncStatus: vi.fn(),
  mockSetSyncStatus: vi.fn(),
  mockBuildClassifyPrompt: vi.fn(),
  mockClassifyTracks: vi.fn(),
  mockGetArtistTopTags: vi.fn(),
  mockGetTrackTopTags: vi.fn(),
}));

vi.mock("@/lib/spotify-token", () => ({
  getValidToken: mockGetValidToken,
}));

vi.mock("@/lib/spotify", () => ({
  fetchLikedSongs: mockFetchLikedSongs,
  fetchArtists: mockFetchArtists,
}));

vi.mock("@/lib/lastfm", () => ({
  getArtistTopTags: mockGetArtistTopTags,
  getTrackTopTags: mockGetTrackTopTags,
}));

vi.mock("@/lib/enrichment", () => ({
  CURRENT_ENRICHMENT_VERSION: 3,
  deriveEra: (date: string | null) => {
    if (!date) return null;
    const year = parseInt(date.slice(0, 4), 10);
    if (isNaN(year)) return null;
    return `${Math.floor(year / 10) * 10}s`;
  },
}));

vi.mock("@/lib/prompts/classify-tracks", () => ({
  buildClassifyPrompt: mockBuildClassifyPrompt,
}));

vi.mock("@/lib/claude", () => ({
  classifyTracks: mockClassifyTracks,
}));

vi.mock("@/repositories/track.repository", () => ({
  trackRepository: {
    upsertMany: mockUpsertMany,
    findStale: mockTrackFindStale,
    findStaleWithArtists: mockTrackFindStaleWithArtists,
    findStaleWithPrimaryArtist: mockTrackFindStaleWithPrimaryArtist,
    updateDerivedEra: mockTrackUpdateDerivedEra,
    updateClaudeClassification: mockTrackUpdateClaudeClassification,
    updateLastfmTags: mockTrackUpdateLastfmTags,
    setEnrichmentVersion: mockTrackSetEnrichmentVersion,
  },
}));

vi.mock("@/repositories/artist.repository", () => ({
  artistRepository: {
    findStale: mockArtistFindStale,
    updateGenres: mockArtistUpdateGenres,
    updateLastfmTags: mockArtistUpdateLastfmTags,
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
  mockArtistUpdateLastfmTags.mockResolvedValue(undefined);
  mockArtistSetEnrichmentVersion.mockResolvedValue(0);
  mockTrackFindStale.mockResolvedValue([]);
  mockTrackFindStaleWithArtists.mockResolvedValue([]);
  mockTrackFindStaleWithPrimaryArtist.mockResolvedValue([]);
  mockTrackUpdateDerivedEra.mockResolvedValue(undefined);
  mockTrackUpdateClaudeClassification.mockResolvedValue(undefined);
  mockTrackUpdateLastfmTags.mockResolvedValue(undefined);
  mockTrackSetEnrichmentVersion.mockResolvedValue(0);
  mockFetchArtists.mockResolvedValue(new Map());
  mockBuildClassifyPrompt.mockReturnValue({ system: "sys", user: "usr" });
  mockClassifyTracks.mockResolvedValue({ results: [], inputTokens: 0, outputTokens: 0 });
  mockGetArtistTopTags.mockResolvedValue([]);
  mockGetTrackTopTags.mockResolvedValue([]);
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
      "enrich-artists/lastfm-tags-0",
      "enrich-artists/set-version-0",
      "enrich-tracks/era-0",
      "enrich-tracks/claude-classify-0",
      "enrich-tracks/lastfm-tags-0",
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

  it("classifies tracks with mocked Claude response", async () => {
    mockTrackFindStaleWithArtists.mockResolvedValueOnce([
      { id: "t1", name: "Song A", artist: "Artist A", enrichmentVersion: 0 },
      { id: "t2", name: "Song B", artist: "Artist B", enrichmentVersion: 0 },
    ]);

    mockClassifyTracks.mockResolvedValueOnce({
      results: [
        { mood: "uplifting", energy: "high", danceability: "medium", vibeTags: ["summer", "driving"] },
        { mood: "melancholic", energy: "low", danceability: "low", vibeTags: ["late-night", "rainy-day"] },
      ],
      inputTokens: 100,
      outputTokens: 50,
    });

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(mockBuildClassifyPrompt).toHaveBeenCalledWith([
      { name: "Song A", artist: "Artist A" },
      { name: "Song B", artist: "Artist B" },
    ]);
    expect(mockTrackUpdateClaudeClassification).toHaveBeenCalledWith([
      { id: "t1", claudeMood: "uplifting", claudeEnergy: "high", claudeDanceability: "medium", claudeVibeTags: ["summer", "driving"] },
      { id: "t2", claudeMood: "melancholic", claudeEnergy: "low", claudeDanceability: "low", claudeVibeTags: ["late-night", "rainy-day"] },
    ]);
  });

  it("skips tracks with invalid Claude response", async () => {
    mockTrackFindStaleWithArtists.mockResolvedValueOnce([
      { id: "t1", name: "Song A", artist: "Artist A", enrichmentVersion: 0 },
      { id: "t2", name: "Song B", artist: "Artist B", enrichmentVersion: 0 },
    ]);

    mockClassifyTracks.mockResolvedValueOnce({
      results: [
        { mood: "uplifting", energy: "high", danceability: "medium", vibeTags: ["summer"] },
        { mood: "", energy: "invalid", danceability: "low", vibeTags: [] }, // invalid: empty mood, bad energy, empty vibeTags
      ],
      inputTokens: 50,
      outputTokens: 25,
    });

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(mockTrackUpdateClaudeClassification).toHaveBeenCalledWith([
      { id: "t1", claudeMood: "uplifting", claudeEnergy: "high", claudeDanceability: "medium", claudeVibeTags: ["summer"] },
    ]);
  });

  it("chunks classification at 500-track boundary", async () => {
    const staleTracks = Array.from({ length: 500 }, (_, i) => ({
      id: `t${i}`,
      name: `Song ${i}`,
      artist: `Artist ${i}`,
      enrichmentVersion: 0,
    }));
    mockTrackFindStaleWithArtists
      .mockResolvedValueOnce(staleTracks)
      .mockResolvedValueOnce([]);

    mockClassifyTracks.mockResolvedValue({
      results: [],
      inputTokens: 0,
      outputTokens: 0,
    });

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    const stepNames = step.run.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(stepNames).toContain("enrich-tracks/claude-classify-0");
    expect(stepNames).toContain("enrich-tracks/claude-classify-500");
  });

  it("enriches artists with Last.fm tags", async () => {
    mockArtistFindStale
      .mockResolvedValueOnce([]) // spotify-genres call
      .mockResolvedValueOnce([   // lastfm-tags call
        { id: "a1", spotifyId: "sa1", name: "Radiohead", enrichmentVersion: 0 },
        { id: "a2", spotifyId: "sa2", name: "Aphex Twin", enrichmentVersion: 0 },
      ]);

    mockGetArtistTopTags
      .mockResolvedValueOnce(["rock", "alternative", "indie"])
      .mockResolvedValueOnce(["electronic", "ambient"]);

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(mockGetArtistTopTags).toHaveBeenCalledWith("Radiohead");
    expect(mockGetArtistTopTags).toHaveBeenCalledWith("Aphex Twin");
    expect(mockArtistUpdateLastfmTags).toHaveBeenCalledWith([
      { id: "a1", lastfmTags: ["rock", "alternative", "indie"] },
      { id: "a2", lastfmTags: ["electronic", "ambient"] },
    ]);
  });

  it("enriches tracks with Last.fm tags", async () => {
    mockTrackFindStaleWithPrimaryArtist.mockResolvedValueOnce([
      { id: "t1", name: "Creep", artist: "Radiohead", enrichmentVersion: 0 },
      { id: "t2", name: "Windowlicker", artist: "Aphex Twin", enrichmentVersion: 0 },
    ]);

    mockGetTrackTopTags
      .mockResolvedValueOnce(["alternative", "rock"])
      .mockResolvedValueOnce(["electronic"]);

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(mockGetTrackTopTags).toHaveBeenCalledWith("Radiohead", "Creep");
    expect(mockGetTrackTopTags).toHaveBeenCalledWith("Aphex Twin", "Windowlicker");
    expect(mockTrackUpdateLastfmTags).toHaveBeenCalledWith([
      { id: "t1", lastfmTags: ["alternative", "rock"] },
      { id: "t2", lastfmTags: ["electronic"] },
    ]);
  });

  it("skips artists where Last.fm returns empty tags", async () => {
    mockArtistFindStale
      .mockResolvedValueOnce([]) // spotify-genres
      .mockResolvedValueOnce([   // lastfm-tags
        { id: "a1", spotifyId: "sa1", name: "Known Artist", enrichmentVersion: 0 },
        { id: "a2", spotifyId: "sa2", name: "Unknown Artist", enrichmentVersion: 0 },
      ]);

    mockGetArtistTopTags
      .mockResolvedValueOnce(["rock"])
      .mockResolvedValueOnce([]); // no tags

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(mockArtistUpdateLastfmTags).toHaveBeenCalledWith([
      { id: "a1", lastfmTags: ["rock"] },
    ]);
  });

  it("skips tracks where Last.fm returns empty tags", async () => {
    mockTrackFindStaleWithPrimaryArtist.mockResolvedValueOnce([
      { id: "t1", name: "Known Track", artist: "Artist", enrichmentVersion: 0 },
      { id: "t2", name: "Unknown Track", artist: "Artist", enrichmentVersion: 0 },
    ]);

    mockGetTrackTopTags
      .mockResolvedValueOnce(["rock"])
      .mockResolvedValueOnce([]);

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(mockTrackUpdateLastfmTags).toHaveBeenCalledWith([
      { id: "t1", lastfmTags: ["rock"] },
    ]);
  });

  it("continues processing remaining artists when one Last.fm call fails", async () => {
    mockArtistFindStale
      .mockResolvedValueOnce([]) // spotify-genres
      .mockResolvedValueOnce([   // lastfm-tags
        { id: "a1", spotifyId: "sa1", name: "Failing Artist", enrichmentVersion: 0 },
        { id: "a2", spotifyId: "sa2", name: "Good Artist", enrichmentVersion: 0 },
      ]);

    mockGetArtistTopTags
      .mockRejectedValueOnce(new Error("Last.fm API error: 500 Internal Server Error"))
      .mockResolvedValueOnce(["rock"]);

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(mockArtistUpdateLastfmTags).toHaveBeenCalledWith([
      { id: "a2", lastfmTags: ["rock"] },
    ]);
  });

  it("continues processing remaining tracks when one Last.fm call fails", async () => {
    mockTrackFindStaleWithPrimaryArtist.mockResolvedValueOnce([
      { id: "t1", name: "Failing Track", artist: "Artist", enrichmentVersion: 0 },
      { id: "t2", name: "Good Track", artist: "Artist", enrichmentVersion: 0 },
    ]);

    mockGetTrackTopTags
      .mockRejectedValueOnce(new Error("Last.fm API error: 500 Internal Server Error"))
      .mockResolvedValueOnce(["electronic"]);

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(mockTrackUpdateLastfmTags).toHaveBeenCalledWith([
      { id: "t2", lastfmTags: ["electronic"] },
    ]);
  });

  it("chunks Last.fm artist enrichment at 200 boundary", async () => {
    const staleArtists = Array.from({ length: 200 }, (_, i) => ({
      id: `a${i}`,
      spotifyId: `sa${i}`,
      name: `Artist ${i}`,
      enrichmentVersion: 0,
    }));
    mockArtistFindStale
      .mockResolvedValueOnce([])           // spotify-genres
      .mockResolvedValueOnce(staleArtists) // lastfm-tags chunk 0
      .mockResolvedValueOnce([]);          // lastfm-tags chunk 1 (done)

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    const stepNames = step.run.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(stepNames).toContain("enrich-artists/lastfm-tags-0");
    expect(stepNames).toContain("enrich-artists/lastfm-tags-200");
  });

  it("chunks Last.fm track enrichment at 200 boundary", async () => {
    const staleTracks = Array.from({ length: 200 }, (_, i) => ({
      id: `t${i}`,
      name: `Song ${i}`,
      artist: `Artist ${i}`,
      enrichmentVersion: 0,
    }));
    mockTrackFindStaleWithPrimaryArtist
      .mockResolvedValueOnce(staleTracks)
      .mockResolvedValueOnce([]);

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    const stepNames = step.run.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(stepNames).toContain("enrich-tracks/lastfm-tags-0");
    expect(stepNames).toContain("enrich-tracks/lastfm-tags-200");
  });
});
