// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "../helpers/mock-db";

vi.mock("server-only", () => ({}));

const { db, execute, selectFrom, updateTable } = createMockDb();

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
    it("queries artists with enrichmentVersion below target", async () => {
      const expected = [
        { id: "a1", spotifyId: "sa1", name: "Artist 1", enrichmentVersion: 0 },
      ];
      execute.mockResolvedValue(expected);

      const result = await artistRepository.findStale(1, 500);

      expect(result).toEqual(expected);
      expect(selectFrom).toHaveBeenCalledWith("artist");
    });
  });

  describe("updateGenres", () => {
    it("updates each artist with genres", async () => {
      execute.mockResolvedValue([]);

      await artistRepository.updateGenres([
        { id: "a1", spotifyGenres: ["pop", "rock"] },
        { id: "a2", spotifyGenres: ["jazz"] },
      ]);

      expect(updateTable).toHaveBeenCalledWith("artist");
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("does nothing for empty array", async () => {
      await artistRepository.updateGenres([]);

      expect(updateTable).not.toHaveBeenCalled();
    });
  });

  describe("setEnrichmentVersion", () => {
    it("updates artists below target version and returns count", async () => {
      execute.mockResolvedValue([{ numUpdatedRows: BigInt(5) }]);

      const result = await artistRepository.setEnrichmentVersion(1, 1000);

      expect(result).toBe(5);
      expect(updateTable).toHaveBeenCalledWith("artist");
    });

    it("returns 0 when no stale artists", async () => {
      execute.mockResolvedValue([{ numUpdatedRows: BigInt(0) }]);

      const result = await artistRepository.setEnrichmentVersion(1, 1000);

      expect(result).toBe(0);
    });
  });
});
