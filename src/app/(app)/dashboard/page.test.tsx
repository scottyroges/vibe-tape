import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockMutate } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
}));

// Mock useTRPC to return objects compatible with useQuery/useMutation
vi.mock("@/lib/trpc/client", () => ({
  useTRPC: () => ({
    library: {
      count: {
        queryOptions: () => ({
          queryKey: ["library", "count"],
          queryFn: () => Promise.resolve({ count: 42 }),
        }),
        queryKey: () => ["library", "count"],
      },
      sync: {
        mutationOptions: (opts?: { onSuccess?: () => void }) => ({
          mutationFn: mockMutate,
          onSuccess: opts?.onSuccess,
        }),
      },
    },
  }),
}));

import DashboardPage from "./page";

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutate.mockResolvedValue({ status: "started" });
  });

  it("renders the dashboard heading", () => {
    renderWithClient(<DashboardPage />);
    expect(screen.getByRole("heading", { name: /dashboard/i })).toBeInTheDocument();
  });

  it("displays song count after loading", async () => {
    renderWithClient(<DashboardPage />);
    expect(await screen.findByText("42 songs")).toBeInTheDocument();
  });

  it("renders sync library button", () => {
    renderWithClient(<DashboardPage />);
    expect(screen.getByRole("button", { name: /sync library/i })).toBeInTheDocument();
  });

  it("calls sync mutation on button click", async () => {
    const user = userEvent.setup();
    renderWithClient(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /sync library/i }));

    expect(mockMutate).toHaveBeenCalled();
  });
});
