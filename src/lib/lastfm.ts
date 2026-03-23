const LASTFM_BASE_URL = "https://ws.audioscrobbler.com/2.0/";
const MIN_TAG_COUNT = 50;
const MAX_TAGS = 5;
const THROTTLE_MS = 200;

let lastCallTime = 0;

// Assumes sequential calls — not safe for concurrent use (e.g. Promise.all)
async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < THROTTLE_MS) {
    await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS - elapsed));
  }
  lastCallTime = Date.now();
}

function getApiKey(): string {
  const key = process.env.LASTFM_API_KEY;
  if (!key) throw new Error("LASTFM_API_KEY is not set");
  return key;
}

type LastfmTag = { name: string; count: number };

function extractTags(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const root = data as Record<string, unknown>;

  // Last.fm returns errors as 200 with an "error" field
  if ("error" in root) return [];

  const toptags = root.toptags as Record<string, unknown> | undefined;
  if (!toptags) return [];

  let tags: LastfmTag[];
  const rawTag = toptags.tag;

  // Last.fm returns a single tag as an object instead of an array
  if (Array.isArray(rawTag)) {
    tags = rawTag as LastfmTag[];
  } else if (rawTag && typeof rawTag === "object") {
    tags = [rawTag as LastfmTag];
  } else {
    return [];
  }

  return tags
    .map((t) => ({ name: t.name, count: Number(t.count) }))
    .filter((t) => !isNaN(t.count) && t.count >= MIN_TAG_COUNT)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TAGS)
    .map((t) => t.name.toLowerCase());
}

const MAX_RETRIES = 2;

async function lastfmFetch(params: Record<string, string>): Promise<unknown> {
  const url = new URL(LASTFM_BASE_URL);
  url.searchParams.set("api_key", getApiKey());
  url.searchParams.set("format", "json");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await throttle();

    const response = await fetch(url.toString());

    if (response.status === 404) return null;
    if (response.status >= 500 && attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    if (!response.ok) {
      throw new Error(`Last.fm API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }
}

export async function getArtistTopTags(artist: string): Promise<string[]> {
  const data = await lastfmFetch({
    method: "artist.getTopTags",
    artist,
  });
  if (!data) return [];
  return extractTags(data);
}

export async function getTrackTopTags(
  artist: string,
  track: string
): Promise<string[]> {
  const data = await lastfmFetch({
    method: "track.getTopTags",
    artist,
    track,
  });
  if (!data) return [];
  return extractTags(data);
}

/** Reset throttle state — for testing only */
export function _resetThrottle(): void {
  lastCallTime = 0;
}
