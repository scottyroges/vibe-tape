// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetSessionCookie = vi.fn();

vi.mock("better-auth/cookies", () => ({
  getSessionCookie: (...args: unknown[]) => mockGetSessionCookie(...args),
}));

import { middleware } from "@/middleware";

function createRequest(path: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

describe("middleware", () => {
  beforeEach(() => {
    mockGetSessionCookie.mockReset();
  });

  it("redirects unauthenticated users from /dashboard to /login", () => {
    mockGetSessionCookie.mockReturnValue(null);

    const response = middleware(createRequest("/dashboard"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });

  it("allows unauthenticated users to access /", () => {
    mockGetSessionCookie.mockReturnValue(null);

    const response = middleware(createRequest("/"));

    expect(response.status).toBe(200);
  });

  it("allows unauthenticated users to access /login", () => {
    mockGetSessionCookie.mockReturnValue(null);

    const response = middleware(createRequest("/login"));

    expect(response.status).toBe(200);
  });

  it("allows unauthenticated users to access /api/auth/callback/spotify", () => {
    mockGetSessionCookie.mockReturnValue(null);

    const response = middleware(createRequest("/api/auth/callback/spotify"));

    expect(response.status).toBe(200);
  });

  it("allows unauthenticated users to access /api/trpc/health.ping", () => {
    mockGetSessionCookie.mockReturnValue(null);

    const response = middleware(createRequest("/api/trpc/health.ping"));

    expect(response.status).toBe(200);
  });

  it("allows unauthenticated users to access shared vibe cards at /vibe/abc", () => {
    mockGetSessionCookie.mockReturnValue(null);

    const response = middleware(createRequest("/vibe/abc123"));

    expect(response.status).toBe(200);
  });

  it("allows authenticated users to access /dashboard", () => {
    mockGetSessionCookie.mockReturnValue("session-token");

    const response = middleware(createRequest("/dashboard"));

    expect(response.status).toBe(200);
  });
});
