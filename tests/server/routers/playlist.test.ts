import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSend,
  mockFindOwnedTrackIds,
  mockCreatePlaceholder,
} = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue(undefined),
  mockFindOwnedTrackIds: vi.fn(),
  mockCreatePlaceholder: vi.fn(),
}));

vi.mock("@/lib/inngest", () => ({
  inngest: { send: mockSend },
}));

vi.mock("@/repositories/track.repository", () => ({
  trackRepository: {
    findOwnedTrackIds: mockFindOwnedTrackIds,
  },
}));

vi.mock("@/repositories/playlist.repository", () => ({
  playlistRepository: {
    createPlaceholder: mockCreatePlaceholder,
  },
}));

vi.mock("server-only", () => ({}));

vi.mock("@/server/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { router, createCallerFactory } from "@/server/trpc";
import { playlistRouter } from "@/server/routers/playlist";

const createCaller = createCallerFactory(router({ playlist: playlistRouter }));

function authedCaller(userId = "user-1") {
  return createCaller({
    session: { user: { id: userId } } as never,
    userId,
  });
}

const SEEDS = ["t1", "t2", "t3"];

describe("playlistRouter.generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindOwnedTrackIds.mockResolvedValue(new Set(SEEDS));
    mockCreatePlaceholder.mockResolvedValue("pl-1");
  });

  it("creates a placeholder and fires the Inngest event on happy path", async () => {
    const caller = authedCaller();
    const result = await caller.playlist.generate({ seedTrackIds: SEEDS });

    expect(result).toEqual({ playlistId: "pl-1" });
    expect(mockFindOwnedTrackIds).toHaveBeenCalledWith("user-1", SEEDS);
    expect(mockCreatePlaceholder).toHaveBeenCalledWith("user-1", {
      seedTrackIds: SEEDS,
      targetDurationMinutes: 60,
      userIntent: null,
    });
    expect(mockSend).toHaveBeenCalledWith({
      name: "playlist/generate.requested",
      data: {
        userId: "user-1",
        playlistId: "pl-1",
        seedTrackIds: SEEDS,
        targetDurationMinutes: 60,
        userIntent: null,
      },
    });
  });

  it("passes through a custom targetDurationMinutes", async () => {
    const caller = authedCaller();
    await caller.playlist.generate({
      seedTrackIds: SEEDS,
      targetDurationMinutes: 90,
    });

    expect(mockCreatePlaceholder).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ targetDurationMinutes: 90 })
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ targetDurationMinutes: 90 }),
      })
    );
  });

  it("threads userIntent through placeholder + event when provided", async () => {
    const caller = authedCaller();
    await caller.playlist.generate({
      seedTrackIds: SEEDS,
      userIntent: "rainy morning",
    });

    expect(mockCreatePlaceholder).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ userIntent: "rainy morning" })
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userIntent: "rainy morning" }),
      })
    );
  });

  it("normalizes whitespace-only userIntent to null", async () => {
    const caller = authedCaller();
    await caller.playlist.generate({
      seedTrackIds: SEEDS,
      userIntent: "   ",
    });

    expect(mockCreatePlaceholder).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ userIntent: null })
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userIntent: null }),
      })
    );
  });

  it("trims userIntent before persisting", async () => {
    const caller = authedCaller();
    await caller.playlist.generate({
      seedTrackIds: SEEDS,
      userIntent: "  late night drive  ",
    });

    expect(mockCreatePlaceholder).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ userIntent: "late night drive" })
    );
  });

  it("rejects userIntent over 280 characters", async () => {
    const caller = authedCaller();
    const tooLong = "a".repeat(281);

    await expect(
      caller.playlist.generate({ seedTrackIds: SEEDS, userIntent: tooLong })
    ).rejects.toThrow();
    expect(mockCreatePlaceholder).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("accepts userIntent at exactly 280 characters", async () => {
    const caller = authedCaller();
    const exact = "a".repeat(280);

    await expect(
      caller.playlist.generate({ seedTrackIds: SEEDS, userIntent: exact })
    ).resolves.toEqual({ playlistId: "pl-1" });
  });

  it("rejects fewer than 3 seeds", async () => {
    const caller = authedCaller();
    mockFindOwnedTrackIds.mockResolvedValue(new Set(["t1", "t2"]));

    await expect(
      caller.playlist.generate({ seedTrackIds: ["t1", "t2"] })
    ).rejects.toThrow();
    expect(mockCreatePlaceholder).not.toHaveBeenCalled();
  });

  it("rejects more than 5 seeds", async () => {
    const caller = authedCaller();
    const tooMany = ["t1", "t2", "t3", "t4", "t5", "t6"];

    await expect(
      caller.playlist.generate({ seedTrackIds: tooMany })
    ).rejects.toThrow();
    expect(mockCreatePlaceholder).not.toHaveBeenCalled();
  });

  it("rejects targetDurationMinutes below 15", async () => {
    const caller = authedCaller();

    await expect(
      caller.playlist.generate({
        seedTrackIds: SEEDS,
        targetDurationMinutes: 10,
      })
    ).rejects.toThrow();
  });

  it("rejects targetDurationMinutes above 240", async () => {
    const caller = authedCaller();

    await expect(
      caller.playlist.generate({
        seedTrackIds: SEEDS,
        targetDurationMinutes: 300,
      })
    ).rejects.toThrow();
  });

  it("rejects seeds the user does not own", async () => {
    mockFindOwnedTrackIds.mockResolvedValue(new Set(["t1", "t2"])); // t3 missing

    const caller = authedCaller();
    await expect(
      caller.playlist.generate({ seedTrackIds: SEEDS })
    ).rejects.toThrow(/t3/);

    expect(mockCreatePlaceholder).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
