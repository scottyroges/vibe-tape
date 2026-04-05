# Vibe Tape — Product Roadmap

> *March 2026 — Draft*
>
> **Status: Personal use only.** Spotify caps dev-mode apps at 25 users and
> requires 250k MAU for extended quota, so Vibe Tape will never ship publicly
> — see [ADR 010](decisions/010-personal-use-only.md). The tiers, payments,
> distribution strategy, and "users per month" framing below are kept as
> historical record from the original product plan. Treat everything past
> Tier 1 as a wishlist of things that would be fun to build locally.

---

## Tier 1 — Core Mechanic (Local)

Still the priority — get the "pick seeds, generate a vibe playlist" loop
working end to end against the local stack.

| # | Feature | Notes | Status |
|---|---------|-------|--------|
| 1 | Spotify OAuth | Better Auth genericOAuth plugin. Authorization Code flow. Tokens stored in Better Auth's `account` table. | [x] |
| 2 | Liked songs ingestion + storage | Paginate `GET /me/tracks`. Store per user in DB. Free tier capped at 250 songs. | [x] |
| 3 | Seed song picker UI | Searchable, mobile-first. Fast scroll through liked library. Highest-leverage UX investment. | [~] |
| 4 | Vibe analysis via Claude | Send 3–5 seed song names/artists to Claude. Return vibe name + descriptor + scoring criteria as JSON. | [ ] |
| 5 | Playlist generation | Score stored library against vibe criteria. Push playlist back to Spotify via `POST /me/playlists`. | [ ] |
| 6 | Basic shareable card | Typographic card with vibe name, seed songs, song count. No AI art yet — that's Tier 2. | [ ] |

---

## Tier 2 — Makes It a Real Product

Add payments, metadata enrichment, and the AI art that makes sharing compelling. This is what users pay for.

| # | Feature | Notes | Status |
|---|---------|-------|--------|
| 7 | Last.fm/MusicBrainz metadata enrichment | Fetch genre tags, BPM, era per track. Powers better matching without Spotify audio features. | [~] Last.fm done (Phases 1-4). BPM dropped (no source). MusicBrainz deferred. |
| 8 | Free vs paid tier enforcement | 250 song cap for free. Generation limits enforced server-side. | [ ] |
| 9 | Stripe integration | Standard ($10/yr) and Power ($25/yr) tiers. Free until revenue. | [ ] |
| 10 | Auto-sync | Dropped — there's no host to run a nightly cron. Manual sync via the dashboard is sufficient for personal use. | [dropped] |
| 11 | AI art generation | Stable Diffusion via Replicate (~$0.005/image). Cache by sorted seed song combo. Paid users only. | [ ] |
| 12 | "What changed" digest | Surface new songs added to existing playlists. Email or in-app banner. | [ ] |

---

## Tier 3 — Growth and Delight

The social features that drive word of mouth and create the viral loop.

- [ ] **Group sessions** — multiple users pool their libraries, each contributes seed songs, shared playlist generated
- [ ] **Guest passes** — paid users invite non-members into a single session via QR code/link
- [ ] **Public vibe sharing** — shareable URL with `og:image` card, "generate your own version" CTA for guests
- [ ] **Vibe re-run** — regenerate same seeds as library grows, show what changed

---

## Tier 4 — Power User & Polish

Build when users ask for it. Don't anticipate — respond.

- [ ] **Seed weighting** — "more of this, less of that" slider per seed song
- [ ] **PWA installability** — add to home screen, full-screen mobile experience
- [ ] **Notification/email digest** — weekly summary of sync activity
- [ ] **Power user tier billing** — $25/yr through Stripe

---

## Distribution Strategy

### Launch channels (in priority order)

1. **Reddit** — r/spotify, r/indiedev. One genuine "I built this" post. Don't spam.
2. **Product Hunt** — single launch day. The demo (pick songs → see vibe emerge → playlist generated) is very watchable.
3. **TikTok/YouTube Shorts** — 30-second screen recording. No followers needed, the demo sells itself.
4. **Hacker News Show HN** — lower conversion but high-trust audience.

### The built-in growth loop

The AI art card is the distribution mechanism. People share the card to show off their taste. Every card contains the app URL. Every shared vibe link lands non-users on a page with a "generate yours" CTA at peak intent. Guest passes turn one paying user into four potential signups per session.
