import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockArtistFindStale,
  mockArtistUpdateLastfmTags,
  mockArtistSetEnrichmentVersion,
  mockTrackFindStaleWithPrimaryArtist,
  mockTrackUpdateLastfmTags,
  mockTrackSetEnrichmentVersion,
  mockGetArtistTopTags,
  mockGetTrackTopTags,
} = vi.hoisted(() => ({
  mockArtistFindStale: vi.fn(),
  mockArtistUpdateLastfmTags: vi.fn(),
  mockArtistSetEnrichmentVersion: vi.fn(),
  mockTrackFindStaleWithPrimaryArtist: vi.fn(),
  mockTrackUpdateLastfmTags: vi.fn(),
  mockTrackSetEnrichmentVersion: vi.fn(),
  mockGetArtistTopTags: vi.fn(),
  mockGetTrackTopTags: vi.fn(),
}));

vi.mock("@/lib/lastfm", () => ({
  getArtistTopTags: mockGetArtistTopTags,
  getTrackTopTags: mockGetTrackTopTags,
}));

vi.mock("@/lib/enrichment", () => ({
  LASTFM_ENRICHMENT_VERSION: 1,
}));

vi.mock("@/repositories/artist.repository", () => ({
  artistRepository: {
    findStale: mockArtistFindStale,
    updateLastfmTags: mockArtistUpdateLastfmTags,
    setEnrichmentVersion: mockArtistSetEnrichmentVersion,
  },
}));

vi.mock("@/repositories/track.repository", () => ({
  trackRepository: {
    findStaleWithPrimaryArtist: mockTrackFindStaleWithPrimaryArtist,
    updateLastfmTags: mockTrackUpdateLastfmTags,
    setEnrichmentVersion: mockTrackSetEnrichmentVersion,
  },
}));

vi.mock("@/lib/inngest", () => ({
  inngest: {
    createFunction: vi.fn(
      (opts: Record<string, unknown>, handler: (...args: unknown[]) => unknown) => {
        return { handler, opts };
      }
    ),
  },
}));

import { enrichLastfm } from "@/inngest/functions/enrich-lastfm";

function createMockStep() {
  return {
    run: vi.fn(
      async (_name: string, fn: () => Promise<unknown>) => fn()
    ),
  };
}

function setupDefaultMocks() {
  mockArtistFindStale.mockResolvedValue([]);
  mockArtistUpdateLastfmTags.mockResolvedValue(undefined);
  mockArtistSetEnrichmentVersion.mockResolvedValue(0);
  mockTrackFindStaleWithPrimaryArtist.mockResolvedValue([]);
  mockTrackUpdateLastfmTags.mockResolvedValue(undefined);
  mockTrackSetEnrichmentVersion.mockResolvedValue(0);
  mockGetArtistTopTags.mockResolvedValue([]);
  mockGetTrackTopTags.mockResolvedValue([]);
}

describe("enrichLastfm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  const { handler, opts } = enrichLastfm as unknown as {
    handler: (...args: unknown[]) => Promise<{ artistsProcessed: number; tracksProcessed: number }>;
    opts: Record<string, unknown>;
  };

  it("is configured with global concurrency of 1", () => {
    expect(opts.concurrency).toEqual([{ limit: 1 }]);
  });

  it("has event and cron triggers", () => {
    expect(opts.triggers).toEqual([
      { event: "enrichment/lastfm.requested" },
      { cron: "0 0 * * *" },
    ]);
  });

  it("runs all steps in correct order when no stale entities", async () => {
    const step = createMockStep();
    const result = await handler({ step });

    expect(result).toEqual({ artistsProcessed: 0, tracksProcessed: 0 });

    const stepNames = step.run.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(stepNames).toEqual([
      "enrich-artists/lastfm-tags-0",
      "enrich-artists/set-lastfm-version-0",
      "enrich-tracks/lastfm-tags-0",
      "enrich-tracks/set-lastfm-version-0",
    ]);
  });

  it("enriches artists with Last.fm tags", async () => {
    mockArtistFindStale.mockResolvedValueOnce([
      { id: "a1", spotifyId: "sa1", name: "Radiohead" },
      { id: "a2", spotifyId: "sa2", name: "Aphex Twin" },
    ]);

    mockGetArtistTopTags
      .mockResolvedValueOnce(["rock", "alternative", "indie"])
      .mockResolvedValueOnce(["electronic", "ambient"]);

    const step = createMockStep();
    await handler({ step });

    expect(mockGetArtistTopTags).toHaveBeenCalledWith("Radiohead");
    expect(mockGetArtistTopTags).toHaveBeenCalledWith("Aphex Twin");
    expect(mockArtistUpdateLastfmTags).toHaveBeenCalledWith([
      { id: "a1", tags: ["rock", "alternative", "indie"] },
      { id: "a2", tags: ["electronic", "ambient"] },
    ]);
  });

  it("enriches tracks with Last.fm tags", async () => {
    mockTrackFindStaleWithPrimaryArtist.mockResolvedValueOnce([
      { id: "t1", name: "Creep", artist: "Radiohead" },
      { id: "t2", name: "Windowlicker", artist: "Aphex Twin" },
    ]);

    mockGetTrackTopTags
      .mockResolvedValueOnce(["alternative", "rock"])
      .mockResolvedValueOnce(["electronic"]);

    const step = createMockStep();
    await handler({ step });

    expect(mockGetTrackTopTags).toHaveBeenCalledWith("Radiohead", "Creep");
    expect(mockGetTrackTopTags).toHaveBeenCalledWith("Aphex Twin", "Windowlicker");
    expect(mockTrackUpdateLastfmTags).toHaveBeenCalledWith([
      { id: "t1", tags: ["alternative", "rock"] },
      { id: "t2", tags: ["electronic"] },
    ]);
  });

  it("skips artists where Last.fm returns empty tags", async () => {
    mockArtistFindStale.mockResolvedValueOnce([
      { id: "a1", spotifyId: "sa1", name: "Known Artist" },
      { id: "a2", spotifyId: "sa2", name: "Unknown Artist" },
    ]);

    mockGetArtistTopTags
      .mockResolvedValueOnce(["rock"])
      .mockResolvedValueOnce([]);

    const step = createMockStep();
    await handler({ step });

    expect(mockArtistUpdateLastfmTags).toHaveBeenCalledWith([
      { id: "a1", tags: ["rock"] },
    ]);
  });

  it("skips tracks where Last.fm returns empty tags", async () => {
    mockTrackFindStaleWithPrimaryArtist.mockResolvedValueOnce([
      { id: "t1", name: "Known Track", artist: "Artist" },
      { id: "t2", name: "Unknown Track", artist: "Artist" },
    ]);

    mockGetTrackTopTags
      .mockResolvedValueOnce(["rock"])
      .mockResolvedValueOnce([]);

    const step = createMockStep();
    await handler({ step });

    expect(mockTrackUpdateLastfmTags).toHaveBeenCalledWith([
      { id: "t1", tags: ["rock"] },
    ]);
  });

  it("continues processing when one artist Last.fm call fails", async () => {
    mockArtistFindStale.mockResolvedValueOnce([
      { id: "a1", spotifyId: "sa1", name: "Failing Artist" },
      { id: "a2", spotifyId: "sa2", name: "Good Artist" },
    ]);

    mockGetArtistTopTags
      .mockRejectedValueOnce(new Error("Last.fm API error"))
      .mockResolvedValueOnce(["rock"]);

    const step = createMockStep();
    await handler({ step });

    expect(mockArtistUpdateLastfmTags).toHaveBeenCalledWith([
      { id: "a2", tags: ["rock"] },
    ]);
  });

  it("continues processing when one track Last.fm call fails", async () => {
    mockTrackFindStaleWithPrimaryArtist.mockResolvedValueOnce([
      { id: "t1", name: "Failing Track", artist: "Artist" },
      { id: "t2", name: "Good Track", artist: "Artist" },
    ]);

    mockGetTrackTopTags
      .mockRejectedValueOnce(new Error("Last.fm API error"))
      .mockResolvedValueOnce(["electronic"]);

    const step = createMockStep();
    await handler({ step });

    expect(mockTrackUpdateLastfmTags).toHaveBeenCalledWith([
      { id: "t2", tags: ["electronic"] },
    ]);
  });

  it("chunks artist enrichment at 200 boundary", async () => {
    const staleArtists = Array.from({ length: 200 }, (_, i) => ({
      id: `a${i}`,
      spotifyId: `sa${i}`,
      name: `Artist ${i}`,
    }));
    mockArtistFindStale
      .mockResolvedValueOnce(staleArtists)
      .mockResolvedValueOnce([]);

    const step = createMockStep();
    await handler({ step });

    const stepNames = step.run.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(stepNames).toContain("enrich-artists/lastfm-tags-0");
    expect(stepNames).toContain("enrich-artists/lastfm-tags-200");
  });

  it("chunks track enrichment at 200 boundary", async () => {
    const staleTracks = Array.from({ length: 200 }, (_, i) => ({
      id: `t${i}`,
      name: `Song ${i}`,
      artist: `Artist ${i}`,
    }));
    mockTrackFindStaleWithPrimaryArtist
      .mockResolvedValueOnce(staleTracks)
      .mockResolvedValueOnce([]);

    const step = createMockStep();
    await handler({ step });

    const stepNames = step.run.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(stepNames).toContain("enrich-tracks/lastfm-tags-0");
    expect(stepNames).toContain("enrich-tracks/lastfm-tags-200");
  });

  it("returns counts of processed entities", async () => {
    mockArtistFindStale.mockResolvedValueOnce([
      { id: "a1", spotifyId: "sa1", name: "Artist 1" },
    ]);
    mockTrackFindStaleWithPrimaryArtist.mockResolvedValueOnce([
      { id: "t1", name: "Track 1", artist: "Artist 1" },
      { id: "t2", name: "Track 2", artist: "Artist 1" },
    ]);

    const step = createMockStep();
    const result = await handler({ step });

    expect(result).toEqual({ artistsProcessed: 1, tracksProcessed: 2 });
  });
});
