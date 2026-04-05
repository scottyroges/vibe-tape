# ADR 009: Async Job Processing

**Status:** Accepted (original rationale partially superseded by [ADR 010](010-personal-use-only.md))
**Date:** 2026-03

> **Note:** This ADR was originally written assuming a Vercel deployment with
> 10–60s function timeouts. Vibe Tape is now local-only ([ADR 010](010-personal-use-only.md)),
> so that specific constraint no longer applies. Inngest is still the right
> call for local development — the Dev Server runs in Docker, step functions
> give us retry granularity and an observable dashboard, and the code path is
> identical to what a hosted Inngest deployment would look like. The
> alternatives section below is kept as historical context.

## Context

Vibe Tape needs background processing for operations that take longer than a
user should wait synchronously:

- **Library sync:** Paginating a user's Spotify liked songs can require 100+
  API calls for large libraries (50 songs per page).
- **Enrichment pipeline:** Multi-step Spotify + Claude + Last.fm enrichment
  runs per-track and benefits from independently retryable steps.
- **Playlist generation (future):** Scoring thousands of songs against vibe
  criteria and pushing results to Spotify.

These operations should not block the UI, need retry logic for transient
API failures, and should be observable when debugging locally.

## Decision

Use **Inngest** via the Inngest Dev Server (Docker Compose).

- Step functions for multi-stage processing with automatic retries
- Dev Server provides a local dashboard showing job status, failures, and
  step-by-step execution
- No separate worker process — the Next.js app's `/api/inngest` handler
  *is* the worker, invoked over HTTP by the Dev Server

The chunked-step pattern (process N items per step, persist, loop) is
retained. It was originally introduced to fit within Vercel's 60s timeout,
but the retry granularity it provides is valuable on its own: a failure
partway through a long sync doesn't restart from the beginning.

## Alternatives Considered

> Originally evaluated in the context of a hosted Vercel deployment. Kept here
> for historical context.

### Vercel `waitUntil()`
**Rejected:** Continues processing after returning a response, but still subject to the function timeout. No retry logic, no visibility into job status, no step-based checkpointing.

### Postgres-Based Queues (pg-boss, Graphile Worker)
**Rejected:** Require a persistent worker process. Were rejected when the target was Vercel serverless. Would actually be viable now that the project is local-only, but there's no reason to migrate off Inngest for personal use.

### Trigger.dev
**Considered:** Similar to Inngest but smaller free tier. More complex than needed for our use cases.

### BullMQ + Redis
**Rejected:** Extra infrastructure (Redis + worker) with no benefit for a single-user local setup.

## Implementation

### Inngest Client

```typescript
// src/lib/inngest.ts
import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "vibe-tape",
  name: "Vibe Tape",
});
```

### Inngest API Route

```typescript
// src/app/api/inngest/route.ts
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { syncLibrary } from "@/inngest/functions/sync-library";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [syncLibrary],
});
```

### Example: Library Sync Function

```typescript
// src/inngest/functions/sync-library.ts
import { inngest } from "@/lib/inngest";

export const syncLibrary = inngest.createFunction(
  {
    id: "sync-library",
    name: "Sync Spotify Library",
    retries: 3,
  },
  { event: "library/sync.requested" },
  async ({ event, step }) => {
    const { userId } = event.data;

    // Step 1: Get valid Spotify token
    const token = await step.run("get-token", async () => {
      return getValidToken(userId);
    });

    // Step 2: Fetch liked songs (paginated)
    const songs = await step.run("fetch-songs", async () => {
      return fetchLikedSongs(token);
    });

    // Step 3: Upsert to database
    const result = await step.run("upsert-songs", async () => {
      return upsertSongs(userId, songs);
    });

    return result;
  }
);
```

### Triggering from tRPC

```typescript
// In library router
sync: protectedProcedure.mutation(async ({ ctx }) => {
  await inngest.send({
    name: "library/sync.requested",
    data: { userId: ctx.userId },
  });
  return { status: "started" };
}),
```

## Consequences

### Advantages
- **Zero extra infrastructure** — the Dev Server is a single Docker Compose service
- **Step functions** — each step is independently retryable; a failure on page 50 of pagination doesn't restart from page 1
- **Observability** — the Dev Server dashboard at `localhost:8288` shows job status, failures, and per-step timing
- **Same SDK as the hosted product** — if we ever needed to move off local, the code wouldn't change

### Limitations
- **Vendor coupling to Inngest's SDK** — acceptable for a personal project
- **Dev Server must be running** — jobs don't execute when Docker isn't up

## References

- [Inngest Documentation](https://www.inngest.com/docs)
- [Inngest Pricing](https://www.inngest.com/pricing) — 50k free executions/month
- [Inngest Next.js Integration](https://www.inngest.com/docs/reference/serve#next-js)
- [BullMQ Documentation](https://docs.bullmq.io/)
