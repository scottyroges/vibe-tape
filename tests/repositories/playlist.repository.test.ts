// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "../helpers/mock-db";

vi.mock("server-only", () => ({}));

const {
  db,
  execute,
  executeTakeFirst,
  selectFrom,
  insertInto,
  updateTable,
  deleteFrom,
  where,
  set,
  values,
} = createMockDb();

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/id", () => ({ createId: () => "generated-id" }));

describe("playlistRepository", () => {
  let playlistRepository: Awaited<
    typeof import("@/repositories/playlist.repository")
  >["playlistRepository"];

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/repositories/playlist.repository");
    playlistRepository = mod.playlistRepository;
  });

  const baseRow = {
    id: "p1",
    userId: "u1",
    spotifyPlaylistId: null,
    vibeName: "Night Drive",
    vibeDescription: "desc",
    seedSongIds: ["s1", "s2", "s3"],
    status: "PENDING" as const,
    generatedTrackIds: ["t1", "t2"],
    targetDurationMinutes: 60,
    userIntent: null,
    claudeTarget: { mood: "peaceful", energy: "low", danceability: null, genres: [], tags: [] },
    mathTarget: { mood: null, energy: null, danceability: null, genres: [], tags: [] },
    errorMessage: null,
    artImageUrl: null,
    lastSyncedAt: null,
    createdAt: new Date("2026-04-01"),
    updatedAt: new Date("2026-04-01"),
  };

  describe("findById", () => {
    it("returns domain playlist with narrow-cast targets", async () => {
      executeTakeFirst.mockResolvedValue(baseRow);

      const result = await playlistRepository.findById("p1");

      expect(selectFrom).toHaveBeenCalledWith("playlist");
      expect(result).not.toBeNull();
      expect(result!.claudeTarget).toEqual(baseRow.claudeTarget);
      expect(result!.mathTarget).toEqual(baseRow.mathTarget);
      expect(result!.status).toBe("PENDING");
    });

    it("returns null when not found", async () => {
      executeTakeFirst.mockResolvedValue(undefined);

      const result = await playlistRepository.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("findByUserId", () => {
    it("returns mapped domain rows", async () => {
      execute.mockResolvedValue([baseRow]);

      const result = await playlistRepository.findByUserId("u1");

      expect(selectFrom).toHaveBeenCalledWith("playlist");
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("p1");
    });
  });

  describe("createPlaceholder", () => {
    it("inserts a GENERATING row with empty generatedTrackIds and returns the new id", async () => {
      execute.mockResolvedValue([]);

      const id = await playlistRepository.createPlaceholder("u1", {
        seedTrackIds: ["s1", "s2", "s3"],
        targetDurationMinutes: 60,
        userIntent: "rainy morning",
      });

      expect(id).toBe("generated-id");
      expect(insertInto).toHaveBeenCalledWith("playlist");
      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "generated-id",
          userId: "u1",
          status: "GENERATING",
          generatedTrackIds: [],
          seedSongIds: ["s1", "s2", "s3"],
          targetDurationMinutes: 60,
          userIntent: "rainy morning",
          vibeName: "Generating...",
        })
      );
    });

    it("persists null userIntent when not provided", async () => {
      execute.mockResolvedValue([]);

      await playlistRepository.createPlaceholder("u1", {
        seedTrackIds: ["s1", "s2", "s3"],
        targetDurationMinutes: 90,
        userIntent: null,
      });

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({ userIntent: null })
      );
    });
  });

  describe("completeGeneration", () => {
    it("sets recipe fields and flips status to PENDING atomically", async () => {
      execute.mockResolvedValue([]);

      const claudeTarget = {
        mood: "peaceful" as const,
        energy: "medium" as const,
        danceability: "low" as const,
        genres: ["synthpop"],
        tags: ["night"],
      };
      const mathTarget = {
        mood: "peaceful" as const,
        energy: "medium" as const,
        danceability: null,
        genres: [],
        tags: [],
      };

      const trackScores = [
        { trackId: "t1", claude: 0.8, math: 0.7, final: 0.75 },
        { trackId: "t2", claude: 0.6, math: 0.6, final: 0.6 },
        { trackId: "t3", claude: 0.9, math: 0.5, final: 0.7 },
      ];

      await playlistRepository.completeGeneration("p1", {
        vibeName: "Night Drive",
        vibeDescription: "late-night cruising",
        claudeTarget,
        mathTarget,
        generatedTrackIds: ["t1", "t2", "t3"],
        trackScores,
      });

      expect(updateTable).toHaveBeenCalledWith("playlist");
      expect(where).toHaveBeenCalledWith("id", "=", "p1");
      // Load-bearing: all recipe fields + status flip happen in the
      // same .set() so the row never ends up half-populated. Scores
      // are part of the same write so they can't drift out of sync
      // with `generatedTrackIds`.
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          vibeName: "Night Drive",
          vibeDescription: "late-night cruising",
          claudeTarget,
          mathTarget,
          generatedTrackIds: ["t1", "t2", "t3"],
          status: "PENDING",
        })
      );

      // Regression guard. `track_scores` is a JSONB column but
      // node-postgres serializes a bare JS Array as a PG array literal
      // (`{…}`) unless we force a `::jsonb` cast. Passing the raw
      // array through Kysely's `.set({ trackScores })` blows up at
      // query time with `invalid input syntax for type json`. The fix
      // wraps the value in a `sql` template fragment — so the value
      // the call site hands to `.set()` must NOT be a plain Array.
      const setCall = set.mock.calls[0]![0] as { trackScores: unknown };
      expect(Array.isArray(setCall.trackScores)).toBe(false);
      // And it should be a Kysely raw expression (`RawBuilder`) —
      // identifiable by `toOperationNode` on its prototype.
      expect(typeof (setCall.trackScores as { toOperationNode?: unknown })
        ?.toOperationNode).toBe("function");
    });
  });

  describe("updateTracks", () => {
    it("full-replaces generatedTrackIds and trackScores together", async () => {
      execute.mockResolvedValue([]);

      const trackScores = [
        { trackId: "t9", claude: 0.5, math: 0.5, final: 0.5 },
        { trackId: "t8", claude: 0.4, math: 0.6, final: 0.5 },
      ];

      await playlistRepository.updateTracks("p1", ["t9", "t8"], trackScores);

      expect(updateTable).toHaveBeenCalledWith("playlist");
      expect(where).toHaveBeenCalledWith("id", "=", "p1");
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          generatedTrackIds: ["t9", "t8"],
        })
      );
      // Same regression guard as `completeGeneration` — the scores
      // must go through a `::jsonb` cast, never as a raw JS Array.
      const setCall = set.mock.calls[0]![0] as { trackScores: unknown };
      expect(Array.isArray(setCall.trackScores)).toBe(false);
      expect(typeof (setCall.trackScores as { toOperationNode?: unknown })
        ?.toOperationNode).toBe("function");
    });
  });

  describe("appendTracks", () => {
    it("issues an update using array_cat for non-empty input", async () => {
      execute.mockResolvedValue([]);

      await playlistRepository.appendTracks(
        "p1",
        ["t10", "t11"],
        [
          { trackId: "t10", claude: 0.3, math: 0.7, final: 0.5 },
          { trackId: "t11", claude: 0.4, math: 0.8, final: 0.6 },
        ],
      );

      expect(updateTable).toHaveBeenCalledWith("playlist");
    });

    it("is a no-op on empty input", async () => {
      await playlistRepository.appendTracks("p1", [], []);

      expect(updateTable).not.toHaveBeenCalled();
    });
  });

  describe("markSaved", () => {
    it("sets spotifyPlaylistId and status=SAVED atomically in a single .set()", async () => {
      execute.mockResolvedValue([]);

      await playlistRepository.markSaved("p1", "spotify-xyz");

      expect(updateTable).toHaveBeenCalledWith("playlist");
      expect(where).toHaveBeenCalledWith("id", "=", "p1");
      // Load-bearing: the status ↔ spotifyPlaylistId invariant relies
      // on these two fields being written together. Pin that here so
      // a future refactor can't split them across two updates.
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          spotifyPlaylistId: "spotify-xyz",
          status: "SAVED",
        })
      );
    });
  });

  describe("setStatus", () => {
    it("flips status without touching spotifyPlaylistId", async () => {
      execute.mockResolvedValue([]);

      await playlistRepository.setStatus("p1", "GENERATING");

      expect(updateTable).toHaveBeenCalledWith("playlist");
      expect(where).toHaveBeenCalledWith("id", "=", "p1");
      // Load-bearing: must NOT touch spotifyPlaylistId — markSaved is
      // still the sole writer of that column paired with SAVED.
      const setArgs = set.mock.calls.at(-1)?.[0];
      expect(setArgs).toMatchObject({ status: "GENERATING" });
      expect(setArgs).not.toHaveProperty("spotifyPlaylistId");
    });
  });

  describe("setFailed", () => {
    it("flips status to FAILED and records error message in the same .set()", async () => {
      execute.mockResolvedValue([]);

      await playlistRepository.setFailed("p1", "Claude timed out");

      expect(updateTable).toHaveBeenCalledWith("playlist");
      expect(where).toHaveBeenCalledWith("id", "=", "p1");
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "FAILED",
          errorMessage: "Claude timed out",
        })
      );
    });
  });

  describe("delete", () => {
    it("hard-deletes the row", async () => {
      execute.mockResolvedValue([]);

      await playlistRepository.delete("p1");

      expect(deleteFrom).toHaveBeenCalledWith("playlist");
      expect(where).toHaveBeenCalledWith("id", "=", "p1");
    });
  });

  describe("findByIdWithRecipe", () => {
    it("returns the domain playlist with recipe fields", async () => {
      executeTakeFirst.mockResolvedValue(baseRow);

      const result = await playlistRepository.findByIdWithRecipe("p1");

      expect(result).not.toBeNull();
      expect(result!.claudeTarget).toEqual(baseRow.claudeTarget);
      expect(result!.mathTarget).toEqual(baseRow.mathTarget);
    });

    it("returns null when missing", async () => {
      executeTakeFirst.mockResolvedValue(undefined);

      const result = await playlistRepository.findByIdWithRecipe("p1");

      expect(result).toBeNull();
    });
  });

  describe("findByIdWithTracks", () => {
    it("resolves tracks in generatedTrackIds order", async () => {
      // findById
      executeTakeFirst.mockResolvedValueOnce({
        ...baseRow,
        generatedTrackIds: ["t1", "t2", "t3"],
      });
      // findByIdsWithDisplayFields — returned out of order to verify reorder
      execute.mockResolvedValueOnce([
        { id: "t2", artistsDisplay: "B" },
        { id: "t1", artistsDisplay: "A" },
        { id: "t3", artistsDisplay: "C" },
      ]);

      const result = await playlistRepository.findByIdWithTracks("p1");

      expect(result).not.toBeNull();
      expect(result!.tracks.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    });

    it("returns null when playlist not found", async () => {
      executeTakeFirst.mockResolvedValue(undefined);

      const result = await playlistRepository.findByIdWithTracks("p1");

      expect(result).toBeNull();
    });

    it("skips missing tracks and keeps the rest in order", async () => {
      executeTakeFirst.mockResolvedValueOnce({
        ...baseRow,
        generatedTrackIds: ["t1", "t2", "t3"],
      });
      execute.mockResolvedValueOnce([
        { id: "t1", artistsDisplay: "A" },
        { id: "t3", artistsDisplay: "C" },
      ]);

      const result = await playlistRepository.findByIdWithTracks("p1");

      expect(result!.tracks.map((t) => t.id)).toEqual(["t1", "t3"]);
    });
  });

  describe("findAllByUserSummary", () => {
    it("returns lightweight summaries ordered by createdAt DESC", async () => {
      execute.mockResolvedValue([
        {
          id: "p1",
          vibeName: "Night Drive",
          vibeDescription: "late",
          status: "SAVED",
          spotifyPlaylistId: "spotify-xyz",
          createdAt: new Date("2026-04-02"),
          trackCount: 25,
        },
      ]);

      const result = await playlistRepository.findAllByUserSummary("u1");

      expect(selectFrom).toHaveBeenCalledWith("playlist");
      expect(result).toEqual([
        {
          id: "p1",
          vibeName: "Night Drive",
          vibeDescription: "late",
          status: "SAVED",
          spotifyPlaylistId: "spotify-xyz",
          trackCount: 25,
          createdAt: new Date("2026-04-02"),
        },
      ]);
    });
  });
});
