type SpotifyLikedTrackItem = {
  added_at: string;
  track: {
    id: string;
    name: string;
    popularity: number;
    duration_ms: number;
    artists: { id: string; name: string }[];
    album: {
      name: string;
      release_date: string;
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
  artists: { spotifyId: string; name: string }[];
  album: string;
  albumArtUrl: string | null;
  spotifyPopularity: number;
  spotifyDurationMs: number;
  spotifyReleaseDate: string;
  likedAt: Date;
};

export function mapTrack(item: SpotifyLikedTrackItem): SpotifyLikedSong {
  return {
    spotifyId: item.track.id,
    name: item.track.name,
    artists: item.track.artists.map((a) => ({
      spotifyId: a.id,
      name: a.name,
    })),
    album: item.track.album.name,
    albumArtUrl: item.track.album.images[0]?.url ?? null,
    spotifyPopularity: item.track.popularity,
    spotifyDurationMs: item.track.duration_ms,
    spotifyReleaseDate: item.track.album.release_date,
    likedAt: new Date(item.added_at),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type FetchLikedSongsResult = {
  songs: SpotifyLikedSong[];
  nextUrl: string | null;
};

export async function fetchLikedSongs(
  accessToken: string,
  opts?: { startUrl?: string; maxTracks?: number }
): Promise<FetchLikedSongsResult> {
  const MAX_RATE_LIMIT_RETRIES = 3;
  const maxTracks = opts?.maxTracks ?? Infinity;
  const songs: SpotifyLikedSong[] = [];
  let url: string | null =
    opts?.startUrl ?? "https://api.spotify.com/v1/me/tracks?limit=50";
  let rateLimitRetries = 0;

  while (url && songs.length < maxTracks) {
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

  const truncated = maxTracks < Infinity ? songs.slice(0, maxTracks) : songs;
  return { songs: truncated, nextUrl: url };
}
