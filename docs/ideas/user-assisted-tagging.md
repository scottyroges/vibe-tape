# User-Assisted Tagging

Let users contribute tags for songs in their library, especially deep cuts that Claude can't reliably tag on its own.

- Users know their music better than anyone — if Claude is uncertain about a song, surface that and let the user fill in the gaps
- Could be lightweight: "How does this song feel?" with a few vibe-word suggestions to tap, not a full tagging form
- User-submitted tags could supplement or override low-confidence Claude tags
- Community angle: if multiple users have the same song and tag it similarly, that's strong signal. Could aggregate across users over time.
- Creates engagement and ownership — users feel like they're teaching the system their taste

**Way later feature.** Depends on having a confidence signal from Claude (see song-hallucination-risk.md) to know when to ask for help. Also needs thought around trust/moderation if tags are shared across users.
