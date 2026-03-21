import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockWhere,
  mockSet,
  mockUpdateTable,
  mockCountExecuteTakeFirstOrThrow,
  mockCountWhere,
  mockSelectFrom,
  mockFn,
} = vi.hoisted(() => {
  const mockExecute = vi.fn();
  const mockWhere = vi.fn(() => ({ execute: mockExecute }));
  const mockSet = vi.fn(() => ({ where: mockWhere }));
  const mockUpdateTable = vi.fn(() => ({ set: mockSet }));

  const mockCountExecuteTakeFirstOrThrow = vi
    .fn()
    .mockResolvedValue({ count: 42 });
  const mockCountSelect = vi.fn(() => ({
    executeTakeFirstOrThrow: mockCountExecuteTakeFirstOrThrow,
  }));
  const mockCountWhere = vi.fn(() => ({ select: mockCountSelect }));
  const mockSelectFrom = vi.fn(() => ({ where: mockCountWhere }));

  const mockFn = { countAll: vi.fn(() => ({ as: vi.fn() })) };

  return {
    mockWhere,
    mockSet,
    mockUpdateTable,
    mockCountExecuteTakeFirstOrThrow,
    mockCountWhere,
    mockSelectFrom,
    mockFn,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    selectFrom: mockSelectFrom,
    updateTable: mockUpdateTable,
    fn: mockFn,
  },
}));

import { userRepository } from "./user.repository";

describe("userRepository.updateSyncStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCountExecuteTakeFirstOrThrow.mockResolvedValue({ count: 42 });
  });

  it("counts liked songs and updates user record", async () => {
    await userRepository.updateSyncStatus("user-1");

    expect(mockSelectFrom).toHaveBeenCalledWith("likedSong");
    expect(mockCountWhere).toHaveBeenCalledWith("userId", "=", "user-1");
    expect(mockUpdateTable).toHaveBeenCalledWith("user");
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        songCount: 42,
        lastSyncedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      })
    );
    expect(mockWhere).toHaveBeenCalledWith("id", "=", "user-1");
  });
});
