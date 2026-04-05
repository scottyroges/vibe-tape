import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const {
  mockMutate,
  mockSyncStatusFn,
  mockCountFn,
  mockListPlaylistsFn,
  mockRegenerateFn,
  mockTopUpFn,
  mockDiscardFn,
} = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockSyncStatusFn: vi.fn(),
  mockCountFn: vi.fn(),
  mockListPlaylistsFn: vi.fn(),
  mockRegenerateFn: vi.fn(),
  mockTopUpFn: vi.fn(),
  mockDiscardFn: vi.fn(),
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
    playlist: {
      listByUser: {
        queryOptions: () => ({
          queryKey: ["playlist", "listByUser"],
          queryFn: mockListPlaylistsFn,
        }),
        queryKey: () => ["playlist", "listByUser"],
      },
      regenerate: {
        mutationOptions: (opts?: { onSuccess?: () => void }) => ({
          mutationFn: mockRegenerateFn,
          onSuccess: opts?.onSuccess,
        }),
      },
      topUp: {
        mutationOptions: (opts?: { onSuccess?: () => void }) => ({
          mutationFn: mockTopUpFn,
          onSuccess: opts?.onSuccess,
        }),
      },
      discard: {
        mutationOptions: (opts?: { onSuccess?: () => void }) => ({
          mutationFn: mockDiscardFn,
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
    mockListPlaylistsFn.mockResolvedValue([]);
    mockRegenerateFn.mockResolvedValue({ playlistId: "p1" });
    mockTopUpFn.mockResolvedValue({ playlistId: "p1" });
    mockDiscardFn.mockResolvedValue({ ok: true });
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
    renderWithClient(<DashboardPage />);

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

  it("renders Create New Vibe Tape link to /create", () => {
    renderWithClient(<DashboardPage />);
    const link = screen.getByRole("link", { name: /create new vibe tape/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/create");
  });

  it("renders Your Vibe Tapes section heading", () => {
    renderWithClient(<DashboardPage />);
    expect(screen.getByRole("heading", { name: /your vibe tapes/i })).toBeInTheDocument();
  });

  it("renders empty state when no vibe tapes exist", async () => {
    renderWithClient(<DashboardPage />);
    expect(await screen.findByText(/no vibe tapes yet/i)).toBeInTheDocument();
  });

  describe("Your Vibe Tapes list", () => {
    const basePlaylist = {
      id: "p1",
      vibeName: "Night Drive",
      vibeDescription: "late, humming",
      status: "PENDING" as const,
      spotifyPlaylistId: null,
      trackCount: 18,
      createdAt: new Date("2026-04-02").toISOString(),
    };

    it("renders a card per playlist with name, description, track count, and status badge", async () => {
      mockListPlaylistsFn.mockResolvedValue([
        basePlaylist,
        {
          ...basePlaylist,
          id: "p2",
          vibeName: "Saved Mix",
          vibeDescription: "chill afternoon",
          status: "SAVED",
          spotifyPlaylistId: "sp-xyz",
          trackCount: 1,
        },
      ]);

      renderWithClient(<DashboardPage />);

      expect(await screen.findByText("Night Drive")).toBeInTheDocument();
      expect(screen.getByText("late, humming")).toBeInTheDocument();
      expect(screen.getByText("chill afternoon")).toBeInTheDocument();
      expect(screen.getByText(/18 tracks/)).toBeInTheDocument();
      expect(screen.getByText(/^1 track ·/)).toBeInTheDocument();
      expect(
        screen.getByLabelText("Status: Pending")
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText("Status: Saved")
      ).toBeInTheDocument();
    });

    it("shows Open in Spotify only for SAVED playlists", async () => {
      mockListPlaylistsFn.mockResolvedValue([
        basePlaylist, // PENDING
        {
          ...basePlaylist,
          id: "p2",
          vibeName: "Saved Mix",
          status: "SAVED",
          spotifyPlaylistId: "sp-xyz",
        },
      ]);

      renderWithClient(<DashboardPage />);

      await screen.findByText("Night Drive");
      const spotifyLinks = screen.getAllByRole("link", {
        name: /open in spotify/i,
      });
      expect(spotifyLinks).toHaveLength(1);
      expect(spotifyLinks[0]).toHaveAttribute(
        "href",
        "https://open.spotify.com/playlist/sp-xyz"
      );
    });

    it("shows Regenerate + Add more for PENDING and SAVED, hides for GENERATING/FAILED", async () => {
      mockListPlaylistsFn.mockResolvedValue([
        { ...basePlaylist, id: "p1", status: "PENDING" },
        {
          ...basePlaylist,
          id: "p2",
          status: "SAVED",
          spotifyPlaylistId: "sp",
        },
        { ...basePlaylist, id: "p3", status: "GENERATING" },
        { ...basePlaylist, id: "p4", status: "FAILED" },
      ]);

      renderWithClient(<DashboardPage />);

      await screen.findAllByText("Night Drive");
      expect(
        screen.getAllByRole("button", { name: /regenerate/i })
      ).toHaveLength(2);
      expect(
        screen.getAllByRole("button", { name: /add more/i })
      ).toHaveLength(2);
    });

    it("hides Discard on SAVED playlists", async () => {
      mockListPlaylistsFn.mockResolvedValue([
        { ...basePlaylist, id: "p1", status: "PENDING" },
        {
          ...basePlaylist,
          id: "p2",
          status: "SAVED",
          spotifyPlaylistId: "sp",
        },
      ]);

      renderWithClient(<DashboardPage />);

      await screen.findAllByText("Night Drive");
      expect(
        screen.getAllByRole("button", { name: /discard/i })
      ).toHaveLength(1);
    });

    it("invalidates the list query after a regenerate mutation", async () => {
      mockListPlaylistsFn.mockResolvedValue([basePlaylist]);
      const user = userEvent.setup();
      const { queryClient } = renderWithClient(<DashboardPage />);

      await screen.findByText("Night Drive");
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      await user.click(screen.getByRole("button", { name: /regenerate/i }));

      await waitFor(() => {
        expect(mockRegenerateFn).toHaveBeenCalledWith(
          { playlistId: "p1" },
          expect.anything()
        );
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ["playlist", "listByUser"],
        });
      });
    });

    it("only disables actions on the card whose mutation is in-flight", async () => {
      mockListPlaylistsFn.mockResolvedValue([
        { ...basePlaylist, id: "p1", vibeName: "First" },
        { ...basePlaylist, id: "p2", vibeName: "Second" },
      ]);
      // Keep the mutation pending so we can observe the in-flight state.
      let resolveRegenerate: (v: unknown) => void;
      mockRegenerateFn.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRegenerate = resolve;
          })
      );

      const user = userEvent.setup();
      renderWithClient(<DashboardPage />);

      await screen.findByText("First");

      // Click Regenerate on the first card.
      const [firstRegenerate] = screen.getAllByRole("button", {
        name: /regenerate/i,
      });
      await user.click(firstRegenerate!);

      // First card's actions should be disabled; second card's should not.
      await waitFor(() => {
        const [first, second] = screen.getAllByRole("button", {
          name: /regenerate/i,
        });
        expect(first!).toBeDisabled();
        expect(second!).not.toBeDisabled();
      });

      resolveRegenerate!({ playlistId: "p1" });
    });

    it("surfaces an error when a mutation fails", async () => {
      mockListPlaylistsFn.mockResolvedValue([basePlaylist]);
      mockRegenerateFn.mockRejectedValue(new Error("network down"));
      const user = userEvent.setup();
      renderWithClient(<DashboardPage />);

      await screen.findByText("Night Drive");
      await user.click(screen.getByRole("button", { name: /regenerate/i }));

      expect(
        await screen.findByText(/couldn't update that playlist/i)
      ).toBeInTheDocument();
    });

    it("links each card to /playlist/{id}", async () => {
      mockListPlaylistsFn.mockResolvedValue([basePlaylist]);
      renderWithClient(<DashboardPage />);

      const link = await screen.findByRole("link", { name: /night drive/i });
      expect(link).toHaveAttribute("href", "/playlist/p1");
    });
  });

  it("renders Library section heading", () => {
    renderWithClient(<DashboardPage />);
    expect(screen.getByRole("heading", { name: /library/i })).toBeInTheDocument();
  });
});
