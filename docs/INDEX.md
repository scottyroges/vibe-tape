# Documentation Index

> **Status: Personal use only.** Vibe Tape cannot be released publicly — Spotify
> caps dev-mode apps at 25 users and requires 250k MAU for extended quota. See
> [ADR 010](decisions/010-personal-use-only.md). Docs that still mention Vercel,
> Neon, or production infrastructure are historical context unless noted.

## Quick Reference

- **Product vision:** .personal/docs/vision.md
- **Tech stack & architecture:** .personal/docs/tech-stack.md
- **Roadmap & priorities:** .personal/docs/roadmap.md

## Architecture

- **System overview:** .personal/docs/architecture/system-overview.md
- **Auth patterns:** .personal/docs/architecture/auth-patterns.md
- **Frontend patterns:** .personal/docs/architecture/frontend-patterns.md
- **Testing patterns:** .personal/docs/architecture/testing-patterns.md
- **Data model:** .personal/docs/architecture/data-model.md

## Architecture Decisions (ADRs)

- **001 Next.js monolith:** .personal/docs/decisions/001-nextjs-monolith.md
- **002 tRPC API layer:** .personal/docs/decisions/002-trpc-api-layer.md
- **003 Better Auth:** .personal/docs/decisions/003-better-auth.md
- **004 CSS Modules:** .personal/docs/decisions/004-css-modules.md
- **006 Testing strategy:** .personal/docs/decisions/006-testing-strategy.md
- **007 Turbopack dev only:** .personal/docs/decisions/007-turbopack-dev-only.md
- **008 Prisma + Kysely:** .personal/docs/decisions/008-query-layer-prisma-kysely.md
- **009 Async job processing:** .personal/docs/decisions/009-async-job-processing.md
- **010 Personal use only:** .personal/docs/decisions/010-personal-use-only.md

## Notes

- **Spotify dev-mode restrictions:** .personal/docs/notes/spotify-dev-mode-restrictions.md

## Ideas

- **Ideas backlog:** .personal/docs/ideas/ — lightweight idea sketches for future features (not committed to roadmap)

## Work Plans

- **Active work plans:** .personal/docs/plans/active/
  - _(none)_
- **Completed work plans:** .personal/docs/plans/completed/
  - Playlist Generation (Hybrid Claude + Math Scoring): docs/plans/completed/playlist-generation-hybrid.md
  - Track Enrichment Pipeline (parent plan): docs/plans/completed/track-enrichment-pipeline.md
  - Phase 1 — Artist Model + Expanded Spotify Data: .personal/docs/plans/completed/phase1-artist-model-spotify-data.md
  - Phase 2 — Enrichment Pipeline Foundation: .personal/docs/plans/completed/phase2-enrichment-pipeline-foundation.md
  - Phase 3 — Claude Mood/Energy Classification: docs/plans/completed/phase3-claude-classification.md
  - Phase 4 — Last.fm Tags: docs/plans/completed/phase4-lastfm-tags.md
  - Per-Source Versioning, Async Last.fm & Vibe Profile: docs/plans/completed/per-source-versioning-async-lastfm.md
  - Vibe Profile Derivation: docs/plans/completed/vibe-profile-derivation.md
  - Claude Prompt v2 — Canonical Moods: docs/plans/completed/claude-prompt-v2-canonical-moods.md
