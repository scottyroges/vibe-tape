import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const {
  mockGetByIdFn,
  mockSaveMutate,
  mockDiscardMutate,
  mockRouterPush,
} = vi.hoisted(() => ({
  mockGetByIdFn: vi.fn(),
  mockSaveMutate: vi.fn(),
  mockDiscardMutate: vi.fn(),
  mockRouterPush: vi.fn(),
}));

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual("next/navigation");
  return {
    ...actual,
    useParams: () => ({ id: "pl-1" }),
    useRouter: () => ({ push: mockRouterPush }),
  };
});

vi.mock("@/lib/trpc/client", () => ({
  useTRPC: () => ({
    playlist: {
      getById: {
        queryOptions: () => ({
          queryKey: ["playlist", "getById", { id: "pl-1" }],
          queryFn: mockGetByIdFn,
        }),
        queryKey: () => ["playlist", "getById", { id: "pl-1" }],
      },
      save: {
        mutationOptions: (opts?: { onSuccess?: () => void }) => ({
          mutationFn: mockSaveMutate,
          onSuccess: opts?.onSuccess,
        }),
      },
      discard: {
        mutationOptions: (opts?: { onSuccess?: () => void }) => ({
          mutationFn: mockDiscardMutate,
          onSuccess: opts?.onSuccess,
        }),
      },
    },
  }),
}));

import PlaylistDetailPage, { MAX_POLLS, POLL_INTERVAL_MS } from "./page";

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    ),
  };
}

function makePlaylist(
  overrides: {
    status?: "GENERATING" | "PENDING" | "SAVED" | "FAILED";
    spotifyPlaylistId?: string | null;
    errorMessage?: string | null;
    vibeName?: string;
    userIntent?: string | null;
    tracks?: { id: string; name: string; artistsDisplay: string }[];
    seeds?: { id: string; name: string; artistsDisplay: string }[];
  } = {}
) {
  const tracks = (overrides.tracks ?? [{ id: "g1", name: "Gen Song 1", artistsDisplay: "Art" }]).map((t) => ({
    ...t,
    spotifyId: `sp-${t.id}`,
    album: "Album",
    albumArtUrl: null,
    vibeMood: null,
    vibeEnergy: null,
    vibeDanceability: null,
    vibeGenres: [],
    vibeTags: [],
    vibeVersion: 0,
    vibeUpdatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const seeds = (overrides.seeds ?? [{ id: "s1", name: "Seed A", artistsDisplay: "Artist" }]).map((t) => ({
    ...t,
    spotifyId: `sp-${t.id}`,
    album: "Album",
    albumArtUrl: null,
    vibeMood: null,
    vibeEnergy: null,
    vibeDanceability: null,
    vibeGenres: [],
    vibeTags: [],
    vibeVersion: 0,
    vibeUpdatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  return {
    id: "pl-1",
    userId: "user-1",
    status: overrides.status ?? "PENDING",
    vibeName: overrides.vibeName ?? "Golden Hour",
    vibeDescription: "Windows-down anthems.",
    seedSongIds: seeds.map((s) => s.id),
    generatedTrackIds: tracks.map((t) => t.id),
    targetDurationMinutes: 60,
    userIntent: overrides.userIntent ?? null,
    claudeTarget: null,
    mathTarget: null,
    errorMessage: overrides.errorMessage ?? null,
    spotifyPlaylistId: overrides.spotifyPlaylistId ?? null,
    artImageUrl: null,
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    tracks,
    seeds,
  };
}

describe("PlaylistDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveMutate.mockResolvedValue({ spotifyPlaylistId: "sp-xyz" });
    mockDiscardMutate.mockResolvedValue({ ok: true });
  });

  it("shows the spinner + polling message while GENERATING", async () => {
    mockGetByIdFn.mockResolvedValue(makePlaylist({ status: "GENERATING" }));
    renderWithClient(<PlaylistDetailPage />);

    expect(await screen.findByText(/picking tracks/i)).toBeInTheDocument();
  });

  it("renders Save/Discard buttons and the vibe name for PENDING", async () => {
    mockGetByIdFn.mockResolvedValue(makePlaylist({ status: "PENDING" }));
    renderWithClient(<PlaylistDetailPage />);

    expect(await screen.findByRole("heading", { name: /golden hour/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save to spotify/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^discard$/i })
    ).toBeInTheDocument();
    // Regenerate button is present but disabled (wired in PR G)
    const regen = screen.getByRole("button", { name: /regenerate/i });
    expect(regen).toBeDisabled();
  });

  it("renders 'You said' when userIntent is set", async () => {
    mockGetByIdFn.mockResolvedValue(
      makePlaylist({ status: "PENDING", userIntent: "rainy morning" })
    );
    renderWithClient(<PlaylistDetailPage />);
    expect(await screen.findByText(/you said/i)).toBeInTheDocument();
    expect(screen.getByText(/rainy morning/i)).toBeInTheDocument();
  });

  it("fires playlist.save when Save to Spotify is clicked", async () => {
    const user = userEvent.setup();
    mockGetByIdFn.mockResolvedValue(makePlaylist({ status: "PENDING" }));
    renderWithClient(<PlaylistDetailPage />);

    await screen.findByRole("heading", { name: /golden hour/i });
    await user.click(screen.getByRole("button", { name: /save to spotify/i }));

    const vars = mockSaveMutate.mock.calls[0]![0];
    expect(vars).toEqual({ playlistId: "pl-1" });
  });

  it("fires playlist.discard and redirects to /dashboard", async () => {
    const user = userEvent.setup();
    mockGetByIdFn.mockResolvedValue(makePlaylist({ status: "PENDING" }));
    renderWithClient(<PlaylistDetailPage />);

    await screen.findByRole("heading", { name: /golden hour/i });
    await user.click(screen.getByRole("button", { name: /^discard$/i }));

    expect(mockDiscardMutate.mock.calls[0]![0]).toEqual({ playlistId: "pl-1" });
    await waitFor(() =>
      expect(mockRouterPush).toHaveBeenCalledWith("/dashboard")
    );
  });

  it("renders Open in Spotify link for SAVED playlists", async () => {
    mockGetByIdFn.mockResolvedValue(
      makePlaylist({ status: "SAVED", spotifyPlaylistId: "sp-xyz" })
    );
    renderWithClient(<PlaylistDetailPage />);

    const link = await screen.findByRole("link", { name: /open in spotify/i });
    expect(link).toHaveAttribute(
      "href",
      "https://open.spotify.com/playlist/sp-xyz"
    );
    // "Add more" is present but disabled (wired in PR G)
    const addMore = screen.getByRole("button", { name: /add more/i });
    expect(addMore).toBeDisabled();
    // SAVED playlists should not expose Discard.
    expect(
      screen.queryByRole("button", { name: /^discard$/i })
    ).not.toBeInTheDocument();
  });

  it("renders the error message and Discard button for FAILED", async () => {
    mockGetByIdFn.mockResolvedValue(
      makePlaylist({ status: "FAILED", errorMessage: "Claude timed out" })
    );
    renderWithClient(<PlaylistDetailPage />);

    expect(await screen.findByText(/generation failed/i)).toBeInTheDocument();
    expect(screen.getByText(/claude timed out/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^discard$/i })
    ).toBeInTheDocument();
  });

  it("does not poll when status is not GENERATING", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockGetByIdFn.mockResolvedValue(makePlaylist({ status: "PENDING" }));
      renderWithClient(<PlaylistDetailPage />);

      await screen.findByRole("heading", { name: /golden hour/i });
      const callsAfterInitialFetch = mockGetByIdFn.mock.calls.length;

      // Advance well past the 1s poll interval. If polling were still
      // active we'd see additional queryFn calls.
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockGetByIdFn.mock.calls.length).toBe(callsAfterInitialFetch);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the cap UI after MAX_POLLS and refreshes when Refresh is clicked", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockGetByIdFn.mockResolvedValue(makePlaylist({ status: "GENERATING" }));
      renderWithClient(<PlaylistDetailPage />);

      await screen.findByText(/picking tracks/i);

      // Drive MAX_POLLS worth of 1s ticks, awaiting between each so
      // React Query can actually refetch, the useEffect can increment
      // the counter, and the refetchInterval callback can re-evaluate.
      for (let i = 0; i < MAX_POLLS + 2; i++) {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      }

      await waitFor(() =>
        expect(
          screen.getByText(/taking longer than expected/i)
        ).toBeInTheDocument()
      );
      const refresh = screen.getByRole("button", { name: /refresh/i });
      expect(refresh).toBeInTheDocument();

      // Clicking Refresh should re-run the query. We can't use
      // userEvent here without advancing timers, so dispatch the click
      // via fireEvent-equivalent through the refresh button node.
      const callsBeforeRefresh = mockGetByIdFn.mock.calls.length;
      refresh.click();
      await waitFor(() =>
        expect(mockGetByIdFn.mock.calls.length).toBeGreaterThan(
          callsBeforeRefresh
        )
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders seeds and generated track counts", async () => {
    mockGetByIdFn.mockResolvedValue(
      makePlaylist({
        status: "PENDING",
        tracks: [
          { id: "g1", name: "Gen One", artistsDisplay: "A1" },
          { id: "g2", name: "Gen Two", artistsDisplay: "A2" },
        ],
        seeds: [{ id: "s1", name: "Seed One", artistsDisplay: "A3" }],
      })
    );
    renderWithClient(<PlaylistDetailPage />);

    await screen.findByRole("heading", { name: /golden hour/i });
    expect(screen.getByText(/tracks \(2\)/i)).toBeInTheDocument();
    expect(screen.getByText("Gen One")).toBeInTheDocument();
    expect(screen.getByText("Gen Two")).toBeInTheDocument();
    expect(screen.getByText("Seed One")).toBeInTheDocument();
  });
});
