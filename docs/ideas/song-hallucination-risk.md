# Song Hallucination Risk

Claude may not recognize obscure songs, confuse songs with the same name, or confidently generate incorrect tags. Bad tags silently pollute playlist quality.

**Flavors of the problem:**
- Obscure/indie tracks Claude has no training data on — it guesses based on artist or genre
- Name collisions ("Stay", "Home", etc.) — could mix up versions
- Claude won't say "I don't know" — it'll just output plausible-sounding tags with full confidence

**Possible mitigations:**
- Use Spotify's metadata (genre, audio features, popularity) as ground truth for objective attributes. Let Claude handle the subjective/vibes layer but don't rely on it alone.
- Ask Claude to output a confidence signal per song. Weight low-confidence tags lower during playlist matching.
- Send audio features (tempo, energy, valence, etc.) alongside title/artist so Claude has real signal even for songs it doesn't recognize.
- Could also do a pre-check: ask Claude if it knows the song before tagging, and fall back to Spotify-only metadata if it doesn't.
