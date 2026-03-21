import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockMutate, mockSyncStatusFn, mockCountFn } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockSyncStatusFn: vi.fn(),
  mockCountFn: vi.fn(),
}));

// Mock useTRPC to return objects compatible with useQuery/useMutation
vi.mock("@/lib/trpc/client", () => ({
  useTRPC: () => ({
    library: {
      count: {
        queryOptions: () => ({
          queryKey: ["library", "count"],
          queryFn: mockCountFn,
        }),
        queryKey: () => ["library", "count"],
      },
      syncStatus: {
        queryOptions: () => ({
          queryKey: ["library", "syncStatus"],
          queryFn: mockSyncStatusFn,
        }),
        queryKey: () => ["library", "syncStatus"],
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
  return { queryClient, ...render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  ) };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutate.mockResolvedValue({ status: "started" });
    mockSyncStatusFn.mockResolvedValue({ status: "IDLE" });
    mockCountFn.mockResolvedValue({ count: 42 });
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

  it("shows Syncing... and disables button when status is SYNCING", async () => {
    mockSyncStatusFn.mockResolvedValue({ status: "SYNCING" });
    renderWithClient(<DashboardPage />);

    const button = await screen.findByRole("button", { name: /syncing/i });
    expect(button).toBeDisabled();
  });

  it("shows error message when sync status is FAILED", async () => {
    mockSyncStatusFn.mockResolvedValue({ status: "FAILED" });
    renderWithClient(<DashboardPage />);

    expect(await screen.findByText(/last sync failed/i)).toBeInTheDocument();
  });

  it("shows error message when mutation fails", async () => {
    mockMutate.mockRejectedValue(new Error("network error"));
    const user = userEvent.setup();
    renderWithClient(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /sync library/i }));

    expect(await screen.findByText(/could not start sync/i)).toBeInTheDocument();
  });

  it("disables button after clicking sync (optimistic update)", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithClient(<DashboardPage />);

    // Wait for initial render with IDLE status
    await screen.findByRole("button", { name: /sync library/i });

    // Click sync — onSuccess will optimistically set status to SYNCING
    await user.click(screen.getByRole("button", { name: /sync library/i }));

    // The onSuccess handler sets the syncStatus cache to SYNCING,
    // so the button should show "Syncing..." and be disabled
    await waitFor(() => {
      const button = screen.getByRole("button");
      expect(button).toHaveTextContent(/syncing/i);
      expect(button).toBeDisabled();
    });

    // Verify a second click does not fire the mutation again
    const callCount = mockMutate.mock.calls.length;
    await user.click(screen.getByRole("button"));
    expect(mockMutate).toHaveBeenCalledTimes(callCount);
  });

  it("displays singular 'song' for count of 1", async () => {
    mockCountFn.mockResolvedValue({ count: 1 });
    renderWithClient(<DashboardPage />);

    expect(await screen.findByText("1 song")).toBeInTheDocument();
  });
});
