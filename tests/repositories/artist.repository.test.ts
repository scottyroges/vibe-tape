// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "../helpers/mock-db";

vi.mock("server-only", () => ({}));

const { db, execute, selectFrom, insertInto, updateTable } = createMockDb();

vi.mock("@/lib/db", () => ({ db }));

describe("artistRepository", () => {
  let artistRepository: Awaited<
    typeof import("@/repositories/artist.repository")
  >["artistRepository"];

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/repositories/artist.repository");
    artistRepository = mod.artistRepository;
  });

  describe("findStale", () => {
    it("queries artists with stale spotify enrichment via left join", async () => {
      const expected = [
        { id: "a1", spotifyId: "sa1", name: "Artist 1" },
      ];
      execute.mockResolvedValue(expected);

      const result = await artistRepository.findStale("artistSpotifyEnrichment", 1, 500);

      expect(result).toEqual(expected);
      expect(selectFrom).toHaveBeenCalledWith("artist");
    });

    it("queries artists with stale lastfm enrichment via left join", async () => {
      const expected = [
        { id: "a1", spotifyId: "sa1", name: "Artist 1" },
      ];
      execute.mockResolvedValue(expected);

      const result = await artistRepository.findStale("artistLastfmEnrichment", 1, 500);

      expect(result).toEqual(expected);
      expect(selectFrom).toHaveBeenCalledWith("artist");
    });
  });

  describe("updateGenres", () => {
    it("upserts each artist's spotify enrichment with genres", async () => {
      execute.mockResolvedValue([]);

      await artistRepository.updateGenres([
        { id: "a1", genres: ["pop", "rock"] },
        { id: "a2", genres: ["jazz"] },
      ]);

      expect(insertInto).toHaveBeenCalledWith("artistSpotifyEnrichment");
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("does nothing for empty array", async () => {
      await artistRepository.updateGenres([]);

      expect(insertInto).not.toHaveBeenCalled();
    });
  });

  describe("updateLastfmTags", () => {
    it("upserts each artist's lastfm enrichment with tags in a transaction", async () => {
      execute.mockResolvedValue([]);

      await artistRepository.updateLastfmTags([
        { id: "a1", tags: ["rock", "alternative"] },
        { id: "a2", tags: ["electronic"] },
      ]);

      expect(insertInto).toHaveBeenCalledWith("artistLastfmEnrichment");
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("does nothing for empty array", async () => {
      await artistRepository.updateLastfmTags([]);

      expect(insertInto).not.toHaveBeenCalled();
    });
  });

  describe("setEnrichmentVersion", () => {
    it("updates enrichment rows below target version and returns count", async () => {
      execute.mockResolvedValue([{ numUpdatedRows: BigInt(5) }]);

      const result = await artistRepository.setEnrichmentVersion(
        "artistSpotifyEnrichment",
        1,
        1000
      );

      expect(result).toBe(5);
      expect(updateTable).toHaveBeenCalledWith("artistSpotifyEnrichment");
    });

    it("returns 0 when no stale artists", async () => {
      execute.mockResolvedValue([{ numUpdatedRows: BigInt(0) }]);

      const result = await artistRepository.setEnrichmentVersion(
        "artistLastfmEnrichment",
        1,
        1000
      );

      expect(result).toBe(0);
    });
  });
});
