import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetValidToken,
  mockFetchLikedSongs,
  mockUpsertMany,
  mockUpdateSyncStatus,
  mockSetSyncStatus,
} = vi.hoisted(() => ({
  mockGetValidToken: vi.fn(),
  mockFetchLikedSongs: vi.fn(),
  mockUpsertMany: vi.fn(),
  mockUpdateSyncStatus: vi.fn(),
  mockSetSyncStatus: vi.fn(),
}));

vi.mock("@/lib/spotify-token", () => ({
  getValidToken: mockGetValidToken,
}));

vi.mock("@/lib/spotify", () => ({
  fetchLikedSongs: mockFetchLikedSongs,
}));

vi.mock("@/repositories/track.repository", () => ({
  trackRepository: { upsertMany: mockUpsertMany },
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

function makeSong(overrides: { spotifyId?: string; name?: string } = {}) {
  return {
    spotifyId: overrides.spotifyId ?? "sp1",
    name: overrides.name ?? "Song",
    artists: [{ spotifyId: "a1", name: "Artist" }],
    album: "Album",
    albumArtUrl: null,
    spotifyPopularity: 75,
    spotifyDurationMs: 210000,
    spotifyReleaseDate: "2024-01-01",
    likedAt: "2024-01-01T00:00:00.000Z",
  };
}

describe("syncLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetSyncStatus.mockResolvedValue(undefined);
  });

  const { handler, opts } = syncLibrary as unknown as {
    handler: (...args: unknown[]) => unknown;
    opts: { onFailure: (...args: unknown[]) => Promise<void> };
  };

  it("orchestrates chunked steps in order", async () => {
    mockGetValidToken.mockResolvedValue({ accessToken: "tok-123" });
    mockFetchLikedSongs.mockResolvedValue({
      songs: [makeSong()],
      nextUrl: null,
    });
    mockUpsertMany.mockResolvedValue(undefined);
    mockUpdateSyncStatus.mockResolvedValue(undefined);

    const step = createMockStep();
    const event = { data: { userId: "user-1" } };

    const result = await handler({ event, step });

    expect(result).toEqual({ synced: 1 });

    const stepNames = step.run.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(stepNames).toEqual([
      "set-syncing",
      "get-token",
      "fetch-songs-0",
      "upsert-data-0",
      "update-status",
    ]);

    expect(mockSetSyncStatus).toHaveBeenCalledWith("user-1", "SYNCING");
    expect(mockSetSyncStatus).toHaveBeenCalledWith("user-1", "IDLE");
    expect(mockGetValidToken).toHaveBeenCalledWith("user-1");
    expect(mockUpdateSyncStatus).toHaveBeenCalledWith("user-1");
  });

  it("fetches and upserts multiple chunks when nextUrl is returned", async () => {
    mockGetValidToken.mockResolvedValue({ accessToken: "tok-123" });
    mockFetchLikedSongs
      .mockResolvedValueOnce({
        songs: [makeSong({ spotifyId: "sp1" })],
        nextUrl: "https://api.spotify.com/v1/me/tracks?offset=2000",
      })
      .mockResolvedValueOnce({
        songs: [makeSong({ spotifyId: "sp2" })],
        nextUrl: null,
      });
    mockUpsertMany.mockResolvedValue(undefined);
    mockUpdateSyncStatus.mockResolvedValue(undefined);

    const step = createMockStep();
    const result = await handler({
      event: { data: { userId: "user-1" } },
      step,
    });

    expect(result).toEqual({ synced: 2 });

    const stepNames = step.run.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    // Fetch and upsert are interleaved per chunk
    expect(stepNames).toEqual([
      "set-syncing",
      "get-token",
      "fetch-songs-0",
      "upsert-data-0",
      "fetch-songs-1",
      "upsert-data-1",
      "update-status",
    ]);

    expect(mockFetchLikedSongs).toHaveBeenCalledTimes(2);
    expect(mockUpsertMany).toHaveBeenCalledTimes(2);
  });

  it("throws without catching when a step fails", async () => {
    mockGetValidToken.mockRejectedValue(new Error("token error"));

    const step = createMockStep();
    const event = { data: { userId: "user-1" } };

    await expect(handler({ event, step })).rejects.toThrow("token error");

    expect(mockSetSyncStatus).toHaveBeenCalledWith("user-1", "SYNCING");
    expect(mockSetSyncStatus).not.toHaveBeenCalledWith("user-1", "FAILED");
  });

  it("onFailure sets status to FAILED", async () => {
    const failureEvent = { data: { event: { data: { userId: "user-1" } } } };

    await opts.onFailure({ event: failureEvent });

    expect(mockSetSyncStatus).toHaveBeenCalledWith("user-1", "FAILED");
  });

  it("rehydrates Date fields before upserting", async () => {
    mockGetValidToken.mockResolvedValue({ accessToken: "tok" });
    mockFetchLikedSongs.mockResolvedValue({
      songs: [makeSong()],
      nextUrl: null,
    });
    mockUpsertMany.mockResolvedValue(undefined);
    mockUpdateSyncStatus.mockResolvedValue(undefined);

    const step = createMockStep();
    await handler({ event: { data: { userId: "u1" } }, step });

    const upsertedSongs = mockUpsertMany.mock.calls[0]![1];
    expect(upsertedSongs[0].likedAt).toBeInstanceOf(Date);
    expect(upsertedSongs[0].likedAt.toISOString()).toBe(
      "2024-01-01T00:00:00.000Z"
    );
  });
});
