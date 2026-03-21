type SpotifyLikedTrackItem = {
  added_at: string;
  track: {
    id: string;
    name: string;
    artists: { name: string }[];
    album: {
      name: string;
      images: { url: string }[];
    };
  };
};

type SpotifyPaginatedResponse = {
  items: SpotifyLikedTrackItem[];
  next: string | null;
};

export type SpotifyLikedSong = {
  spotifyId: string;
  name: string;
  artist: string;
  album: string;
  albumArtUrl: string | null;
  addedAt: Date;
};

export function mapTrack(item: SpotifyLikedTrackItem): SpotifyLikedSong {
  return {
    spotifyId: item.track.id,
    name: item.track.name,
    artist: item.track.artists.map((a) => a.name).join(", "),
    album: item.track.album.name,
    albumArtUrl: item.track.album.images[0]?.url ?? null,
    addedAt: new Date(item.added_at),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchLikedSongs(
  accessToken: string
): Promise<SpotifyLikedSong[]> {
  const MAX_RATE_LIMIT_RETRIES = 3;
  const songs: SpotifyLikedSong[] = [];
  let url: string | null = "https://api.spotify.com/v1/me/tracks?limit=50";
  let rateLimitRetries = 0;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 429) {
      rateLimitRetries++;
      if (rateLimitRetries > MAX_RATE_LIMIT_RETRIES) {
        throw new Error("Spotify rate limit: max retries exceeded");
      }
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10);
      await sleep(retryAfter * 1000);
      continue;
    }

    rateLimitRetries = 0;

    if (!res.ok) {
      throw new Error(
        `Spotify API error: ${res.status} ${res.statusText}`
      );
    }

    const data: SpotifyPaginatedResponse = await res.json();
    songs.push(...data.items.map(mapTrack));
    url = data.next;
  }

  return songs;
}
