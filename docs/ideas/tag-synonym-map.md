# Tag Synonym Map

Build a master list of all Claude-generated tags and a relationship/synonym map between them, so we can do fuzzier matching when selecting songs for a vibe.

- Claude's tag outputs aren't perfectly consistent — "melancholic" vs "melancholy", "lo-fi" vs "lofi", "high energy" vs "energetic"
- A synonym map would group these so they match against each other during playlist generation
- Could also capture broader relationships: "dreamy" is adjacent to "ethereal", "upbeat" is a parent of "danceable"
- Could be a static mapping we maintain, or something we ask Claude to generate/update periodically as new tags appear
- Enables more flexible vibe matching without requiring exact string equality on tags

Without this, we're leaving good matches on the table any time Claude phrases a tag slightly differently between the seed analysis and the song library.
