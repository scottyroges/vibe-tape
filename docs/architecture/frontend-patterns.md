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
import type { Song } from "@/domain/song";
import type { Playlist } from "@/domain/playlist";
// or
import type { Song, Playlist } from "@/domain/types";
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
- `.main` must be a flex column container so child layouts' `flex: 1` fills available space
- Viewport units (`100svh`) are only used at the shell level
- Child layouts use percentage-based heights relative to their parent
- This avoids mobile Safari viewport unit bugs (address bar show/hide)

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
