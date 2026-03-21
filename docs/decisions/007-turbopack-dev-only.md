# ADR 007: Turbopack for Development Only

**Status:** Accepted
**Date:** 2026-03

## Context
Next.js supports Turbopack (Vercel's Rust-based bundler) for both `next dev` and `next build`. We need to decide whether to use it for production builds.

## Decision
Use Turbopack for development (`next dev --turbopack`) but use the default webpack bundler for production builds (`next build`).

## Alternatives Considered
- **Turbopack for both dev and prod** — faster builds and consistent bundler across environments, but Turbopack for `next build` is still relatively new with less production mileage. Risk of hitting edge-case build failures that are hard to debug on Vercel.

## Consequences
- Production builds use webpack, which is rock-solid and well-understood
- Dev server keeps the fast Turbopack hot-reload experience
- Slight risk of dev/prod bundler differences, but unlikely to matter at our scale
- Can revisit once Turbopack production builds have more adoption
