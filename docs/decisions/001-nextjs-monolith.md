# ADR 001: Next.js Monolith

**Status:** Accepted
**Date:** 2026-03

## Context
Solo developer building a full-stack product. Need to move fast with minimal operational overhead.

## Decision
Use Next.js 15 (App Router) as a full-stack monolith. No separate backend, no microservices, no Docker/Kubernetes.

## Alternatives Considered
- **Spring Boot + React SPA** — two languages, two deploys, more operational complexity than justified at this stage

## Consequences
- One language (TypeScript), one deploy, faster iteration
- Vercel deployment is trivial (git push)
- Service layer isolation keeps extraction path open if/when needed
- Limited to serverless function constraints (10s free, 60s pro) until extraction
