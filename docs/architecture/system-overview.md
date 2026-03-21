# System Overview

## Architecture Principles

### Monolith First

Everything lives in one Next.js application. No microservices, no separate backend, no Docker/Kubernetes. Solo developer building a product — operational simplicity is paramount.

### Service Layer Isolation

All business logic lives in `src/services/` with zero framework dependencies. Route handlers and tRPC procedures are thin wrappers. This ensures:

- Business logic is independently testable
- Services can be extracted to a separate backend when needed
- The migration path is clean: swap the import, not the logic

### Strong Types, End to End

The type chain: Prisma schema → Kysely database types (via `prisma-kysely`) → domain types → tRPC procedures → frontend. Changing a field in the schema produces compile errors everywhere that field is referenced. Runtime validation via Zod at API boundaries.

### Scale Later, Architect Now

Decisions keep scaling options open without paying the complexity cost upfront:
- Service layer pattern enables future service extraction
- Neon Postgres is just Postgres — can migrate to any provider
- Cloudflare R2 is S3-compatible — can swap to AWS S3
- No vendor-specific features that create deep lock-in

## Project Structure

```
src/
├── middleware.ts               # Route protection (cookie check via Better Auth)
├── app/                       # Next.js App Router (routes + layouts only)
│   ├── (auth)/                # Auth pages (login via Spotify OAuth)
│   ├── (app)/                 # Authenticated app pages (session-validated layout)
│   │   └── dashboard/
│   ├── api/auth/[...all]/     # Better Auth API handler
│   ├── api/inngest/           # Inngest serve handler (background job invocation)
│   └── api/trpc/[trpc]/      # tRPC HTTP handler
│
├── server/                    # Server-side code
│   ├── routers/               # tRPC routers (thin wrappers over services)
│   ├── trpc.ts                # tRPC initialization + context
│   └── auth.ts                # Better Auth configuration (Spotify genericOAuth)
│
├── services/                  # Business logic (NO framework imports)
│
├── repositories/              # Database access layer (Kysely queries)
│
├── domain/                    # Shared types and interfaces (no runtime code)
│
├── lib/                       # External API clients and utilities
│   ├── db.ts                  # Kysely database singleton
│   ├── id.ts                  # CUID2 ID generation
│   ├── anthropic.ts           # Anthropic SDK singleton
│   ├── auth-client.ts         # Better Auth React client
│   ├── inngest.ts             # Inngest client singleton
│   ├── spotify.ts             # Spotify API client (liked songs fetching)
│   ├── spotify-token.ts       # Lazy Spotify token refresh
│   └── trpc/                  # tRPC wiring
│       ├── client.tsx         # React client (TRPCReactProvider, useTRPC)
│       └── server.ts          # Server-side caller (serverTRPC())
│
├── components/                # React components
│   └── providers.tsx          # Root provider composition (tRPC, React Query)
│
└── hooks/                     # Custom React hooks

tests/                             # Backend tests (mirrors src/ structure)
├── lib/
├── repositories/
├── services/
├── server/routers/
└── helpers/                       # Shared factories, fixtures, mocks

e2e/                               # Playwright E2E tests (critical user flows)
```

## Layer Responsibilities

**App Router (`app/`)** — Routing, layouts, page-level data fetching. No business logic.

**tRPC Routers (`server/routers/`)** — Input validation via Zod, auth checks, delegation to services. Thin wrappers only.

Middleware procedures in `server/trpc.ts`:
- `protectedProcedure` — Requires authentication (checks session)

**Services (`services/`)** — All business logic. Framework-agnostic. Can import from `repositories/`, `domain/`, and `lib/` only. Never imports from `app/` or `server/`.

**Repositories (`repositories/`)** — Database queries via Kysely (type-safe SQL query builder). Isolates the query layer from services. All repository methods return domain types (defined in `domain/`), never raw database types. Schema and migrations are managed by Prisma; queries are written in Kysely.

**Domain (`domain/`)** — TypeScript types and interfaces shared across layers. No runtime code.

**Lib (`lib/`)** — Thin wrappers around external SDKs and API clients (Anthropic, Kysely database instance, Spotify token management, Spotify API client). Configuration, client instantiation, and low-level API interaction only. Also contains tRPC wiring: `lib/trpc/client.tsx` provides the React Query-backed tRPC client, `lib/trpc/server.ts` provides `serverTRPC()` for Server Components to call procedures directly without HTTP.
