// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("server-only", () => ({}));

const { db } = await vi.hoisted(async () => {
  const { createMockDb } = await import("../helpers/mock-db");
  return createMockDb();
});
vi.mock("@/lib/db", () => ({ db }));

vi.stubEnv("SPOTIFY_CLIENT_ID", "test-client-id");
vi.stubEnv("SPOTIFY_CLIENT_SECRET", "test-client-secret");

describe("protectedProcedure", () => {
  it("allows authenticated users to proceed", async () => {
    const { protectedProcedure, createCallerFactory, router } = await import(
      "@/server/trpc"
    );

    const testRouter = router({
      test: protectedProcedure.query(async () => {
        return { success: true };
      }),
    });

    const caller = createCallerFactory(testRouter)({
      session: { user: { id: "user-1" } } as never,
      userId: "user-1",
    });

    const result = await caller.test();
    expect(result).toEqual({ success: true });
  });

  it("blocks unauthenticated users with UNAUTHORIZED error", async () => {
    const { protectedProcedure, createCallerFactory, router } = await import(
      "@/server/trpc"
    );

    const testRouter = router({
      test: protectedProcedure.query(async () => {
        return { success: true };
      }),
    });

    const caller = createCallerFactory(testRouter)({
      session: null,
      userId: null,
    });

    await expect(caller.test()).rejects.toThrow(TRPCError);
    await expect(caller.test()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
