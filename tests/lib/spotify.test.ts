// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapTrack, fetchLikedSongs } from "@/lib/spotify";

function makeSpotifyItem(overrides: {
  id?: string;
  name?: string;
  artists?: { id: string; name: string }[];
  albumName?: string;
  albumImages?: { url: string }[];
  releaseDate?: string;
  popularity?: number;
  durationMs?: number;
  likedAt?: string;
} = {}) {
  return {
    added_at: overrides.likedAt ?? "2024-01-15T10:30:00Z",
    track: {
      id: overrides.id ?? "track-1",
      name: overrides.name ?? "Test Song",
      popularity: overrides.popularity ?? 75,
      duration_ms: overrides.durationMs ?? 210000,
      artists: overrides.artists ?? [{ id: "artist-1", name: "Test Artist" }],
      album: {
        name: overrides.albumName ?? "Test Album",
        release_date: overrides.releaseDate ?? "2024-01-01",
        images: overrides.albumImages ?? [{ url: "https://img.spotify.com/album.jpg" }],
      },
    },
  };
}

function mockFetchResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 429 ? "Too Many Requests" : "OK",
    headers: new Headers(headers),
    json: async () => body,
  } as Response;
}

describe("mapTrack", () => {
  it("maps a standard track correctly", () => {
    const item = makeSpotifyItem();
    const result = mapTrack(item);

    expect(result).toEqual({
      spotifyId: "track-1",
      name: "Test Song",
      artists: [{ spotifyId: "artist-1", name: "Test Artist" }],
      album: "Test Album",
      albumArtUrl: "https://img.spotify.com/album.jpg",
      spotifyPopularity: 75,
      spotifyDurationMs: 210000,
      spotifyReleaseDate: "2024-01-01",
      likedAt: new Date("2024-01-15T10:30:00Z"),
    });
  });

  it("returns structured artists array for multiple artists", () => {
    const item = makeSpotifyItem({
      artists: [
        { id: "a1", name: "Artist A" },
        { id: "a2", name: "Artist B" },
        { id: "a3", name: "Artist C" },
      ],
    });
    const result = mapTrack(item);

    expect(result.artists).toEqual([
      { spotifyId: "a1", name: "Artist A" },
      { spotifyId: "a2", name: "Artist B" },
      { spotifyId: "a3", name: "Artist C" },
    ]);
  });

  it("returns null albumArtUrl when no images", () => {
    const item = makeSpotifyItem({ albumImages: [] });
    const result = mapTrack(item);

    expect(result.albumArtUrl).toBeNull();
  });

  it("maps popularity, duration, and release date", () => {
    const item = makeSpotifyItem({
      popularity: 42,
      durationMs: 300000,
      releaseDate: "1995-06-15",
    });
    const result = mapTrack(item);

    expect(result.spotifyPopularity).toBe(42);
    expect(result.spotifyDurationMs).toBe(300000);
    expect(result.spotifyReleaseDate).toBe("1995-06-15");
  });
});

describe("fetchLikedSongs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns { songs, nextUrl } shape", async () => {
    const items = [makeSpotifyItem({ id: "s1" }), makeSpotifyItem({ id: "s2" })];
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockFetchResponse({ items, next: null })
    );

    const result = await fetchLikedSongs("test-token");

    expect(result.songs).toHaveLength(2);
    expect(result.songs[0]!.spotifyId).toBe("s1");
    expect(result.nextUrl).toBeNull();
  });

  it("uses default URL when no startUrl provided", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockFetchResponse({ items: [], next: null })
    );

    await fetchLikedSongs("test-token");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.spotify.com/v1/me/tracks?limit=50",
      { headers: { Authorization: "Bearer test-token" } }
    );
  });

  it("uses startUrl when provided", async () => {
    const startUrl = "https://api.spotify.com/v1/me/tracks?offset=100&limit=50";
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockFetchResponse({ items: [], next: null })
    );

    await fetchLikedSongs("test-token", { startUrl });

    expect(global.fetch).toHaveBeenCalledWith(
      startUrl,
      { headers: { Authorization: "Bearer test-token" } }
    );
  });

  it("stops after maxTracks and returns nextUrl", async () => {
    // Each page has 50 items, maxTracks is 100 — should fetch 2 pages then stop
    const page1 = Array.from({ length: 50 }, (_, i) => makeSpotifyItem({ id: `s${i}` }));
    const page2 = Array.from({ length: 50 }, (_, i) => makeSpotifyItem({ id: `s${50 + i}` }));
    const page3Url = "https://api.spotify.com/v1/me/tracks?offset=100&limit=50";

    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockFetchResponse({
          items: page1,
          next: "https://api.spotify.com/v1/me/tracks?offset=50&limit=50",
        })
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ items: page2, next: page3Url })
      );

    const result = await fetchLikedSongs("test-token", { maxTracks: 100 });

    expect(result.songs).toHaveLength(100);
    expect(result.nextUrl).toBe(page3Url);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("paginates through multiple pages", async () => {
    const page1 = [makeSpotifyItem({ id: "s1" })];
    const page2 = [makeSpotifyItem({ id: "s2" })];

    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockFetchResponse({ items: page1, next: "https://api.spotify.com/v1/me/tracks?offset=50&limit=50" })
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ items: page2, next: null })
      );

    const result = await fetchLikedSongs("test-token");

    expect(result.songs).toHaveLength(2);
    expect(result.nextUrl).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 with Retry-After header", async () => {
    const items = [makeSpotifyItem({ id: "s1" })];

    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockFetchResponse(null, 429, { "Retry-After": "1" })
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ items, next: null })
      );

    const result = await fetchLikedSongs("test-token");

    expect(result.songs).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws after exceeding max rate limit retries", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    for (let i = 0; i < 4; i++) {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(null, 429, { "Retry-After": "0" })
      );
    }

    await expect(fetchLikedSongs("test-token")).rejects.toThrow(
      "Spotify rate limit: max retries exceeded"
    );
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it("throws on non-2xx error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockFetchResponse(null, 500)
    );

    await expect(fetchLikedSongs("test-token")).rejects.toThrow(
      "Spotify API error: 500"
    );
  });
});
