# Pricing: Limit Playlists, Not Songs

Rethinking the free tier: instead of capping liked songs, cap playlist generations.

- **Liked songs have a one-time ingestion cost** (Claude tags them once) and then live in the library forever. More songs = better playlist quality for everyone. Capping this hurts the product.
- **Playlist generation is the recurring cost** — each creation hits Claude's API. This is where marginal cost lives, so it's the natural thing to meter.
- Upgrade pitch is cleaner: "You've used your 3 free vibes this month" hits at a moment of demonstrated value, versus "you can only like 50 songs" which feels restrictive before the user experiences the magic.
- Let free users build up a big library — it increases switching cost and investment in the platform.

**Open question:** If the playlist feedback loop (iterative +/- refinement) ships, does each refinement round count as a generation, or is a full refine-until-happy session one "use"? Counting each round would feel punitive; treating a session as one use is more user-friendly but costs more per "playlist."
