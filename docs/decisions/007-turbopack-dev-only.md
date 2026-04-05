# ADR 007: Turbopack for Development Only

**Status:** Accepted
**Date:** 2026-03

## Context
Next.js supports Turbopack (a Rust-based bundler) for both `next dev` and `next build`. We need to decide whether to use it for `next build` as well.

## Decision
Use Turbopack for development (`next dev --turbopack`) but use the default webpack bundler for `next build`.

## Alternatives Considered
- **Turbopack for both dev and build** — faster and more consistent across the two modes, but Turbopack for `next build` is still relatively new and more prone to edge-case failures.

## Consequences
- `next build` uses webpack, which is rock-solid and well-understood
- Dev server keeps the fast Turbopack hot-reload experience
- Slight risk of dev/build bundler differences, but low impact since the
  project is local-only (see [ADR 010](010-personal-use-only.md))
- Can revisit once Turbopack builds have more mileage
