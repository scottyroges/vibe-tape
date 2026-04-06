// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mapTrack,
  fetchLikedSongs,
  fetchArtists,
  createPlaylist,
  addTracksToPlaylist,
  removeTracksFromPlaylist,
  replacePlaylistTracks,
} from "@/lib/spotify";

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

describe("fetchArtists", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches genres for a batch of artists", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockFetchResponse({
        artists: [
          { id: "a1", genres: ["pop", "rock"] },
          { id: "a2", genres: ["jazz"] },
        ],
      })
    );

    const result = await fetchArtists("test-token", ["a1", "a2"]);

    expect(result.get("a1")).toEqual(["pop", "rock"]);
    expect(result.get("a2")).toEqual(["jazz"]);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.spotify.com/v1/artists?ids=a1,a2",
      { headers: { Authorization: "Bearer test-token" } }
    );
  });

  it("batches IDs into groups of 50", async () => {
    const ids = Array.from({ length: 75 }, (_, i) => `a${i}`);
    const batch1Artists = ids.slice(0, 50).map((id) => ({ id, genres: [] }));
    const batch2Artists = ids.slice(50).map((id) => ({ id, genres: [] }));

    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(mockFetchResponse({ artists: batch1Artists }))
      .mockResolvedValueOnce(mockFetchResponse({ artists: batch2Artists }));

    const result = await fetchArtists("test-token", ids);

    expect(result.size).toBe(75);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("handles null artists in response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockFetchResponse({
        artists: [
          { id: "a1", genres: ["pop"] },
          null,
        ],
      })
    );

    const result = await fetchArtists("test-token", ["a1", "a2"]);

    expect(result.size).toBe(1);
    expect(result.get("a1")).toEqual(["pop"]);
    expect(result.has("a2")).toBe(false);
  });

  it("returns empty map for empty input", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");

    const result = await fetchArtists("test-token", []);

    expect(result.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("retries on 429", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockFetchResponse(null, 429, { "Retry-After": "0" })
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          artists: [{ id: "a1", genres: ["indie"] }],
        })
      );

    const result = await fetchArtists("test-token", ["a1"]);

    expect(result.get("a1")).toEqual(["indie"]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws on non-2xx error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockFetchResponse(null, 500)
    );

    await expect(fetchArtists("test-token", ["a1"])).rejects.toThrow(
      "Spotify API error: 500"
    );
  });
});

describe("createPlaylist", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to /v1/me/playlists with the right body and returns the id", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockFetchResponse({ id: "playlist-123" })
    );

    const id = await createPlaylist("test-token", {
      name: "Rainy Sunday",
      description: "A mellow vibe for a slow morning.",
      public: false,
    });

    expect(id).toBe("playlist-123");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(url).toBe("https://api.spotify.com/v1/me/playlists");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body)).toEqual({
      name: "Rainy Sunday",
      description: "A mellow vibe for a slow morning.",
      public: false,
    });
  });

  it("throws on non-2xx error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockFetchResponse(null, 500)
    );

    await expect(
      createPlaylist("test-token", {
        name: "x",
        description: "y",
        public: false,
      })
    ).rejects.toThrow("Spotify API error: 500");
  });
});

describe("addTracksToPlaylist", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs a single batch when uris ≤ 100", async () => {
    const uris = Array.from(
      { length: 42 },
      (_, i) => `spotify:track:t${i}`
    );
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockFetchResponse({ snapshot_id: "s1" })
    );

    await addTracksToPlaylist("test-token", "pl-1", uris);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(url).toBe(
      "https://api.spotify.com/v1/playlists/pl-1/items"
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ uris });
  });

  it("batches at 100 URIs per call", async () => {
    const uris = Array.from(
      { length: 250 },
      (_, i) => `spotify:track:t${i}`
    );
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(mockFetchResponse({ snapshot_id: "s" }));

    await addTracksToPlaylist("test-token", "pl-1", uris);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const bodies = fetchSpy.mock.calls.map(
      (call) => JSON.parse((call[1] as RequestInit).body as string).uris as string[]
    );
    expect(bodies[0]).toHaveLength(100);
    expect(bodies[1]).toHaveLength(100);
    expect(bodies[2]).toHaveLength(50);
    expect(bodies.flat()).toEqual(uris);
  });

  it("is a no-op for empty uris", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");

    await addTracksToPlaylist("test-token", "pl-1", []);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws on non-2xx error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockFetchResponse(null, 500)
    );

    await expect(
      addTracksToPlaylist("test-token", "pl-1", ["spotify:track:a"])
    ).rejects.toThrow("Spotify API error: 500");
  });
});

describe("replacePlaylistTracks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("PUTs the full uri list in a single call", async () => {
    const uris = Array.from(
      { length: 100 },
      (_, i) => `spotify:track:t${i}`
    );
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockFetchResponse({ snapshot_id: "s1" })
    );

    await replacePlaylistTracks("test-token", "pl-1", uris);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(url).toBe(
      "https://api.spotify.com/v1/playlists/pl-1/items"
    );
    expect(init.method).toBe("PUT");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body)).toEqual({ uris });
  });

  it("throws on non-2xx error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockFetchResponse(null, 500)
    );

    await expect(
      replacePlaylistTracks("test-token", "pl-1", ["spotify:track:a"])
    ).rejects.toThrow("Spotify API error: 500");
  });
});

describe("removeTracksFromPlaylist", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("DELETEs with a { tracks: [{ uri }, …] } body", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockFetchResponse({ snapshot_id: "s1" })
    );

    await removeTracksFromPlaylist("test-token", "pl-1", [
      "spotify:track:a",
      "spotify:track:b",
    ]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(url).toBe(
      "https://api.spotify.com/v1/playlists/pl-1/items"
    );
    expect(init.method).toBe("DELETE");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body)).toEqual({
      tracks: [
        { uri: "spotify:track:a" },
        { uri: "spotify:track:b" },
      ],
    });
  });

  it("no-ops on an empty uris array", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");

    await removeTracksFromPlaylist("test-token", "pl-1", []);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("batches at 100 URIs per call", async () => {
    const uris = Array.from(
      { length: 150 },
      (_, i) => `spotify:track:t${i}`,
    );
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(mockFetchResponse({ snapshot_id: "s1" }))
      .mockResolvedValueOnce(mockFetchResponse({ snapshot_id: "s2" }));

    await removeTracksFromPlaylist("test-token", "pl-1", uris);

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body);
    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body);
    expect(firstBody.tracks).toHaveLength(100);
    expect(secondBody.tracks).toHaveLength(50);
  });

  it("throws on non-2xx error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockFetchResponse(null, 500)
    );

    await expect(
      removeTracksFromPlaylist("test-token", "pl-1", ["spotify:track:a"])
    ).rejects.toThrow("Spotify API error: 500");
  });
});
