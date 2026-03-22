import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapTrack, fetchLikedSongs } from "./spotify";

describe("mapTrack", () => {
  it("maps a Spotify track item to SpotifyLikedSong", () => {
    const item = {
      added_at: "2024-01-15T10:30:00Z",
      track: {
        id: "abc123",
        name: "Test Song",
        artists: [{ name: "Artist One" }],
        album: {
          name: "Test Album",
          images: [{ url: "https://img.spotify.com/cover.jpg" }],
        },
      },
    };

    const result = mapTrack(item);

    expect(result).toEqual({
      spotifyId: "abc123",
      name: "Test Song",
      artist: "Artist One",
      album: "Test Album",
      albumArtUrl: "https://img.spotify.com/cover.jpg",
      likedAt: new Date("2024-01-15T10:30:00Z"),
    });
  });

  it("joins multiple artist names with comma", () => {
    const item = {
      added_at: "2024-01-01T00:00:00Z",
      track: {
        id: "xyz",
        name: "Collab",
        artists: [{ name: "A" }, { name: "B" }, { name: "C" }],
        album: { name: "Album", images: [{ url: "https://img.com/1.jpg" }] },
      },
    };

    expect(mapTrack(item).artist).toBe("A, B, C");
  });

  it("returns null albumArtUrl when no images", () => {
    const item = {
      added_at: "2024-01-01T00:00:00Z",
      track: {
        id: "noimg",
        name: "No Cover",
        artists: [{ name: "Artist" }],
        album: { name: "Album", images: [] },
      },
    };

    expect(mapTrack(item).albumArtUrl).toBeNull();
  });

  it("parses added_at string into Date", () => {
    const item = {
      added_at: "2023-06-15T12:00:00Z",
      track: {
        id: "date",
        name: "Date Test",
        artists: [{ name: "Artist" }],
        album: { name: "Album", images: [] },
      },
    };

    const result = mapTrack(item);
    expect(result.likedAt).toBeInstanceOf(Date);
    expect(result.likedAt.toISOString()).toBe("2023-06-15T12:00:00.000Z");
  });
});

describe("fetchLikedSongs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("paginates through multiple pages", async () => {
    const page1 = {
      items: [
        {
          added_at: "2024-01-01T00:00:00Z",
          track: {
            id: "t1",
            name: "Song 1",
            artists: [{ name: "A" }],
            album: { name: "Alb", images: [] },
          },
        },
      ],
      next: "https://api.spotify.com/v1/me/tracks?offset=50&limit=50",
    };
    const page2 = {
      items: [
        {
          added_at: "2024-01-02T00:00:00Z",
          track: {
            id: "t2",
            name: "Song 2",
            artists: [{ name: "B" }],
            album: { name: "Alb2", images: [] },
          },
        },
      ],
      next: null,
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page1), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page2), { status: 200 })
      );

    const songs = await fetchLikedSongs("test-token");

    expect(songs).toHaveLength(2);
    expect(songs[0]!.spotifyId).toBe("t1");
    expect(songs[1]!.spotifyId).toBe("t2");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.spotify.com/v1/me/tracks?limit=50",
      { headers: { Authorization: "Bearer test-token" } }
    );
  });

  it("retries on 429 with retry-after header", async () => {
    const rateLimitResponse = new Response(null, {
      status: 429,
      headers: { "Retry-After": "0" },
    });
    const successResponse = new Response(
      JSON.stringify({
        items: [
          {
            added_at: "2024-01-01T00:00:00Z",
            track: {
              id: "t1",
              name: "Song",
              artists: [{ name: "A" }],
              album: { name: "Alb", images: [] },
            },
          },
        ],
        next: null,
      }),
      { status: 200 }
    );

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy
      .mockResolvedValueOnce(rateLimitResponse)
      .mockResolvedValueOnce(successResponse);

    const songs = await fetchLikedSongs("token");

    expect(songs).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws after max rate limit retries", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { "Retry-After": "0" },
      })
    );

    await expect(fetchLikedSongs("token")).rejects.toThrow(
      "Spotify rate limit: max retries exceeded"
    );
  });

  it("throws on non-ok responses", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 500, statusText: "Internal Server Error" })
    );

    await expect(fetchLikedSongs("token")).rejects.toThrow(
      "Spotify API error: 500 Internal Server Error"
    );
  });
});
