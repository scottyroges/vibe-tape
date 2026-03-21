import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetValidToken,
  mockFetchLikedSongs,
  mockUpsertMany,
  mockUpdateSyncStatus,
} = vi.hoisted(() => ({
  mockGetValidToken: vi.fn(),
  mockFetchLikedSongs: vi.fn(),
  mockUpsertMany: vi.fn(),
  mockUpdateSyncStatus: vi.fn(),
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
  userRepository: { updateSyncStatus: mockUpdateSyncStatus },
}));

vi.mock("@/lib/inngest", () => ({
  inngest: {
    createFunction: vi.fn((_opts: unknown, handler: (...args: unknown[]) => unknown) => {
      return { handler, _opts };
    }),
  },
}));

import { syncLibrary } from "./sync-library";

// Helper to simulate Inngest's step.run — just executes the callback immediately
function createMockStep() {
  return {
    run: vi.fn(
      async (_name: string, fn: () => Promise<unknown>) => fn()
    ),
  };
}

describe("syncLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const handler = (syncLibrary as unknown as { handler: (...args: unknown[]) => unknown }).handler;

  it("orchestrates all 4 steps in order", async () => {
    mockGetValidToken.mockResolvedValue({ accessToken: "tok-123" });
    mockFetchLikedSongs.mockResolvedValue([
      {
        spotifyId: "sp1",
        name: "Song",
        artist: "Art",
        album: "Alb",
        albumArtUrl: null,
        addedAt: "2024-01-01T00:00:00.000Z",
      },
    ]);
    mockUpsertMany.mockResolvedValue(undefined);
    mockUpdateSyncStatus.mockResolvedValue(undefined);

    const step = createMockStep();
    const event = { data: { userId: "user-1" } };

    const result = await handler({ event, step });

    expect(result).toEqual({ synced: 1 });
    expect(step.run).toHaveBeenCalledTimes(4);
    expect(step.run.mock.calls[0]![0]).toBe("get-token");
    expect(step.run.mock.calls[1]![0]).toBe("fetch-songs");
    expect(step.run.mock.calls[2]![0]).toBe("upsert-songs");
    expect(step.run.mock.calls[3]![0]).toBe("update-status");

    expect(mockGetValidToken).toHaveBeenCalledWith("user-1");
    expect(mockFetchLikedSongs).toHaveBeenCalledWith("tok-123");
    expect(mockUpsertMany).toHaveBeenCalledWith("user-1", [
      expect.objectContaining({
        spotifyId: "sp1",
        addedAt: expect.any(Date),
      }),
    ]);
    expect(mockUpdateSyncStatus).toHaveBeenCalledWith("user-1");
  });

  it("throws when getValidToken returns null", async () => {
    mockGetValidToken.mockResolvedValue(null);

    const step = createMockStep();
    const event = { data: { userId: "user-1" } };

    await expect(handler({ event, step })).rejects.toThrow(
      "No valid Spotify token for user user-1"
    );

    expect(mockFetchLikedSongs).not.toHaveBeenCalled();
    expect(mockUpsertMany).not.toHaveBeenCalled();
    expect(mockUpdateSyncStatus).not.toHaveBeenCalled();
  });

  it("rehydrates Date fields before upserting", async () => {
    mockGetValidToken.mockResolvedValue({ accessToken: "tok" });
    mockFetchLikedSongs.mockResolvedValue([
      {
        spotifyId: "sp1",
        name: "S",
        artist: "A",
        album: "Al",
        albumArtUrl: null,
        addedAt: "2024-06-15T00:00:00.000Z",
      },
    ]);
    mockUpsertMany.mockResolvedValue(undefined);
    mockUpdateSyncStatus.mockResolvedValue(undefined);

    const step = createMockStep();
    await handler({ event: { data: { userId: "u1" } }, step });

    const upsertedSongs = mockUpsertMany.mock.calls[0]![1];
    expect(upsertedSongs[0].addedAt).toBeInstanceOf(Date);
    expect(upsertedSongs[0].addedAt.toISOString()).toBe(
      "2024-06-15T00:00:00.000Z"
    );
  });
});
