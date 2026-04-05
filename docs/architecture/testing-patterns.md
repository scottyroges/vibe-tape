# Testing Patterns

This document covers testing conventions used in Vibe Tape.

## File Placement

Backend tests (`.test.ts`) live in `tests/` with a directory structure mirroring `src/`. For example, `src/repositories/track.repository.ts` is tested at `tests/repositories/track.repository.test.ts`. Backend tests import the module under test using `@/` path aliases, not relative imports.

Frontend tests (`.test.tsx`) are colocated next to the component or page they test inside `src/`.

## General Patterns

### Test Imports Follow Production Patterns

Tests should follow the same import patterns as production code.

```typescript
import type { Track, LikedSong } from "@/domain/song";
import type { Playlist } from "@/domain/playlist";
```

## Frontend Testing Patterns

### Mocking Better Auth Client

Better Auth client methods return `{ data, error }` instead of throwing exceptions. Mock implementations must match this signature.

**Correct:**

```typescript
const mockSignOut = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signOut: mockSignOut,
  },
}));

// Success case
mockSignOut.mockResolvedValueOnce({ data: {}, error: null });

// Error case
mockSignOut.mockResolvedValueOnce({
  data: null,
  error: { message: "Session expired", status: 401 },
});
```

**Why:**
- Better Auth uses result objects, not exceptions
- Production code checks `result.error`, not try/catch
- Tests must match the actual API contract

### Test Visible Behavior

Write tests that verify what users see and experience, not internal implementation details.

**Good Tests:**

```typescript
it("shows playlist name after generation", async () => {
  render(<GenerateForm {...props} />);
  await user.click(screen.getByRole("button", { name: /generate/i }));
  expect(screen.getByText("Late Night Drive")).toBeInTheDocument();
});
```

**Brittle Tests (avoid):**

```typescript
// Don't test CSS module class names — they're transformed
it("applies correct CSS class", () => {
  const { container } = render(<SongCard name="Test" />);
  const card = container.querySelector(".songCard"); // Will fail
});
```

## Testing with React Query

When testing components that use `useMutation`, provide a `QueryClientProvider` wrapper:

```typescript
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
  Wrapper.displayName = "Wrapper";

  return Wrapper;
}

render(<MyComponent />, { wrapper: createWrapper() });
```

## Backend Testing Patterns

### Environment Directive

Backend tests run in Node environment. Add the directive at the top:

```typescript
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
```

### Mocking server-only Modules

Tests must mock the `server-only` package to import server code:

```typescript
// @vitest-environment node
vi.mock("server-only", () => ({}));

// Now you can import server modules
import { myServerFunction } from "@/server/my-module";
```

### Hoisted Mock Functions

Use `vi.hoisted()` for mock functions referenced in `vi.mock()` factory:

```typescript
// ✅ Correct — hoisted
const mockCreate = vi.hoisted(() => vi.fn());
vi.mock("@/repositories/track.repository", () => ({
  trackRepository: { findByIds: mockFindByIds },
}));

// ❌ Wrong — factory is hoisted, but variable isn't
const mockFindByIds = vi.fn(); // Not hoisted!
vi.mock("@/repositories/track.repository", () => ({
  trackRepository: { findByIds: mockFindByIds }, // ReferenceError at runtime
}));
```

### Testing Layers

Different layers require different mocking strategies:

**Router tests** (thin wrappers):
```typescript
const mockGenerate = vi.hoisted(() => vi.fn());
vi.mock("@/services/vibe.service", () => ({
  vibeService: { generate: mockGenerate },
}));

it("generate creates playlist from seed songs", async () => {
  mockGenerate.mockResolvedValue({ id: "p1", vibeName: "Late Night Drive" });
  const result = await caller.playlist.generate({ seedSongIds: ["s1", "s2"] });
  expect(result.vibeName).toBe("Late Night Drive");
});
```

**Repository tests** (data access):
```typescript
import { createMockDb } from "../helpers/mock-db";

vi.mock("server-only", () => ({}));

const { db, executeTakeFirstOrThrow } = createMockDb();
vi.mock("@/lib/db", () => ({ db }));

it("finds track by id", async () => {
  executeTakeFirstOrThrow.mockResolvedValue({ id: "t1", name: "Midnight City" });
  const result = await trackRepository.findByIds(["t1"]);
  expect(result[0].name).toBe("Midnight City");
});
```

`createMockDb` exposes spies for the builder methods that take a payload (`values` for inserts, `set` for updates, `where` for predicates) alongside terminal spies like `execute` / `executeTakeFirst`. Prefer asserting on those payload spies over stringly matching SQL — e.g. for `playlistRepository.markSaved`, assert that `set` was called with `{ spotifyPlaylistId, status: "SAVED", ... }` rather than inspecting the generated SQL. Methods that return the builder for chaining (`selectAll`, `orderBy`, `groupBy`, …) don't need explicit spies because the proxy returns itself.

### Dynamic Imports After Mocks

Import the module under test AFTER setting up mocks:

```typescript
describe("vibeService", () => {
  let vibeService: Awaited<typeof import("@/services/vibe.service")>["vibeService"];

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/services/vibe.service");
    vibeService = mod.vibeService;
  });
});
```

### Testing Inngest Step Functions

Inngest functions are tested by mocking `inngest.createFunction` to capture the handler, then invoking it directly with a mock `step` object. The mock step's `run` method executes callbacks immediately rather than going through Inngest's step machinery.

```typescript
vi.mock("@/lib/inngest", () => ({
  inngest: {
    createFunction: vi.fn((_opts, handler) => ({ handler, _opts })),
  },
}));

import { syncLibrary } from "@/inngest/functions/sync-library";

function createMockStep() {
  return {
    run: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
  };
}

const handler = (syncLibrary as unknown as { handler: Function }).handler;
const step = createMockStep();
const event = { data: { userId: "user-1" } };

await handler({ event, step });

// Assert step order and dependency calls
expect(step.run.mock.calls[0]![0]).toBe("get-token");
expect(step.run.mock.calls[1]![0]).toBe("fetch-songs");
```

**Key detail:** Inngest serializes step outputs to JSON between steps, so `Date` objects become strings. Functions must rehydrate dates before passing to repositories. Test this explicitly:

```typescript
it("rehydrates Date fields before upserting", async () => {
  // fetchLikedSongs returns likedAt as ISO string (simulating serialization)
  mockFetchLikedSongs.mockResolvedValue([{ likedAt: "2024-06-15T00:00:00.000Z", ... }]);
  await handler({ event, step });
  const upsertedSongs = mockUpsertMany.mock.calls[0]![1];
  expect(upsertedSongs[0].likedAt).toBeInstanceOf(Date);
});
```

### Environment Variable Stubs for Transitive Dependencies

`src/server/auth.ts` is imported by the tRPC context, which is imported by every router test. Any env vars required by `auth.ts` must be stubbed in all router tests:

```typescript
// @vitest-environment node
vi.mock("server-only", () => ({}));

const { db } = createMockDb();
vi.mock("@/lib/db", () => ({ db }));

vi.stubEnv("SPOTIFY_CLIENT_ID", "test-client-id");
vi.stubEnv("SPOTIFY_CLIENT_SECRET", "test-client-secret");
```
