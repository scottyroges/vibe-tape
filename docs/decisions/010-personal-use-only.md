# ADR 010: Vibe Tape is Personal Use Only

**Status:** Accepted
**Date:** 2026-04-04
**Supersedes:** ADR 005 (Vercel hosting)

## Context

Vibe Tape depends on the Spotify Web API for liked songs ingestion, artist
metadata, and playlist creation. All apps on the Spotify developer platform
start in **development mode**, which imposes two show-stopping limits for us:

1. **25-user cap.** An app in dev mode can only authenticate users who have
   been manually added to the app's allow-list in the Spotify developer
   dashboard. There is a hard limit of 25 such users per app.
2. **Restricted endpoints.** Several endpoints we rely on return 403 or drop
   fields in dev mode. See
   [`notes/spotify-dev-mode-restrictions.md`](../notes/spotify-dev-mode-restrictions.md)
   for the list (batch artists endpoint, artist genres, track popularity).

The only way past either limit is to be promoted to Spotify's **extended
quota** tier.

## The extended quota wall

Spotify will only grant extended quota to apps that already have
**250,000 monthly active users**. That is not a typo — extended quota is not
something you apply for when you're getting started; it's something Spotify
grants to apps that are *already* at serious scale, presumably on another
platform.

There is no ramp. There is no paid tier that lifts the 25-user cap. Either
you have 250k MAU, or you live with 25 hand-allow-listed users and the
dev-mode endpoint restrictions forever.

## Decision

**Vibe Tape is a personal-use project only.** It will run locally on the
developer's machine against a local Postgres and a local Inngest Dev Server.
There will be no production deployment, no public users, no Stripe, no
marketing, no growth loop.

The Vercel project, Neon database, and Inngest Cloud app have all been torn
down. Any code or documentation that assumed a production environment has
been removed or rewritten.

## Consequences

- **Build for one user.** Code and data-model decisions no longer need to
  account for multi-tenant behavior at scale. We still keep `userId` on
  tables — the schema is fine — but capacity planning, auth hardening for
  public traffic, rate-limit sharing, etc. are all out of scope.
- **Local-only constraints replace Vercel constraints.** The chunked Inngest
  step pattern was originally designed around Vercel's 60-second function
  timeout. Locally there is no such cap, but chunking is still valuable for
  retry granularity so we're leaving it in place.
- **No cron.** Features that assumed Vercel cron (nightly auto-sync,
  "what changed" digest) are off the roadmap unless reintroduced via a local
  scheduler (`launchd`, `cron`, or a long-running dev task) when there's a
  reason to.
- **Tier gating is dead.** Free vs paid, 250-song caps, Stripe — all of it
  was written against a product that could acquire users. None of it applies
  now.
- **The roadmap is now a wishlist.** Anything in it that still seems fun to
  build locally can be built. Everything else can be ignored.

## When to revisit

Only if one of these changes:

- Spotify restructures its developer program to offer a paid tier or a
  smaller-scale quota extension that's actually attainable.
- The project gets rebuilt on top of a different music source
  (Apple Music, YouTube Music, a self-hosted library) whose API terms don't
  gate access on pre-existing scale.

Absent one of those, Vibe Tape stays personal.

## References

- [`notes/spotify-dev-mode-restrictions.md`](../notes/spotify-dev-mode-restrictions.md)
  — the specific endpoint restrictions that apply in dev mode.
- Spotify Developer Dashboard → "Extended Quota Mode" — documents the 250k
  MAU requirement.
