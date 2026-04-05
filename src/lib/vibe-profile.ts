/**
 * Vibe profile derivation — pure function that merges and normalizes raw
 * enrichment data from Claude, Spotify, and Last.fm into the canonical
 * query surface used by playlist generation.
 *
 * See: .personal/docs/plans/active/vibe-profile-derivation.md
 */

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type CanonicalMood =
  | "uplifting"
  | "energetic"
  | "aggressive"
  | "melancholic"
  | "romantic"
  | "nostalgic"
  | "dark"
  | "dreamy"
  | "playful"
  | "confident"
  | "peaceful";

export type VibeProfile = {
  mood: CanonicalMood | null;
  energy: "low" | "medium" | "high" | null;
  danceability: "low" | "medium" | "high" | null;
  genres: string[];
  tags: string[];
};

export type DeriveVibeProfileInput = {
  claude: {
    mood: string | null;
    energy: string | null;
    danceability: string | null;
    vibeTags: string[];
  } | null;
  trackSpotify: { derivedEra: string | null } | null;
  trackLastfm: { tags: string[] } | null;
  artistLastfmTags: string[];
  artistNames: string[];
};

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

export const MAX_GENRES = 8;
export const MAX_TAGS = 12;

/**
 * Maps observed tag variants to canonical form.
 *
 * Canonical form rules:
 * - Multi-word terms use hyphens: alternative-rock, pop-punk, hip-hop
 * - Single-word compounds stay unhyphenated: synthpop, britpop, shoegaze
 * - Terms with punctuation preserve it: r&b (not r-and-b)
 * - 1900s decades use short form: 80s, 90s
 * - 2000s+ decades stay long form: 2000s, 2010s, 2020s
 */
const SYNONYMS: Record<string, string> = {
  // hip-hop family
  "hip hop": "hip-hop",
  hiphop: "hip-hop",
  "trip hop": "trip-hop",
  // r&b
  rnb: "r&b",
  "r and b": "r&b",
  "r & b": "r&b",
  // rock subgenres
  "alternative rock": "alternative-rock",
  "indie rock": "indie-rock",
  "indie pop": "indie-pop",
  "pop punk": "pop-punk",
  "pop rock": "pop-rock",
  "punk rock": "punk-rock",
  "hard rock": "hard-rock",
  "classic rock": "classic-rock",
  "progressive rock": "progressive-rock",
  "psychedelic rock": "psychedelic-rock",
  "garage rock": "garage-rock",
  "glam rock": "glam-rock",
  "stoner rock": "stoner-rock",
  "rock and roll": "rock-and-roll",
  "rock & roll": "rock-and-roll",
  // metal
  "nu metal": "nu-metal",
  "heavy metal": "heavy-metal",
  "thrash metal": "thrash-metal",
  "death metal": "death-metal",
  "alternative metal": "alternative-metal",
  "doom metal": "doom-metal",
  "power metal": "power-metal",
  "black metal": "black-metal",
  // post- family
  "post punk": "post-punk",
  "post-punk revival": "post-punk",
  "post hardcore": "post-hardcore",
  "post rock": "post-rock",
  // other
  "new wave": "new-wave",
  "synth pop": "synthpop",
  "doo wop": "doo-wop",
  "drum and bass": "drum-and-bass",
  "drum n bass": "drum-and-bass",
  dnb: "drum-and-bass",
  "lo fi": "lo-fi",
  lofi: "lo-fi",
  // decades — long form for 1900s collapses to short form; 2000s+ stays long
  "1950s": "50s",
  "1960s": "60s",
  "1970s": "70s",
  "1980s": "80s",
  "1990s": "90s",
  "early-2000s": "2000s",
};

const IGNORE: Set<string> = new Set([
  "love",
  "cover",
  "cult",
  "party",
  "favorite",
  "favorites",
  "favourite",
  "favourites",
  "female vocalists",
  "male vocalists",
  "seen live",
  "awesome",
  "best",
  "amazing",
  "beautiful",
  "chill",
  "favorite songs",
  "my music",
  "good",
  "great",
  "soundtrack",
  "vocal",
  "vocals",
  "singer-songwriter",
  "singer songwriter",
]);

const GENRE_VOCAB: Set<string> = new Set([
  // top-level
  "rock",
  "pop",
  "hip-hop",
  "rap",
  "electronic",
  "soul",
  "r&b",
  "jazz",
  "folk",
  "country",
  "blues",
  "metal",
  "punk",
  "indie",
  "alternative",
  "dance",
  "funk",
  "disco",
  "reggae",
  "latin",
  "classical",
  "gospel",
  "world",
  // rock subgenres
  "alternative-rock",
  "classic-rock",
  "hard-rock",
  "indie-rock",
  "pop-rock",
  "punk-rock",
  "progressive-rock",
  "psychedelic-rock",
  "garage-rock",
  "glam-rock",
  "stoner-rock",
  "rock-and-roll",
  "grunge",
  "post-rock",
  "post-punk",
  "new-wave",
  "britpop",
  "shoegaze",
  // metal subgenres
  "heavy-metal",
  "thrash-metal",
  "death-metal",
  "nu-metal",
  "alternative-metal",
  "metalcore",
  "post-hardcore",
  "hardcore",
  "doom-metal",
  "power-metal",
  "black-metal",
  // hip-hop / r&b adjacent
  "trap",
  "drill",
  "boom-bap",
  "trip-hop",
  // electronic subgenres
  "house",
  "techno",
  "trance",
  "dubstep",
  "drum-and-bass",
  "ambient",
  "synthpop",
  "eurodance",
  "hyperpop",
  "lo-fi",
  "idm",
  // pop subgenres
  "pop-punk",
  "indie-pop",
  "dream-pop",
  "synth-pop",
  // other
  "ska",
  "motown",
  "doo-wop",
  "swing",
  "afrobeat",
  "reggaeton",
  "emo",
  "experimental",
]);

/**
 * Maps free-form Claude mood strings to canonical moods. Unmapped values
 * return null (including intentionally-excluded ambiguous terms like
 * "soulful", "groovy", "thriller").
 */
const MOOD_CLUSTER: Record<string, CanonicalMood> = {
  // uplifting
  uplifting: "uplifting",
  joyful: "uplifting",
  euphoric: "uplifting",
  cheerful: "uplifting",
  carefree: "uplifting",
  triumphant: "uplifting",
  empowering: "uplifting",
  hopeful: "uplifting",
  inspirational: "uplifting",
  soaring: "uplifting",
  festive: "uplifting",
  fun: "uplifting",
  exhilarating: "uplifting",
  thrilling: "uplifting",
  motivational: "uplifting",
  spiritual: "uplifting",
  transcendent: "uplifting",
  // energetic
  energetic: "energetic",
  upbeat: "energetic",
  powerful: "energetic",
  epic: "energetic",
  anthemic: "energetic",
  "adrenaline-fueled": "energetic",
  determined: "energetic",
  // aggressive
  aggressive: "aggressive",
  angry: "aggressive",
  intense: "aggressive",
  heavy: "aggressive",
  edgy: "aggressive",
  rebellious: "aggressive",
  chaotic: "aggressive",
  tense: "aggressive",
  "angst-driven": "aggressive",
  "angst-filled": "aggressive",
  unsettling: "aggressive",
  // melancholic
  melancholic: "melancholic",
  sad: "melancholic",
  wistful: "melancholic",
  sentimental: "melancholic",
  bittersweet: "melancholic",
  vulnerable: "melancholic",
  heartfelt: "melancholic",
  // romantic
  romantic: "romantic",
  tender: "romantic",
  passionate: "romantic",
  sensual: "romantic",
  sultry: "romantic",
  warm: "romantic",
  charming: "romantic",
  loving: "romantic",
  // nostalgic
  nostalgic: "nostalgic",
  timeless: "nostalgic",
  contemplative: "nostalgic",
  introspective: "nostalgic",
  reflective: "nostalgic",
  // dark
  dark: "dark",
  moody: "dark",
  haunting: "dark",
  mysterious: "dark",
  eerie: "dark",
  ominous: "dark",
  // dreamy
  dreamy: "dreamy",
  ethereal: "dreamy",
  atmospheric: "dreamy",
  hypnotic: "dreamy",
  psychedelic: "dreamy",
  cinematic: "dreamy",
  // playful
  playful: "playful",
  whimsical: "playful",
  quirky: "playful",
  humorous: "playful",
  // confident
  confident: "confident",
  cool: "confident",
  boastful: "confident",
  funky: "confident",
  swaggering: "confident",
  // peaceful
  // Note: "chill" appears in the tag IGNORE list (too generic as a Last.fm
  // descriptor) but is valid as a Claude mood — the two paths are independent.
  peaceful: "peaceful",
  calm: "peaceful",
  relaxed: "peaceful",
  mellow: "peaceful",
  "laid-back": "peaceful",
  chill: "peaceful",
  tranquil: "peaceful",
};

const VALID_ENERGY: ReadonlySet<string> = new Set(["low", "medium", "high"]);

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function normalizeArtistName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Normalize a raw tag string to canonical form, or return null if the tag
 * should be dropped (ignore list, artist-name match, empty).
 */
function normalizeTag(
  raw: string,
  artistNamesNormalized: ReadonlySet<string>,
): string | null {
  if (typeof raw !== "string") return null;

  // 1. Lowercase, trim, collapse repeated whitespace
  let tag = raw.toLowerCase().trim().replace(/\s+/g, " ");
  if (tag.length === 0) return null;

  // 2. Apply SYNONYMS map
  const synonym = SYNONYMS[tag];
  if (synonym) {
    tag = synonym;
  }

  // 2a. Specific years → decade (e.g., 1979 → 70s, 2011 → 2010s)
  const yearMatch = tag.match(/^(19|20)(\d)\d$/);
  if (yearMatch) {
    const century = yearMatch[1];
    const decadeDigit = yearMatch[2];
    tag =
      century === "19"
        ? `${decadeDigit}0s`
        : `${century}${decadeDigit}0s`;
  }

  // 3. Ignore list
  if (IGNORE.has(tag)) return null;

  // 4. Artist-name filter
  if (artistNamesNormalized.has(tag)) return null;

  return tag;
}

/**
 * Maps a free-form Claude mood string to a canonical mood, or null if
 * unmapped.
 */
function clusterMood(raw: string | null): CanonicalMood | null {
  if (!raw) return null;
  const normalized = raw.toLowerCase().trim();
  return MOOD_CLUSTER[normalized] ?? null;
}

function validateEnergyField(
  raw: string | null,
): "low" | "medium" | "high" | null {
  if (raw && VALID_ENERGY.has(raw)) return raw as "low" | "medium" | "high";
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

type Candidate = {
  tag: string;
  sourceRank: number;
  withinSourceIndex: number;
};

type DedupedEntry = {
  tag: string;
  bestSourceRank: number;
  minWithinSourceIndex: number;
  hitCount: number;
};

/**
 * Derive a vibe profile from raw enrichment data. Pure function — no DB,
 * no I/O. Everything needed is in the input.
 *
 * Algorithm (see plan for full spec + worked example):
 * 1. Collect candidates from every source with (sourceRank, withinSourceIndex)
 * 2. Normalize each tag
 * 3. Dedupe with promotion (min source rank, min within-source index, count hits)
 * 4. Rank by (hitCount DESC, sourceRank ASC, withinSourceIndex ASC)
 * 5. Split into genre/tag buckets via GENRE_VOCAB
 * 6. Cap genres at MAX_GENRES, tags at MAX_TAGS
 */
export function deriveVibeProfile(
  input: DeriveVibeProfileInput,
): VibeProfile {
  const { claude, trackSpotify, trackLastfm, artistLastfmTags, artistNames } =
    input;

  const artistNamesNormalized = new Set(artistNames.map(normalizeArtistName));

  // Mood/energy/danceability come from Claude only
  const mood = claude ? clusterMood(claude.mood) : null;
  const energy = claude ? validateEnergyField(claude.energy) : null;
  const danceability = claude ? validateEnergyField(claude.danceability) : null;

  // 1. Collect candidates
  const candidates: Candidate[] = [];

  // sourceRank 0: Claude vibeTags
  if (claude?.vibeTags) {
    claude.vibeTags.forEach((tag, i) => {
      candidates.push({ tag, sourceRank: 0, withinSourceIndex: i });
    });
  }

  // sourceRank 0: Spotify derivedEra (tied with Claude — authoritative era)
  if (trackSpotify?.derivedEra) {
    candidates.push({
      tag: trackSpotify.derivedEra,
      sourceRank: 0,
      withinSourceIndex: 0,
    });
  }

  // sourceRank 1: Last.fm track tags
  if (trackLastfm?.tags) {
    trackLastfm.tags.forEach((tag, i) => {
      candidates.push({ tag, sourceRank: 1, withinSourceIndex: i });
    });
  }

  // sourceRank 2: Last.fm artist tags (pre-merged by caller)
  artistLastfmTags.forEach((tag, i) => {
    candidates.push({ tag, sourceRank: 2, withinSourceIndex: i });
  });

  // 2 + 3. Normalize and dedupe with promotion
  const map = new Map<string, DedupedEntry>();
  for (const candidate of candidates) {
    const normalized = normalizeTag(candidate.tag, artistNamesNormalized);
    if (!normalized) continue;

    const existing = map.get(normalized);
    if (!existing) {
      map.set(normalized, {
        tag: normalized,
        bestSourceRank: candidate.sourceRank,
        minWithinSourceIndex: candidate.withinSourceIndex,
        hitCount: 1,
      });
    } else {
      existing.hitCount += 1;
      existing.bestSourceRank = Math.min(
        existing.bestSourceRank,
        candidate.sourceRank,
      );
      existing.minWithinSourceIndex = Math.min(
        existing.minWithinSourceIndex,
        candidate.withinSourceIndex,
      );
    }
  }

  // 4. Rank: (hitCount DESC, bestSourceRank ASC, minWithinSourceIndex ASC)
  const ranked = Array.from(map.values()).sort((a, b) => {
    if (a.hitCount !== b.hitCount) return b.hitCount - a.hitCount;
    if (a.bestSourceRank !== b.bestSourceRank)
      return a.bestSourceRank - b.bestSourceRank;
    return a.minWithinSourceIndex - b.minWithinSourceIndex;
  });

  // 5. Split into buckets
  const genres: string[] = [];
  const tags: string[] = [];
  for (const entry of ranked) {
    if (GENRE_VOCAB.has(entry.tag)) {
      genres.push(entry.tag);
    } else {
      tags.push(entry.tag);
    }
  }

  // 6. Cap
  return {
    mood,
    energy,
    danceability,
    genres: genres.slice(0, MAX_GENRES),
    tags: tags.slice(0, MAX_TAGS),
  };
}
