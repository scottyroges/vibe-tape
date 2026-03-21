# Vibe Tape — Product Vision

> *March 2026 — Draft*

---

## The Problem

Spotify has done a remarkable job building the world's largest music library. But the tools for actually living inside that library — especially your personal liked songs collection — remain primitive. You can shuffle 5,000 songs and hope for the best. You can browse a list with no organization, no filtering, no memory of why you saved anything.

The deeper problem: music taste is deeply personal and contextual. The songs you want at 2am driving alone are different from what you need at a Saturday barbecue or a road trip with four friends. No existing tool understands this. They offer genre categories, mood dropdowns, activity tags — all blunt instruments that feel nothing like how people actually relate to music.

---

## The Insight

People already know which songs capture a feeling. They might not be able to name the feeling — but they can point to three songs that live in it. That's the seed.

Vibe Tape inverts the playlist creation model. Instead of picking a category and getting songs, you pick a few songs that represent something, and the app figures out the category — then finds everything else in your library that belongs there.

The mechanic is mixing. You're not selecting genres. You're blending songs together and seeing what emerges. Like mixing paints to discover a color you couldn't have named beforehand.

---

## The Product

### Core Experience

A user opens Vibe Tape and picks 3–5 seed songs from their Spotify library. Claude analyzes what those songs have in common — not just genre, but texture, mood, tempo, era, emotional register — and synthesizes a vibe description. That description becomes a scoring system applied across the user's full liked songs library. The result is a playlist that feels like it was curated by someone who understands you.

Every generated playlist gets an AI-generated art card — a unique painting synthesized from the visual mood of the seed songs' album artwork. The card shows the vibe name, seed songs, and song count. It's designed to be shared.

### The Group Session

The standout social feature: a shared session where multiple people connect their Spotify accounts and each contribute seed songs. The combined library becomes the pool. Claude finds the intersection — the vibe that honors everyone's taste. This solves the oldest social music problem: what does the group listen to?

The road trip. The AirBnB weekend. The gym session with a friend. Vibe Tape generates the playlist nobody has to argue about.

### Why People Share It

The vibe name is the shareable moment. "Late night coastal drive." "Golden hour nostalgia." "Pre-game energy, minor key." People screenshot and share these because they describe their taste in a way that feels both accurate and flattering. The AI art card makes the share visually compelling. The `og:image` means it previews richly in any messaging app or social platform.

Every shared card links back to Vibe Tape with a "generate yours" CTA. The product markets itself through the artifact it produces.

---

## The Business

### Target User

Music-obsessive Spotify users with large liked song libraries (500+) who feel their library is underutilized. People who care enough about music to have opinions about it. Early adopters will come from Reddit (r/spotify, r/indiedev), Product Hunt, and organic social sharing.

### Revenue Model

| Tier | Key Limits | Price | Goal |
|------|-----------|-------|------|
| Free | 250 songs, 5 gen/month, no group sessions, no AI art | $0 | Conversion hook |
| Standard | All songs, 15 gen/month, group sessions, AI art, auto-sync, 3 guest passes/month | $10/year | Primary revenue |
| Power | ~100 gen/month, 10 guest passes/month | $25/year | Power users |

The free tier's 250-song cap is the primary conversion mechanic. A user with 3,000 liked songs is only getting 8% of their library — the product feels incomplete by design. The upgrade CTA: *"You have 2,847 liked songs. Unlock all of them."*

### Unit Economics

- Variable cost per user per month: ~$0.07–0.28 depending on image generation choice
- Revenue per Standard user per month: $0.83
- Gross margin: ~66–90%
- Break-even at ~300 paying users (~$3k/year revenue)
- Fixed infra cost at early scale: ~$200–400/year

---

## What Success Looks Like

In year one: 300+ paying users, $3,000+ ARR, the shareable card becomes something people post. The group session becomes the default way a certain type of friend group handles road trip music.

The existential risk is Spotify building this natively. The honest answer: they've had years to improve liked songs and haven't. And even if they do, the bar for success here is low enough that "Spotify ships it and kills us" after we've made a few thousand dollars is just fine. This is an indie product, not a venture bet.
