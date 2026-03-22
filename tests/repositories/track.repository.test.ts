// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "../helpers/mock-db";

vi.mock("server-only", () => ({}));

const { db, execute, executeTakeFirstOrThrow, selectFrom, insertInto, updateTable, where } =
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
    it("inserts artists, tracks, track_artist join, liked songs, and enrichment rows", async () => {
      // execute is called 8 times in order:
      // 1. artist INSERT, 2. artist SELECT, 3. track INSERT,
      // 4. track SELECT, 5. trackArtist INSERT, 6. likedSong INSERT,
      // 7. trackSpotifyEnrichment INSERT, 8. artistSpotifyEnrichment INSERT
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
        .mockResolvedValueOnce([]) // likedSong INSERT
        .mockResolvedValueOnce([]) // trackSpotifyEnrichment INSERT
        .mockResolvedValueOnce([]); // artistSpotifyEnrichment INSERT

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
      expect(insertInto).toHaveBeenCalledWith("trackSpotifyEnrichment");
      expect(insertInto).toHaveBeenCalledWith("artistSpotifyEnrichment");
    });

    it("does nothing for empty array", async () => {
      await trackRepository.upsertMany("u1", []);

      expect(insertInto).not.toHaveBeenCalled();
    });
  });

  describe("findStale", () => {
    it("queries tracks with stale spotify enrichment via left join", async () => {
      const expected = [
        { id: "t1", spotifyId: "s1", name: "Song 1" },
      ];
      execute.mockResolvedValue(expected);

      const result = await trackRepository.findStale(1, 500);

      expect(result).toEqual(expected);
      expect(selectFrom).toHaveBeenCalledWith("track");
    });
  });

  describe("updateDerivedEra", () => {
    it("upserts each track's spotify enrichment with derived era", async () => {
      execute.mockResolvedValue([]);

      await trackRepository.updateDerivedEra([
        { id: "t1", derivedEra: "2020s" },
        { id: "t2", derivedEra: "1990s" },
      ]);

      expect(insertInto).toHaveBeenCalledWith("trackSpotifyEnrichment");
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("does nothing for empty array", async () => {
      await trackRepository.updateDerivedEra([]);

      expect(insertInto).not.toHaveBeenCalled();
    });
  });

  describe("findStaleWithPrimaryArtist", () => {
    it("queries tracks with primary artist join and stale lastfm enrichment", async () => {
      const expected = [
        { id: "t1", spotifyId: "s1", name: "Song 1", artist: "Artist 1" },
      ];
      execute.mockResolvedValue(expected);

      const result = await trackRepository.findStaleWithPrimaryArtist(1, 200);

      expect(result).toEqual(expected);
      expect(selectFrom).toHaveBeenCalledWith("track");
      expect(where).toHaveBeenCalledWith("trackArtist.position", "=", 0);
    });
  });

  describe("updateLastfmTags", () => {
    it("upserts each track's lastfm enrichment with tags in a transaction", async () => {
      execute.mockResolvedValue([]);

      await trackRepository.updateLastfmTags([
        { id: "t1", tags: ["rock", "alternative"] },
        { id: "t2", tags: ["electronic"] },
      ]);

      expect(insertInto).toHaveBeenCalledWith("trackLastfmEnrichment");
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("does nothing for empty array", async () => {
      await trackRepository.updateLastfmTags([]);

      expect(insertInto).not.toHaveBeenCalled();
    });
  });

  describe("findStaleWithArtists", () => {
    it("queries tracks with artist join and stale claude enrichment", async () => {
      const expected = [
        { id: "t1", spotifyId: "s1", name: "Song 1", artist: "Artist 1" },
      ];
      execute.mockResolvedValue(expected);

      const result = await trackRepository.findStaleWithArtists(1, 500);

      expect(result).toEqual(expected);
      expect(selectFrom).toHaveBeenCalledWith("track");
    });
  });

  describe("updateClaudeClassification", () => {
    it("upserts each track's claude enrichment with classification data", async () => {
      execute.mockResolvedValue([]);

      await trackRepository.updateClaudeClassification([
        {
          id: "t1",
          mood: "melancholic",
          energy: "low",
          danceability: "low",
          vibeTags: ["late-night", "rainy-day"],
        },
        {
          id: "t2",
          mood: "uplifting",
          energy: "high",
          danceability: "high",
          vibeTags: ["summer", "driving"],
        },
      ]);

      expect(insertInto).toHaveBeenCalledWith("trackClaudeEnrichment");
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("does nothing for empty array", async () => {
      await trackRepository.updateClaudeClassification([]);

      expect(insertInto).not.toHaveBeenCalled();
    });
  });

  describe("setEnrichmentVersion", () => {
    it("updates enrichment rows below target version and returns count", async () => {
      execute.mockResolvedValue([{ numUpdatedRows: BigInt(10) }]);

      const result = await trackRepository.setEnrichmentVersion(
        "trackSpotifyEnrichment",
        1,
        1000
      );

      expect(result).toBe(10);
      expect(updateTable).toHaveBeenCalledWith("trackSpotifyEnrichment");
    });

    it("returns 0 when no stale tracks", async () => {
      execute.mockResolvedValue([{ numUpdatedRows: BigInt(0) }]);

      const result = await trackRepository.setEnrichmentVersion(
        "trackClaudeEnrichment",
        1,
        1000
      );

      expect(result).toBe(0);
    });
  });
});
