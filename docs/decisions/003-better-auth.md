# ADR 003: Better Auth for Authentication

**Status:** Accepted
**Date:** 2026-03

## Context

Need authentication for a Next.js app with Spotify OAuth as the primary (and initially only) auth method. Want to own token storage for background sync jobs.

## Decision

Use Better Auth with the Kysely adapter and `genericOAuth` plugin for Spotify.

## Alternatives Considered

- **Auth.js v5** — never reached stable release, maintenance-only since handover to Better Auth team
- **Clerk** — excellent DX but paid, adds vendor dependency before revenue
- **Supabase Auth** — ties us to the Supabase ecosystem
- **Raw OAuth implementation** — more work, no session management

## Consequences

- Free, no paid dependency before we have revenue
- TypeScript-first with strong type inference
- Active development backed by $5M funding
- `genericOAuth` plugin handles Spotify Authorization Code flow
- DB sessions with signed cookie caching — no JWT strategy needed
- Spotify tokens stored in Better Auth's `account` table — `getValidToken()` helper reads/refreshes via Kysely
- Plugin system available for future needs (MFA, organizations, rate limiting)
- More setup work than managed solutions like Clerk
