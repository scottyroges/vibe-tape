// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mockFetch);
vi.stubEnv("LASTFM_API_KEY", "test-key");

import {
  getArtistTopTags,
  getTrackTopTags,
  _resetThrottle,
} from "@/lib/lastfm";

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? "Not Found" : "OK",
    json: () => Promise.resolve(data),
  };
}

describe("getArtistTopTags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetThrottle();
  });

  it("returns filtered, sorted, lowercase tag names", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        toptags: {
          tag: [
            { name: "Rock", count: 100 },
            { name: "indie", count: 80 },
            { name: "seen live", count: 30 }, // below threshold
            { name: "Alternative", count: 90 },
            { name: "Post-Punk", count: 60 },
            { name: "britpop", count: 55 },
            { name: "guitar", count: 52 }, // 6th above threshold — capped
          ],
        },
      })
    );

    const tags = await getArtistTopTags("Radiohead");

    expect(tags).toEqual(["rock", "alternative", "indie", "post-punk", "britpop"]);
  });

  it("returns empty array on 404", async () => {
    mockFetch.mockResolvedValue(jsonResponse(null, 404));

    const tags = await getArtistTopTags("Unknown Artist");

    expect(tags).toEqual([]);
  });

  it("returns empty array when no tags", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ toptags: { tag: [] } })
    );

    const tags = await getArtistTopTags("New Artist");

    expect(tags).toEqual([]);
  });

  it("returns empty array on Last.fm error response", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ error: 6, message: "Artist not found" })
    );

    const tags = await getArtistTopTags("Nonexistent");

    expect(tags).toEqual([]);
  });

  it("handles single tag as object instead of array", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        toptags: {
          tag: { name: "Electronic", count: 200 },
        },
      })
    );

    const tags = await getArtistTopTags("Aphex Twin");

    expect(tags).toEqual(["electronic"]);
  });
});

describe("getTrackTopTags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetThrottle();
  });

  it("returns filtered tag names", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        toptags: {
          tag: [
            { name: "Alternative", count: 100 },
            { name: "rock", count: 75 },
          ],
        },
      })
    );

    const tags = await getTrackTopTags("Radiohead", "Creep");

    expect(tags).toEqual(["alternative", "rock"]);
  });

  it("returns empty array on 404", async () => {
    mockFetch.mockResolvedValue(jsonResponse(null, 404));

    const tags = await getTrackTopTags("Unknown", "Unknown Track");

    expect(tags).toEqual([]);
  });

  it("returns empty array when track not found", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ error: 6, message: "Track not found" })
    );

    const tags = await getTrackTopTags("Artist", "Nonexistent Track");

    expect(tags).toEqual([]);
  });
});

describe("rate limiter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetThrottle();
  });

  it("throttles rapid calls to at least 200ms apart", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ toptags: { tag: [] } })
    );

    const start = Date.now();
    await getArtistTopTags("Artist 1");
    await getArtistTopTags("Artist 2");
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(190); // 200ms with small tolerance
  });
});
