# ADR 009: Async Job Processing

**Status:** Accepted
**Date:** 2026-03

## Context

Vibe Tape needs background processing for operations that exceed Vercel's serverless function timeout:

- **Library sync:** Paginating a user's Spotify liked songs can require 100+ API calls for large libraries (50 songs per page). A user with 5,000 songs triggers ~100 sequential requests — well beyond Vercel's 10s (hobby) or 60s (pro) function timeout.
- **Playlist generation (future):** Scoring thousands of songs against vibe criteria and pushing results to Spotify.
- **Nightly auto-sync (future):** Batch-refreshing all users' libraries on a schedule.

These operations should not block the user experience, need retry logic for transient Spotify API failures, and must work within Vercel's serverless constraints.

**Key constraints:**
- Deployed to Vercel (serverless — no persistent worker processes)
- Postgres on Neon (no local Redis or persistent queues)
- $0 budget initially, minimal cost at scale
- Must be simple to set up and maintain solo

## Decision

**Phase 1 (MVP):** Use **Inngest** free tier.

- 50,000 executions/month free
- Native Next.js/Vercel integration
- Zero infrastructure to manage
- Step functions for multi-stage processing with automatic retries

**Phase 2 (if needed):** Migrate to **Railway worker + BullMQ** if Inngest costs exceed budget at scale.

## Alternatives Considered

### Vercel `waitUntil()`
**Rejected:** Continues processing after returning a response, but still subject to the function timeout. No retry logic, no visibility into job status, no step-based checkpointing.

### Postgres-Based Queues (pg-boss, Graphile Worker)
**Rejected:** Require a persistent worker process. Cannot run on Vercel serverless. Would need a separate worker server, negating the cost and simplicity advantage.

### Trigger.dev
**Considered:** Similar to Inngest but smaller free tier ($5/month credit vs. 50k executions). More complex than needed for our use cases.

### BullMQ + Redis
**Deferred to Phase 2:** Requires separate worker server (~$7/mo on Railway) + managed Redis (~$10/mo on Upstash). More cost-effective at scale but unnecessary overhead for MVP.

### Vercel Cron Jobs
**Insufficient alone:** Limited to 10-60s execution time. Useful for triggering jobs (e.g., nightly sync fires an Inngest event) but cannot run the actual long-running work.

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
- **$0 cost** for MVP (50k executions/month covers early users easily)
- **Zero infrastructure** — no Redis, no worker servers
- **Built for Vercel** — native Next.js integration, runs as serverless functions
- **Step functions** — each step is independently retryable; a failure on page 50 of pagination doesn't restart from page 1
- **Observability** — built-in dashboard shows job status, failures, and execution time
- **Local dev mode** — Inngest Dev Server for testing workflows locally

### Limitations
- **Vendor coupling** — migration requires rewriting job handlers (though the mapping to BullMQ is straightforward)
- **Usage-based pricing** — costs grow with job volume past 50k/month
- **Less control** — can't tune worker concurrency or Redis config

### Migration Path

If Inngest costs exceed budget:

1. Deploy worker to Railway (~$7/mo)
2. Set up managed Redis on Upstash (~$10/mo)
3. Install BullMQ and rewrite job handlers
4. Dual-write jobs to both systems during transition
5. Remove Inngest

Estimated migration: 1-2 days.

## References

- [Inngest Documentation](https://www.inngest.com/docs)
- [Inngest Pricing](https://www.inngest.com/pricing) — 50k free executions/month
- [Inngest Next.js Integration](https://www.inngest.com/docs/reference/serve#next-js)
- [BullMQ Documentation](https://docs.bullmq.io/)
