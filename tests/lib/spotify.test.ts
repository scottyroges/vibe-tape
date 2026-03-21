// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapTrack, fetchLikedSongs } from "@/lib/spotify";

function makeSpotifyItem(overrides: {
  id?: string;
  name?: string;
  artists?: { name: string }[];
  albumName?: string;
  albumImages?: { url: string }[];
  addedAt?: string;
} = {}) {
  return {
    added_at: overrides.addedAt ?? "2024-01-15T10:30:00Z",
    track: {
      id: overrides.id ?? "track-1",
      name: overrides.name ?? "Test Song",
      artists: overrides.artists ?? [{ name: "Test Artist" }],
      album: {
        name: overrides.albumName ?? "Test Album",
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
      artist: "Test Artist",
      album: "Test Album",
      albumArtUrl: "https://img.spotify.com/album.jpg",
      addedAt: new Date("2024-01-15T10:30:00Z"),
    });
  });

  it("joins multiple artists with comma", () => {
    const item = makeSpotifyItem({
      artists: [{ name: "Artist A" }, { name: "Artist B" }, { name: "Artist C" }],
    });
    const result = mapTrack(item);

    expect(result.artist).toBe("Artist A, Artist B, Artist C");
  });

  it("returns null albumArtUrl when no images", () => {
    const item = makeSpotifyItem({ albumImages: [] });
    const result = mapTrack(item);

    expect(result.albumArtUrl).toBeNull();
  });
});

describe("fetchLikedSongs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches a single page of songs", async () => {
    const items = [makeSpotifyItem({ id: "s1" }), makeSpotifyItem({ id: "s2" })];
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockFetchResponse({ items, next: null })
    );

    const songs = await fetchLikedSongs("test-token");

    expect(songs).toHaveLength(2);
    expect(songs[0]!.spotifyId).toBe("s1");
    expect(songs[1]!.spotifyId).toBe("s2");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.spotify.com/v1/me/tracks?limit=50",
      { headers: { Authorization: "Bearer test-token" } }
    );
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

    const songs = await fetchLikedSongs("test-token");

    expect(songs).toHaveLength(2);
    expect(songs[0]!.spotifyId).toBe("s1");
    expect(songs[1]!.spotifyId).toBe("s2");
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

    const songs = await fetchLikedSongs("test-token");

    expect(songs).toHaveLength(1);
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
