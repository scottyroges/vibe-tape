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
- One language (TypeScript), one runtime, faster iteration
- Service layer isolation keeps business logic framework-agnostic
- The project now runs local-only (see [ADR 010](010-personal-use-only.md)),
  but the monolith structure still makes sense for a single developer
  running everything on one machine
