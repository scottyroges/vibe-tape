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
        { id: "t1", spotifyId: "s1", name: "Song 1" },
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
    it("inserts tracks and liked songs", async () => {
      execute.mockResolvedValue([
        { id: "track-1", spotifyId: "s1" },
      ]);

      await trackRepository.upsertMany("u1", [
        {
          spotifyId: "s1",
          name: "Song 1",
          artist: "Artist 1",
          album: "Album 1",
          albumArtUrl: "https://img.spotify.com/1.jpg",
          addedAt: new Date("2024-01-01"),
        },
      ]);

      expect(insertInto).toHaveBeenCalledWith("track");
      expect(insertInto).toHaveBeenCalledWith("likedSong");
    });

    it("does nothing for empty array", async () => {
      await trackRepository.upsertMany("u1", []);

      expect(insertInto).not.toHaveBeenCalled();
    });
  });
});
