# Auth Patterns

This document covers authentication patterns and conventions used in Vibe Tape.

## Better Auth Configuration

We use [Better Auth](https://www.better-auth.com/) with Kysely adapter, Next.js integration, and the `genericOAuth` plugin for Spotify.

### Critical: Error Handling Pattern

**Better Auth returns `{ data, error }` instead of throwing exceptions.**

```typescript
// ❌ WRONG - This won't catch authentication errors
try {
  await authClient.signIn.social({ provider: "spotify", callbackURL: "/dashboard" });
} catch (err) {
  setError("This won't execute on auth failure!");
}

// ✅ CORRECT - Check result.error
const result = await authClient.signIn.social({
  provider: "spotify",
  callbackURL: "/dashboard",
});

if (result.error) {
  setError(result.error.message);
}
```

This applies to **all** Better Auth client methods:
- `authClient.signIn.social()`
- `authClient.signOut()`
- etc.

### Core Setup

**Server configuration** (`src/server/auth.ts`):
```typescript
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";

export const auth = betterAuth({
  baseURL: getBaseUrl(),
  database: { db, type: "postgres" as const },
  plugins: [
    genericOAuth({
      config: [{
        providerId: "spotify",
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        authorizationUrl: "https://accounts.spotify.com/authorize",
        tokenUrl: "https://accounts.spotify.com/api/token",
        scopes: ["user-read-email", "user-library-read", "playlist-modify-public", "playlist-modify-private"],
        getUserInfo: async (tokens) => { /* fetch /v1/me */ },
      }],
    }),
    nextCookies(),
  ],
});
```

**Client setup** (`src/lib/auth-client.ts`):
```typescript
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
```

### Better Auth API Naming

| Task | Method | NOT |
|------|--------|-----|
| Sign in with OAuth | `authClient.signIn.social()` | `signInWithProvider()` |
| Sign out | `authClient.signOut()` | `logout()` |

### Spotify OAuth Flow

1. User clicks "Continue with Spotify" → `authClient.signIn.social({ provider: "spotify" })`
2. Redirect to `accounts.spotify.com/authorize` with scopes + state param
3. Spotify redirects to `/api/auth/oauth2/callback/spotify` with authorization code
4. Better Auth exchanges code for `access_token` + `refresh_token`
5. Tokens stored in Better Auth's `account` table
6. Session cookie set (30-day expiry, refreshed daily)

### Spotify Token Refresh

Tokens are refreshed lazily via `getValidToken(userId)` in `src/lib/spotify-token.ts`:

- Reads from Better Auth's `account` table via Kysely
- Checks `accessTokenExpiresAt` with a 60-second buffer
- If expired: `POST accounts.spotify.com/api/token` with refresh token
- Writes new access token back to `account` table
- If refresh fails (`invalid_grant`): marks user `needsReauth` in `user` table

### Local Development Note

Spotify no longer supports `localhost` as a redirect URI (deprecated Nov 2025). Use `http://127.0.0.1:3000` and set `BETTER_AUTH_URL=http://127.0.0.1:3000` in `.env.local`.

**Spotify redirect URI:** Better Auth's `genericOAuth` plugin uses the path `/api/auth/oauth2/callback/{providerId}`. In the Spotify Developer Dashboard, set the redirect URI to:
```
http://127.0.0.1:3000/api/auth/oauth2/callback/spotify
```

## Middleware

Use cookie-only session check in middleware for performance:

```typescript
// src/middleware.ts
import { getSessionCookie } from "better-auth/cookies";

export function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie && !isPublicRoute(pathname)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}
```

**Public routes:** `/`, `/login`, `/api/auth/*`, `/api/trpc/*`, `/api/inngest/*`, `/vibe/*` (shared vibe cards)

### Inngest Endpoint Auth

`/api/inngest` is public in our middleware (no session cookie required) but protected by two layers:

- **Middleware layer (our code):** Skipped — `/api/inngest` is in the public routes list so the Inngest server can reach it without a user session cookie.
- **Inngest SDK layer (`serve()`):** In production, the SDK verifies a request signing key (`INNGEST_SIGNING_KEY`) to ensure only Inngest's cloud can invoke functions. In local dev (`INNGEST_DEV=1`), signature verification is disabled so the Docker-based Dev Server can reach the endpoint without keys.

**Why cookie-only check:**
- Faster than database lookup
- Sufficient for route protection
- Full session available in server components via `auth.api.getSession()`

## Server Components

Use `auth.api.getSession()` with headers to get full session:

```typescript
import { headers } from "next/headers";
import { auth } from "@/server/auth";

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  return <div>Hello {session.user.name}</div>;
}
```

## Database Integration

Better Auth uses Kysely internally — share the app's Kysely instance:

```typescript
import { db } from "@/lib/db";

export const auth = betterAuth({
  database: { db, type: "postgres" as const },
});
```

**Schema notes:**
- Better Auth generates its own Prisma models during setup
- IDs use `String @id` (no `@default(cuid())`) — Better Auth generates IDs at runtime
- `Account` table stores Spotify OAuth tokens (`accessToken`, `refreshToken`, `accessTokenExpiresAt`)
