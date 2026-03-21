# Doc Updater Memory — Vibe Tape

## Project Overview
Vibe Tape is a Next.js + TypeScript web app that generates Spotify playlists from "seed songs" using Claude for vibe analysis. Pre-revenue indie product.

## Documentation Structure
- `.personal/docs/INDEX.md` — routing map for all docs
- `.personal/docs/tech-stack.md` — comprehensive tech stack, auth flows, data architecture, API routes, cost model
- `.personal/docs/vision.md` — product vision and business model
- `.personal/docs/roadmap.md` — tiered feature roadmap with status checkboxes
- `.personal/docs/architecture/` — system-overview, auth-patterns, frontend-patterns, testing-patterns, data-model
- `.personal/docs/decisions/` — ADRs (001-009 so far)
- `.personal/docs/plans/active/` and `plans/completed/` — work plans

## Style Conventions
- Docs use `> *Month Year -- Draft*` headers
- Tables for structured comparisons (stack choices, cost models, roadmap items)
- Horizontal rules (`---`) between major sections
- Prose-heavy with clear section hierarchy
- Vision/roadmap docs are detailed and opinionated in tone

## Key Facts
- `stack.md` was removed as redundant with `tech-stack.md` (March 2026)
- `.personal/docs` is a symlink to `docs/` — edit either path
- CLAUDE.md at project root has commands + architecture rules
- Repo has scaffold code (auth, tRPC, middleware, Inngest client) — no longer planning-only
