import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Providers } from "./providers";

vi.mock("@/lib/trpc/client", () => ({
  TRPCReactProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="trpc-provider">{children}</div>
  ),
}));

describe("Providers", () => {
  it("renders children", () => {
    render(
      <Providers>
        <span>hello</span>
      </Providers>
    );

    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
