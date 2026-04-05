import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetValidToken,
  mockFetchLikedSongs,
  mockUpsertMany,
  mockTrackFindStale,
  mockTrackFindStaleWithArtists,
  mockTrackFindStaleVibeProfiles,
  mockTrackUpdateDerivedEra,
  mockTrackUpdateClaudeClassification,
  mockTrackUpdateVibeProfiles,
  mockTrackSetEnrichmentVersion,
  mockArtistFindStale,
  mockArtistUpdateGenres,
  mockArtistSetEnrichmentVersion,
  mockUpdateSyncStatus,
  mockSetSyncStatus,
  mockBuildClassifyPrompt,
  mockClassifyTracks,
} = vi.hoisted(() => ({
  mockGetValidToken: vi.fn(),
  mockFetchLikedSongs: vi.fn(),
  mockUpsertMany: vi.fn(),
  mockTrackFindStale: vi.fn(),
  mockTrackFindStaleWithArtists: vi.fn(),
  mockTrackFindStaleVibeProfiles: vi.fn(),
  mockTrackUpdateDerivedEra: vi.fn(),
  mockTrackUpdateClaudeClassification: vi.fn(),
  mockTrackUpdateVibeProfiles: vi.fn(),
  mockTrackSetEnrichmentVersion: vi.fn(),
  mockArtistFindStale: vi.fn(),
  mockArtistUpdateGenres: vi.fn(),
  mockArtistSetEnrichmentVersion: vi.fn(),
  mockUpdateSyncStatus: vi.fn(),
  mockSetSyncStatus: vi.fn(),
  mockBuildClassifyPrompt: vi.fn(),
  mockClassifyTracks: vi.fn(),
}));

vi.mock("@/lib/spotify-token", () => ({
  getValidToken: mockGetValidToken,
}));

vi.mock("@/lib/spotify", () => ({
  fetchLikedSongs: mockFetchLikedSongs,
}));

vi.mock("@/lib/enrichment", () => ({
  SPOTIFY_ENRICHMENT_VERSION: 1,
  CLAUDE_ENRICHMENT_VERSION: 1,
  VIBE_DERIVATION_VERSION: 1,
  SPOTIFY_EXTENDED_QUOTA: false,
  deriveEra: (date: string | null) => {
    if (!date) return null;
    const year = parseInt(date.slice(0, 4), 10);
    if (isNaN(year)) return null;
    return `${Math.floor(year / 10) * 10}s`;
  },
}));

vi.mock("@/lib/prompts/classify-tracks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/prompts/classify-tracks")>();
  return {
    // Reuse the real CANONICAL_MOODS array so the validator stays in sync
    // with the source of truth — no drift if a 12th mood is added.
    ...actual,
    buildClassifyPrompt: mockBuildClassifyPrompt,
  };
});

vi.mock("@/lib/claude", () => ({
  classifyTracks: mockClassifyTracks,
}));

vi.mock("@/repositories/track.repository", () => ({
  trackRepository: {
    upsertMany: mockUpsertMany,
    findStale: mockTrackFindStale,
    findStaleWithArtists: mockTrackFindStaleWithArtists,
    findStaleVibeProfiles: mockTrackFindStaleVibeProfiles,
    updateDerivedEra: mockTrackUpdateDerivedEra,
    updateClaudeClassification: mockTrackUpdateClaudeClassification,
    updateVibeProfiles: mockTrackUpdateVibeProfiles,
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
    sendEvent: vi.fn(),
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
  mockTrackFindStaleWithArtists.mockResolvedValue([]);
  mockTrackFindStaleVibeProfiles.mockResolvedValue([]);
  mockTrackUpdateDerivedEra.mockResolvedValue(undefined);
  mockTrackUpdateClaudeClassification.mockResolvedValue(undefined);
  mockTrackUpdateVibeProfiles.mockResolvedValue(undefined);
  mockTrackSetEnrichmentVersion.mockResolvedValue(0);
  mockBuildClassifyPrompt.mockReturnValue({ system: "sys", user: "usr" });
  mockClassifyTracks.mockResolvedValue({ results: [], inputTokens: 0, outputTokens: 0 });
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
      "enrich-tracks/era-0",
      "enrich-tracks/claude-classify-0",
      "derive-vibe-profile-0",
      "update-status",
    ]);

    expect(step.sendEvent).toHaveBeenCalledWith(
      "request-lastfm-enrichment",
      { name: "enrichment/lastfm.requested", data: {} }
    );
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

  it("derives era from releaseDate", async () => {
    mockTrackFindStale.mockResolvedValueOnce([
      { id: "t1", releaseDate: "2023-06-15" },
      { id: "t2", releaseDate: "1995-01-01" },
    ]);

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(mockTrackUpdateDerivedEra).toHaveBeenCalledWith([
      { id: "t1", derivedEra: "2020s" },
      { id: "t2", derivedEra: "1990s" },
    ]);
  });

  it("passes null derivedEra for tracks with null release date", async () => {
    mockTrackFindStale.mockResolvedValueOnce([
      { id: "t1", releaseDate: "2023-06-15" },
      { id: "t2", releaseDate: null },
    ]);

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(mockTrackUpdateDerivedEra).toHaveBeenCalledWith([
      { id: "t1", derivedEra: "2020s" },
      { id: "t2", derivedEra: null },
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
      { id: "t1", name: "Song A", artist: "Artist A" },
      { id: "t2", name: "Song B", artist: "Artist B" },
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
      { id: "t1", mood: "uplifting", energy: "high", danceability: "medium", vibeTags: ["summer", "driving"] },
      { id: "t2", mood: "melancholic", energy: "low", danceability: "low", vibeTags: ["late-night", "rainy-day"] },
    ]);
  });

  it("stores null fields for tracks with invalid Claude response", async () => {
    mockTrackFindStaleWithArtists.mockResolvedValueOnce([
      { id: "t1", name: "Song A", artist: "Artist A" },
      { id: "t2", name: "Song B", artist: "Artist B" },
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
      { id: "t1", mood: "uplifting", energy: "high", danceability: "medium", vibeTags: ["summer"] },
      { id: "t2", mood: null, energy: null, danceability: null, vibeTags: [] },
    ]);
  });

  it("accepts explicit null mood from Claude v2 as valid classification", async () => {
    // v2 prompt tells Claude to return mood: null when no canonical mood
    // fits. The validator should accept null (distinct from rejecting an
    // off-list string) and write the classification with null mood.
    mockTrackFindStaleWithArtists.mockResolvedValueOnce([
      { id: "t1", name: "Song A", artist: "Artist A" },
    ]);

    mockClassifyTracks.mockResolvedValueOnce({
      results: [
        { mood: null, energy: "medium", danceability: "low", vibeTags: ["experimental"] },
      ],
      inputTokens: 50,
      outputTokens: 25,
    });

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(mockTrackUpdateClaudeClassification).toHaveBeenCalledWith([
      { id: "t1", mood: null, energy: "medium", danceability: "low", vibeTags: ["experimental"] },
    ]);
  });

  it("normalizes canonical mood case and whitespace before writing", async () => {
    // If Claude returns "Uplifting" or " uplifting ", the validator should
    // accept it and the caller should store the canonical lowercase form.
    mockTrackFindStaleWithArtists.mockResolvedValueOnce([
      { id: "t1", name: "Song A", artist: "Artist A" },
      { id: "t2", name: "Song B", artist: "Artist B" },
    ]);

    mockClassifyTracks.mockResolvedValueOnce({
      results: [
        { mood: "Uplifting", energy: "high", danceability: "high", vibeTags: ["summer"] },
        { mood: "  peaceful  ", energy: "low", danceability: "low", vibeTags: ["calm"] },
      ],
      inputTokens: 50,
      outputTokens: 25,
    });

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(mockTrackUpdateClaudeClassification).toHaveBeenCalledWith([
      { id: "t1", mood: "uplifting", energy: "high", danceability: "high", vibeTags: ["summer"] },
      { id: "t2", mood: "peaceful", energy: "low", danceability: "low", vibeTags: ["calm"] },
    ]);
  });

  it("rejects off-list mood strings as invalid (classification falls through to null)", async () => {
    // Pre-v2 mood words like "joyful" or "soulful" are no longer accepted.
    // The whole classification is rejected and the track gets all-null
    // fields.
    mockTrackFindStaleWithArtists.mockResolvedValueOnce([
      { id: "t1", name: "Song A", artist: "Artist A" },
      { id: "t2", name: "Song B", artist: "Artist B" },
    ]);

    mockClassifyTracks.mockResolvedValueOnce({
      results: [
        { mood: "joyful", energy: "high", danceability: "high", vibeTags: ["summer"] }, // off-list
        { mood: "soulful", energy: "medium", danceability: "medium", vibeTags: ["slow"] }, // off-list
      ],
      inputTokens: 50,
      outputTokens: 25,
    });

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(mockTrackUpdateClaudeClassification).toHaveBeenCalledWith([
      { id: "t1", mood: null, energy: null, danceability: null, vibeTags: [] },
      { id: "t2", mood: null, energy: null, danceability: null, vibeTags: [] },
    ]);
  });

  it("chunks classification at 500-track boundary", async () => {
    const staleTracks = Array.from({ length: 500 }, (_, i) => ({
      id: `t${i}`,
      name: `Song ${i}`,
      artist: `Artist ${i}`,
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

  it("derives vibe profiles for stale tracks before update-status", async () => {
    mockTrackFindStaleVibeProfiles.mockResolvedValueOnce([
      {
        id: "t1",
        artistNames: ["Radiohead"],
        claude: {
          mood: "melancholic",
          energy: "low",
          danceability: "low",
          vibeTags: ["late-night"],
        },
        trackSpotify: { derivedEra: "1990s" },
        trackLastfm: null,
        artistLastfmTags: [],
      },
    ]);

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(mockTrackFindStaleVibeProfiles).toHaveBeenCalled();
    expect(mockTrackUpdateVibeProfiles).toHaveBeenCalledTimes(1);
    const updates = mockTrackUpdateVibeProfiles.mock.calls[0]![0];
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("t1");
    expect(updates[0].mood).toBe("melancholic");
    // 1990s from Spotify → 80s? No, 1990s → 90s via synonym map
    expect(updates[0].tags).toContain("90s");
  });

  it("chunks vibe derivation at 500-track boundary", async () => {
    const staleVibes = Array.from({ length: 500 }, (_, i) => ({
      id: `t${i}`,
      artistNames: ["Artist"],
      claude: null,
      trackSpotify: null,
      trackLastfm: null,
      artistLastfmTags: [],
    }));
    mockTrackFindStaleVibeProfiles
      .mockResolvedValueOnce(staleVibes)
      .mockResolvedValueOnce([]);

    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    const stepNames = step.run.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(stepNames).toContain("derive-vibe-profile-0");
    expect(stepNames).toContain("derive-vibe-profile-500");
  });

  it("sends enrichment/lastfm.requested event after sync", async () => {
    const step = createMockStep();
    await handler({ event: { data: { userId: "user-1" } }, step });

    expect(step.sendEvent).toHaveBeenCalledTimes(1);
    expect(step.sendEvent).toHaveBeenCalledWith(
      "request-lastfm-enrichment",
      { name: "enrichment/lastfm.requested", data: {} }
    );
  });
});
