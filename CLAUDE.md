# Vibe Tape

A web application built with Next.js and TypeScript.

## Commands

- **Dev:** `npm run dev`
- **Build:** `npm run build`
- **Test:** `npm test`
- **Lint:** `npm run lint`
- **Typecheck:** `npx tsc --noEmit`

## Documentation

For project documentation, see `.personal/docs/INDEX.md`.

## Architecture

- **Monolith**: Everything lives in one Next.js app — no microservices, no separate API server.
- **tRPC for all API communication**: No raw API routes for app logic. Auth routes (`/api/auth/[...all]`) are the only exception.
- **Prisma for schema, Kysely for queries**: Prisma owns migrations and type generation. All runtime queries go through Kysely with `CamelCasePlugin`.
- **Repositories own data access**: No direct DB calls from routers or services. All queries go through `src/repositories/`.
- **Protected by default**: Middleware redirects unauthenticated users. Only routes in the public list (`/`, `/login`, `/api/auth/*`, `/api/trpc/*`, `/api/inngest/*`, `/vibe/*`) are open.
