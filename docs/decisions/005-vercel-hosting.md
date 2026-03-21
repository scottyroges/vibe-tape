# ADR 005: Vercel for Hosting

**Status:** Accepted
**Date:** 2026-03

## Context
Need a hosting platform for the Next.js monolith. Want trivial deploys and a free tier for development.

## Decision
Use Vercel for deployment.

## Alternatives Considered
- **Railway** — good for long-running processes but not optimized for Next.js
- **Fly.io** — more control, but more setup and operational overhead
- **AWS** — maximum flexibility but maximum operational complexity

## Consequences
- Git-push deploys from `main` branch
- Preview deployments on pull requests
- Optimized for Next.js (same company)
- Free tier limit: 10s function timeout (60s on Pro at $20/mo)
- Built-in cron jobs for nightly library sync
- Serverless functions sufficient for Claude API calls and Spotify API interactions
