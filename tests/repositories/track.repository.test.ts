// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "../helpers/mock-db";

vi.mock("server-only", () => ({}));

const { db, execute, executeTakeFirstOrThrow, selectFrom, insertInto } =
  createMockDb();

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/id", () => ({ createId: () => "generated-id" }));

describe("trackRepository", () => {
  let trackRepository: Awaited<
    typeof import("@/repositories/track.repository")
  >["trackRepository"];

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/repositories/track.repository");
    trackRepository = mod.trackRepository;
  });

  describe("findByUserId", () => {
    it("returns tracks for a user via join", async () => {
      const expected = [
        { id: "t1", spotifyId: "s1", name: "Song 1", artist: "Artist 1" },
      ];
      execute.mockResolvedValue(expected);

      const result = await trackRepository.findByUserId("u1");

      expect(result).toEqual(expected);
      expect(selectFrom).toHaveBeenCalledWith("track");
    });
  });

  describe("countByUserId", () => {
    it("counts liked songs for a user", async () => {
      executeTakeFirstOrThrow.mockResolvedValue({ count: 42 });

      const result = await trackRepository.countByUserId("u1");

      expect(result).toBe(42);
      expect(selectFrom).toHaveBeenCalledWith("likedSong");
    });
  });

  describe("upsertMany", () => {
    it("inserts artists, tracks, track_artist join, and liked songs", async () => {
      // execute is called 6 times in order:
      // 1. artist INSERT, 2. artist SELECT, 3. track INSERT,
      // 4. track SELECT, 5. trackArtist INSERT, 6. likedSong INSERT
      execute
        .mockResolvedValueOnce([]) // artist INSERT
        .mockResolvedValueOnce([   // artist SELECT
          { id: "artist-1", spotifyId: "a1" },
          { id: "artist-2", spotifyId: "a2" },
        ])
        .mockResolvedValueOnce([]) // track INSERT
        .mockResolvedValueOnce([   // track SELECT
          { id: "track-1", spotifyId: "s1" },
        ])
        .mockResolvedValueOnce([]) // trackArtist INSERT
        .mockResolvedValueOnce([]); // likedSong INSERT

      await trackRepository.upsertMany("u1", [
        {
          spotifyId: "s1",
          name: "Song 1",
          artists: [
            { spotifyId: "a1", name: "Artist 1" },
            { spotifyId: "a2", name: "Artist 2" },
          ],
          album: "Album 1",
          albumArtUrl: "https://img.spotify.com/1.jpg",
          spotifyPopularity: 75,
          spotifyDurationMs: 210000,
          spotifyReleaseDate: "2024-01-01",
          likedAt: new Date("2024-01-01"),
        },
      ]);

      expect(insertInto).toHaveBeenCalledWith("artist");
      expect(insertInto).toHaveBeenCalledWith("track");
      expect(insertInto).toHaveBeenCalledWith("trackArtist");
      expect(insertInto).toHaveBeenCalledWith("likedSong");
    });

    it("does nothing for empty array", async () => {
      await trackRepository.upsertMany("u1", []);

      expect(insertInto).not.toHaveBeenCalled();
    });
  });

  describe("findStale", () => {
    it("queries tracks with enrichmentVersion below target", async () => {
      const expected = [
        { id: "t1", spotifyId: "s1", name: "Song 1", enrichmentVersion: 0 },
      ];
      execute.mockResolvedValue(expected);

      const result = await trackRepository.findStale(1, 500);

      expect(result).toEqual(expected);
      expect(selectFrom).toHaveBeenCalledWith("track");
    });
  });
});
