// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "../helpers/mock-db";

vi.mock("server-only", () => ({}));

const { db, executeTakeFirst, execute, selectFrom } = createMockDb();

vi.mock("@/lib/db", () => ({ db }));

describe("userRepository", () => {
  let userRepository: Awaited<
    typeof import("@/repositories/user.repository")
  >["userRepository"];

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/repositories/user.repository");
    userRepository = mod.userRepository;
  });

  describe("findById", () => {
    it("returns user when found", async () => {
      const expected = {
        id: "u1",
        name: "Test User",
        email: "test@example.com",
        tier: "FREE",
      };
      executeTakeFirst.mockResolvedValue(expected);

      const result = await userRepository.findById("u1");

      expect(result).toEqual(expected);
      expect(selectFrom).toHaveBeenCalledWith("user");
    });

    it("returns null when not found", async () => {
      executeTakeFirst.mockResolvedValue(undefined);

      const result = await userRepository.findById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("findDueForSync", () => {
    it("returns users that do not need reauth", async () => {
      const users = [
        { id: "u1", needsReauth: false },
        { id: "u2", needsReauth: false },
      ];
      execute.mockResolvedValue(users);

      const result = await userRepository.findDueForSync();

      expect(result).toEqual(users);
      expect(selectFrom).toHaveBeenCalledWith("user");
    });
  });
});
