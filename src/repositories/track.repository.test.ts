import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SpotifyLikedSong } from "@/lib/spotify";

const { mockTrxExecute, mockTransaction } = vi.hoisted(() => {
  const mockTrxExecute = vi.fn();
  const mockTransaction = vi.fn(() => ({
    execute: mockTrxExecute,
  }));
  return { mockTrxExecute, mockTransaction };
});

vi.mock("@/lib/db", () => ({
  db: {
    transaction: mockTransaction,
  },
}));

vi.mock("@/lib/id", () => ({
  createId: vi.fn(() => "mock-id"),
}));

import { trackRepository } from "./track.repository";

describe("trackRepository.upsertMany", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns immediately for empty array", async () => {
    await trackRepository.upsertMany("user1", []);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("calls transaction with songs", async () => {
    mockTrxExecute.mockImplementation(async (fn: (...args: unknown[]) => unknown) => {
      const trackOnConflict = vi.fn(() => ({ execute: vi.fn() }));
      const trackValues = vi.fn(() => ({ onConflict: trackOnConflict }));

      const selectExecute = vi.fn().mockResolvedValue([
        { id: "track-1", spotifyId: "sp1" },
      ]);
      const selectSelect = vi.fn(() => ({ execute: selectExecute }));
      const selectWhere = vi.fn(() => ({ select: selectSelect }));
      const selectFrom = vi.fn(() => ({ where: selectWhere }));

      const likedOnConflict = vi.fn(() => ({ execute: vi.fn() }));
      const likedValues = vi.fn(() => ({ onConflict: likedOnConflict }));

      const trx = {
        insertInto: vi.fn((table: string) =>
          table === "track"
            ? { values: trackValues }
            : { values: likedValues }
        ),
        selectFrom,
      };

      await fn(trx);

      expect(trx.insertInto).toHaveBeenCalledWith("track");
      expect(trx.insertInto).toHaveBeenCalledWith("likedSong");
      expect(selectFrom).toHaveBeenCalledWith("track");
    });

    const songs: SpotifyLikedSong[] = [
      {
        spotifyId: "sp1",
        name: "Song 1",
        artist: "Artist 1",
        album: "Album 1",
        albumArtUrl: "https://img.com/1.jpg",
        likedAt: new Date("2024-01-01"),
      },
    ];

    await trackRepository.upsertMany("user1", songs);
    expect(mockTransaction).toHaveBeenCalled();
  });

  it("chunks large arrays into batches of 500", async () => {
    mockTrxExecute.mockImplementation(async (fn: (...args: unknown[]) => unknown) => {
      const trackOnConflict = vi.fn(() => ({ execute: vi.fn() }));
      const trackValues = vi.fn(() => ({ onConflict: trackOnConflict }));

      // Return matching track IDs for whatever spotifyIds are queried
      let capturedSpotifyIds: string[] = [];
      const selectExecute = vi.fn().mockImplementation(() =>
        Promise.resolve(
          capturedSpotifyIds.map((spId) => ({
            id: `track-${spId}`,
            spotifyId: spId,
          }))
        )
      );
      const selectSelect = vi.fn(() => ({ execute: selectExecute }));
      const selectWhere = vi.fn((_col: string, _op: string, ids: string[]) => {
        capturedSpotifyIds = ids;
        return { select: selectSelect };
      });
      const selectFrom = vi.fn(() => ({ where: selectWhere }));

      const likedOnConflict = vi.fn(() => ({ execute: vi.fn() }));
      const likedValues = vi.fn(() => ({ onConflict: likedOnConflict }));

      const trx = {
        insertInto: vi.fn((table: string) =>
          table === "track"
            ? { values: trackValues }
            : { values: likedValues }
        ),
        selectFrom,
      };

      await fn(trx);
    });

    const songs: SpotifyLikedSong[] = Array.from({ length: 750 }, (_, i) => ({
      spotifyId: `sp${i}`,
      name: `Song ${i}`,
      artist: "Artist",
      album: "Album",
      albumArtUrl: null,
      likedAt: new Date("2024-01-01"),
    }));

    await trackRepository.upsertMany("user1", songs);

    // 750 songs / 500 batch size = 2 batches = 2 transaction executions
    expect(mockTrxExecute).toHaveBeenCalledTimes(2);
  });
});
