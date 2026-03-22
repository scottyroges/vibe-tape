# Frontend Patterns

This document covers frontend conventions used in Vibe Tape.

## Client Component Mutations

### Use `useMutation` with tRPC

Client components should use `useMutation` from `@tanstack/react-query` with `trpc.*.mutationOptions()`. Never call `mutationFn` directly or use async/await in handlers.

**Correct:**

```typescript
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";

export function MyComponent() {
  const trpc = useTRPC();

  const generatePlaylist = useMutation(
    trpc.playlist.generate.mutationOptions({
      onSuccess: (data) => {
        router.push(`/playlist/${data.id}`);
      },
      onError: (error) => {
        console.error("Failed:", error);
      },
    })
  );

  const handleSubmit = () => {
    generatePlaylist.mutate({ seedSongIds: ["s1", "s2", "s3"] });
  };

  return (
    <button
      onClick={handleSubmit}
      disabled={generatePlaylist.isPending}
    >
      {generatePlaylist.isPending ? "Generating..." : "Generate"}
    </button>
  );
}
```

**Why:**
- `useMutation` manages loading states, errors, and retries
- `mutationOptions` provides the proper tRPC integration
- Direct `mutationFn` calls bypass React Query's caching and state management

## Server Component Data Fetching

### Await `serverTRPC()` Once

Server components should await `serverTRPC()` once and reuse the result.

**Correct:**

```typescript
import { serverTRPC } from "@/lib/trpc/server";

export default async function DashboardPage() {
  const trpc = await serverTRPC();

  const [playlists, songCount] = await Promise.all([
    trpc.playlist.list(),
    trpc.library.songCount(),
  ]);

  return <Dashboard playlists={playlists} songCount={songCount} />;
}
```

**Why:**
- `serverTRPC()` sets up the tRPC context (auth, headers, etc.)
- Awaiting once and reusing is more efficient

## Type Imports

### Import from `@/domain/types` or Specific Domain Files

```typescript
import type { Track, LikedSong } from "@/domain/song";
import type { Playlist } from "@/domain/playlist";
// or
import type { Track, LikedSong, Playlist } from "@/domain/types";
```

## Layout Patterns

### App-Shell Layout with Container Scroll

Vibe Tape uses an app-shell pattern where the authenticated app area (`(app)` route group) is locked to viewport height with internal scroll containers.

**Parent layout (`src/app/(app)/layout.module.css`):**

```css
.shell {
  height: 100svh;       /* Lock to viewport height */
  overflow: hidden;     /* No overflow at shell level */
}

.main {
  flex: 1;
  min-height: 0;        /* Allow flex child to shrink */
  overflow-y: auto;     /* Main scroll container */
  padding: 2rem 1.5rem;
  display: flex;
  flex-direction: column;
}
```

**Key principles:**
- All pages under `(app)` scroll within `.main`, not at the viewport level
- `.main` carries a `data-scroll-container` attribute as a generic hook for any client component that needs to locate the shell scroll element, though most pages prefer local scroll wrappers (see Virtualized Lists)
- `.main` must be a flex column container so child layouts' `flex: 1` fills available space
- Viewport units (`100svh`) are only used at the shell level
- Child layouts use percentage-based heights relative to their parent
- This avoids mobile Safari viewport unit bugs (address bar show/hide)

## Virtualized Lists

Long lists (e.g., the liked library on `/create`) use `@tanstack/react-virtual` to render only visible rows. The virtualizer's `scrollElement` should be a local scroll wrapper `<div>` owned by the page component, referenced via `useRef`. This keeps the scroll context self-contained rather than coupling to the app-shell layout. The wrapper div handles its own `overflow-y: auto` and the page's outer container uses `overflow: hidden` to prevent double scrollbars.

## Client Component Queries

### Use `useQuery` with tRPC `queryOptions`

Client components that read data should use `useQuery` from `@tanstack/react-query` with `trpc.*.queryOptions()`:

```typescript
const trpc = useTRPC();
const listQuery = useQuery(trpc.library.list.queryOptions());
```

This mirrors the mutation pattern (`useMutation` + `mutationOptions`) and gives access to `isLoading`, `isError`, `data`, and `refetch` for handling loading/error/empty states.

## Background Job Status Polling

For long-running operations triggered by mutations (e.g., library sync via Inngest), the dashboard uses a poll-on-demand pattern rather than WebSockets or server-sent events.

**Pattern:** The mutation fires the background job. On success, the client optimistically sets the status to the "in progress" state via `queryClient.setQueryData`. A status query polls the server every 2 seconds while the status is active, using `refetchInterval` with a conditional function. When the status transitions back to idle, a `useEffect` with a ref invalidates dependent queries (e.g., song count).

**Key details:**
- `refetchInterval` returns `2000` while syncing, `false` otherwise — polling stops automatically
- Server-side `trySetSyncing()` is an atomic compare-and-set that prevents duplicate syncs regardless of client behavior
- The mutation returns `already_syncing` if the user is already mid-sync, so the client can handle it gracefully
- Error states come from two sources: mutation failure (couldn't start) and sync status `FAILED` (job crashed)

## Common Pitfalls

### Form Handling with Enter Key

Handle Enter vs Shift+Enter correctly in textareas:

```typescript
const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSubmit();
  }
};
```
