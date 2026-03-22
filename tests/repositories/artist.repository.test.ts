// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "../helpers/mock-db";

vi.mock("server-only", () => ({}));

const { db, execute, selectFrom } = createMockDb();

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
});
