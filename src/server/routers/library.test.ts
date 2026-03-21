import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSend, mockFindByUserId, mockCountByUserId } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue(undefined),
  mockFindByUserId: vi.fn(),
  mockCountByUserId: vi.fn(),
}));

vi.mock("@/lib/inngest", () => ({
  inngest: { send: mockSend },
}));

vi.mock("@/repositories/track.repository", () => ({
  trackRepository: {
    findByUserId: mockFindByUserId,
    countByUserId: mockCountByUserId,
  },
}));

// Mock server-only to allow importing trpc in test environment
vi.mock("server-only", () => ({}));

// Mock auth to avoid header access in tests
vi.mock("@/server/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { router, createCallerFactory } from "@/server/trpc";
import { libraryRouter } from "./library";

// Create a test caller with a fake authenticated context
const createCaller = createCallerFactory(router({ library: libraryRouter }));

function authedCaller(userId = "user-1") {
  return createCaller({
    session: { user: { id: userId } } as never,
    userId,
  });
}

describe("libraryRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("sync", () => {
    it("sends library/sync.requested event and returns started", async () => {
      const caller = authedCaller();
      const result = await caller.library.sync();

      expect(result).toEqual({ status: "started" });
      expect(mockSend).toHaveBeenCalledWith({
        name: "library/sync.requested",
        data: { userId: "user-1" },
      });
    });
  });

  describe("list", () => {
    it("returns tracks from repository", async () => {
      const tracks = [
        { id: "t1", spotifyId: "sp1", name: "Song 1", artist: "A", album: "Al", albumArtUrl: null },
      ];
      mockFindByUserId.mockResolvedValue(tracks);

      const caller = authedCaller();
      const result = await caller.library.list();

      expect(result).toEqual(tracks);
      expect(mockFindByUserId).toHaveBeenCalledWith("user-1");
    });
  });

  describe("count", () => {
    it("returns count from repository", async () => {
      mockCountByUserId.mockResolvedValue(42);

      const caller = authedCaller();
      const result = await caller.library.count();

      expect(result).toEqual({ count: 42 });
      expect(mockCountByUserId).toHaveBeenCalledWith("user-1");
    });
  });
});
