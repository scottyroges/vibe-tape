// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createMockDb } from "../../helpers/mock-db";

vi.mock("server-only", () => ({}));

const { db } = createMockDb();
vi.mock("@/lib/db", () => ({ db }));

vi.stubEnv("SPOTIFY_CLIENT_ID", "test-client-id");
vi.stubEnv("SPOTIFY_CLIENT_SECRET", "test-client-secret");

describe("health router", () => {
  it("ping returns status and timestamp without auth", async () => {
    const { createCallerFactory } = await import("@/server/trpc");
    const { appRouter } = await import("@/server/routers/_app");

    const caller = createCallerFactory(appRouter)({
      session: null,
      userId: null,
    });

    const result = await caller.health.ping();

    expect(result.status).toBe("ok");
    expect(result.timestamp).toBeInstanceOf(Date);
  });
});
