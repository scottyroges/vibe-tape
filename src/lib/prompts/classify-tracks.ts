export type TrackInput = { name: string; artist: string };

export type ClassificationResult = {
  mood: string;
  energy: "low" | "medium" | "high";
  danceability: "low" | "medium" | "high";
  vibeTags: string[];
};

export function buildClassifyPrompt(tracks: TrackInput[]): {
  system: string;
  user: string;
} {
  const system = `You are a music classification assistant. For each track provided, classify it with:

- mood: a single descriptive word (e.g. "melancholic", "uplifting", "aggressive", "dreamy", "nostalgic")
- energy: one of "low", "medium", or "high"
- danceability: one of "low", "medium", or "high"
- vibeTags: 2-5 short descriptors (e.g. "late-night", "driving", "workout", "rainy-day", "summer")

Respond ONLY with a JSON array of objects in the same order as the input. Each object must have exactly these keys: mood, energy, danceability, vibeTags. No other text.

Example for a single track:
[{"mood":"melancholic","energy":"low","danceability":"low","vibeTags":["late-night","rainy-day","introspective"]}]`;

  const user = JSON.stringify(
    tracks.map(({ name, artist }) => ({ name, artist }))
  );

  return { system, user };
}
