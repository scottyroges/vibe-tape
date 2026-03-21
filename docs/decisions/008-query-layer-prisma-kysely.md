# ADR 008: Query Layer — Prisma Migrate + Kysely Queries

**Status:** Accepted
**Date:** 2026-03

## Context

Need a database access strategy. Want type-safe queries with full SQL control and a good migration system.

## Decision

Use the hybrid approach: Prisma for schema and migrations, Kysely for runtime queries.

- Keep `schema.prisma` as the schema source of truth
- Keep `prisma migrate` for auto-generated migrations
- Use `prisma-kysely` to generate Kysely's `Database` type from the Prisma schema
- Write all repository queries in Kysely instead of the Prisma client
- No Prisma client runtime dependency (keep `prisma` CLI as a dev dependency)

## Alternatives Considered

- **Prisma Client** — hides generated SQL, favors multiple queries over JOINs, ships a Rust binary, limited complex query support (no CTEs, window functions)
- **Drizzle** — SQL-like query builder with auto migrations, but still in beta with breaking changes
- **Plain pg** — maximum control but `result.rows` is `any[]` with no type safety

## Why Hybrid

| Aspect | Prisma Client | Kysely | Hybrid (Prisma Migrate + Kysely) |
|---|---|---|---|
| SQL control | None (generated) | Full | Full |
| JOINs | Separate queries | Native SQL JOINs | Native SQL JOINs |
| Type safety | Generated, automatic | Generated or manual | Generated from Prisma schema |
| Migrations | Excellent (auto-diff) | Manual only | Prisma Migrate (auto-diff) |
| Query predictability | Low | High | High |
| Runtime dependency | Rust binary | Pure TypeScript | Pure TypeScript |

## Consequences

- Full SQL control with type safety, predictable query output, no Rust binary at runtime
- Prisma's excellent migration system (`prisma migrate dev` auto-diffs schema changes)
- `prisma-kysely` generates Kysely types automatically — no manual type maintenance
- Better Auth uses Kysely internally — sharing the app's Kysely instance eliminates the need for a separate adapter
- Two tools in the data layer — developers need to understand both Prisma (schema/migrations) and Kysely (queries)
- Repository layer isolates this completely — no changes needed to domain types, services, or tRPC routers
