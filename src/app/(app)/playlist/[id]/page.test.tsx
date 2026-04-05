import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const {
  mockGetByIdFn,
  mockSaveMutate,
  mockDiscardMutate,
  mockRegenerateMutate,
  mockTopUpMutate,
  mockRemoveTrackMutate,
  mockRouterPush,
} = vi.hoisted(() => ({
  mockGetByIdFn: vi.fn(),
  mockSaveMutate: vi.fn(),
  mockDiscardMutate: vi.fn(),
  mockRegenerateMutate: vi.fn(),
  mockTopUpMutate: vi.fn(),
  mockRemoveTrackMutate: vi.fn(),
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
      regenerate: {
        mutationOptions: (opts?: { onSuccess?: () => void }) => ({
          mutationFn: mockRegenerateMutate,
          onSuccess: opts?.onSuccess,
        }),
      },
      topUp: {
        mutationOptions: (opts?: { onSuccess?: () => void }) => ({
          mutationFn: mockTopUpMutate,
          onSuccess: opts?.onSuccess,
        }),
      },
      removeTrack: {
        mutationOptions: (opts?: { onSuccess?: () => void }) => ({
          mutationFn: mockRemoveTrackMutate,
          onSuccess: opts?.onSuccess,
        }),
      },
      listByUser: {
        queryKey: () => ["playlist", "listByUser"],
      },
    },
  }),
}));

import PlaylistDetailPage from "./page";
import { MAX_POLLS, POLL_INTERVAL_MS } from "./constants";

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
    tracks?: {
      id: string;
      name: string;
      artistsDisplay: string;
      claudeScore?: number | null;
      mathScore?: number | null;
      finalScore?: number | null;
      // Vibe fields — when set, the row becomes expandable (provided
      // the playlist also carries both targets).
      vibeMood?: string | null;
      vibeEnergy?: "low" | "medium" | "high" | null;
      vibeDanceability?: "low" | "medium" | "high" | null;
      vibeGenres?: string[];
      vibeTags?: string[];
      vibeUpdatedAt?: Date | null;
    }[];
    seeds?: { id: string; name: string; artistsDisplay: string }[];
    claudeTarget?: {
      mood: string | null;
      energy: "low" | "medium" | "high" | null;
      danceability: "low" | "medium" | "high" | null;
      genres: string[];
      tags: string[];
    } | null;
    mathTarget?: {
      mood: string | null;
      energy: "low" | "medium" | "high" | null;
      danceability: "low" | "medium" | "high" | null;
      genres: string[];
      tags: string[];
    } | null;
  } = {}
) {
  const tracks = (overrides.tracks ?? [{ id: "g1", name: "Gen Song 1", artistsDisplay: "Art" }]).map((t) => ({
    ...t,
    spotifyId: `sp-${t.id}`,
    album: "Album",
    albumArtUrl: null,
    vibeMood: t.vibeMood ?? null,
    vibeEnergy: t.vibeEnergy ?? null,
    vibeDanceability: t.vibeDanceability ?? null,
    vibeGenres: t.vibeGenres ?? [],
    vibeTags: t.vibeTags ?? [],
    vibeVersion: 0,
    vibeUpdatedAt: t.vibeUpdatedAt ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    // Scores default to `null` — matches the router response for
    // legacy rows that pre-date the `trackScores` column. Tests
    // exercising the score display override these explicitly.
    claudeScore: t.claudeScore ?? null,
    mathScore: t.mathScore ?? null,
    finalScore: t.finalScore ?? null,
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
    claudeTarget:
      overrides.claudeTarget === undefined ? null : overrides.claudeTarget,
    mathTarget:
      overrides.mathTarget === undefined ? null : overrides.mathTarget,
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
    mockRegenerateMutate.mockResolvedValue({ playlistId: "pl-1" });
    mockTopUpMutate.mockResolvedValue({ playlistId: "pl-1" });
    mockRemoveTrackMutate.mockResolvedValue({ ok: true });
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
    // Regenerate is wired in PR G and enabled for PENDING playlists.
    const regen = screen.getByRole("button", { name: /regenerate/i });
    expect(regen).toBeEnabled();
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

  it("fires playlist.regenerate when Regenerate is clicked on a PENDING playlist", async () => {
    const user = userEvent.setup();
    mockGetByIdFn.mockResolvedValue(makePlaylist({ status: "PENDING" }));
    renderWithClient(<PlaylistDetailPage />);

    await screen.findByRole("heading", { name: /golden hour/i });
    await user.click(screen.getByRole("button", { name: /regenerate/i }));

    expect(mockRegenerateMutate.mock.calls[0]![0]).toEqual({
      playlistId: "pl-1",
    });
  });

  it("fires playlist.topUp when Add more is clicked on a SAVED playlist", async () => {
    const user = userEvent.setup();
    mockGetByIdFn.mockResolvedValue(
      makePlaylist({ status: "SAVED", spotifyPlaylistId: "sp-xyz" })
    );
    renderWithClient(<PlaylistDetailPage />);

    await screen.findByRole("link", { name: /open in spotify/i });
    await user.click(screen.getByRole("button", { name: /add more/i }));

    expect(mockTopUpMutate.mock.calls[0]![0]).toEqual({ playlistId: "pl-1" });
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
    // "Add more" is wired in PR G and enabled for SAVED playlists.
    const addMore = screen.getByRole("button", { name: /add more/i });
    expect(addMore).toBeEnabled();
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

  it("renders generated track list with the total count", async () => {
    mockGetByIdFn.mockResolvedValue(
      makePlaylist({
        status: "PENDING",
        tracks: [
          { id: "g1", name: "Gen One", artistsDisplay: "A1" },
          { id: "g2", name: "Gen Two", artistsDisplay: "A2" },
        ],
        // Seeds are guaranteed to also be in `generatedTrackIds` at
        // generation time, so the test mirrors that: the seed id is
        // present in both arrays. The Seed badge assertion lives in
        // its own test below.
        seeds: [{ id: "g1", name: "Gen One", artistsDisplay: "A1" }],
      })
    );
    renderWithClient(<PlaylistDetailPage />);

    await screen.findByRole("heading", { name: /golden hour/i });
    expect(screen.getByText(/tracks \(2\)/i)).toBeInTheDocument();
    expect(screen.getByText("Gen One")).toBeInTheDocument();
    expect(screen.getByText("Gen Two")).toBeInTheDocument();
  });

  it("marks seed tracks inline with a Seed badge and omits the badge elsewhere", async () => {
    mockGetByIdFn.mockResolvedValue(
      makePlaylist({
        status: "PENDING",
        tracks: [
          { id: "g1", name: "Gen One", artistsDisplay: "A1" },
          { id: "g2", name: "Gen Two", artistsDisplay: "A2" },
          { id: "g3", name: "Gen Three", artistsDisplay: "A3" },
        ],
        // Two of the three tracks are seeds — the helper derives
        // `seedSongIds` from this list, and the ids overlap with
        // entries in `tracks` (mirroring the real generation flow
        // where seeds are passed as `requiredTrackIds`).
        seeds: [
          { id: "g1", name: "Gen One", artistsDisplay: "A1" },
          { id: "g3", name: "Gen Three", artistsDisplay: "A3" },
        ],
      })
    );
    renderWithClient(<PlaylistDetailPage />);

    await screen.findByText("Gen One");

    // No separate Seeds section/heading should exist anywhere.
    expect(
      screen.queryByRole("heading", { name: /^seeds/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/seeds \(\d+\)/i)).not.toBeInTheDocument();

    // Two seed badges render — one per seed track.
    const seedBadges = screen.getAllByText(/^seed$/i);
    expect(seedBadges).toHaveLength(2);

    // Each badge sits next to the correct track's name. Walk up from
    // the badge to its trackInfo container and confirm it's the one
    // whose title text we expect.
    const badgeTitles = seedBadges
      .map((b) => {
        const trackName = b.closest('[class*="trackName"]');
        return trackName?.textContent ?? "";
      })
      .sort();
    // Each badge's parent element's textContent is the title + "Seed"
    // concatenated, so match on substring.
    expect(badgeTitles[0]).toContain("Gen One");
    expect(badgeTitles[1]).toContain("Gen Three");

    // The non-seed track ("Gen Two") must NOT have a badge sibling.
    const genTwo = screen.getByText("Gen Two");
    const genTwoRow = genTwo.closest('[class*="trackRow"]');
    expect(genTwoRow?.textContent).not.toContain("Seed");
  });

  it("renders per-track score triples on generated tracks", async () => {
    mockGetByIdFn.mockResolvedValue(
      makePlaylist({
        status: "PENDING",
        tracks: [
          {
            id: "g1",
            name: "Scored Track",
            artistsDisplay: "The Band",
            claudeScore: 0.81,
            mathScore: 0.72,
            finalScore: 0.765,
          },
        ],
      })
    );
    renderWithClient(<PlaylistDetailPage />);

    await screen.findByText("Scored Track");
    // Final score rendered with 2 decimals (rounds 0.765 → 0.77 via toFixed).
    expect(screen.getByText("0.77")).toBeInTheDocument();
    // Claude + math breakdown shows the raw per-component numbers.
    expect(screen.getByText(/C 0\.81/)).toBeInTheDocument();
    expect(screen.getByText(/M 0\.72/)).toBeInTheDocument();
  });

  it("renders Claude + math vibe target cards when both are set", async () => {
    mockGetByIdFn.mockResolvedValue(
      makePlaylist({
        status: "PENDING",
        claudeTarget: {
          mood: "uplifting",
          energy: "high",
          danceability: "high",
          genres: ["hip-hop", "pop"],
          tags: ["summer"],
        },
        mathTarget: {
          mood: "peaceful",
          energy: "medium",
          danceability: null,
          genres: ["indie"],
          tags: [],
        },
      })
    );
    renderWithClient(<PlaylistDetailPage />);

    await screen.findByRole("heading", { name: /vibe targets/i });
    // Both labels render.
    expect(screen.getByText(/^claude$/i)).toBeInTheDocument();
    expect(screen.getByText(/math \(seed centroid\)/i)).toBeInTheDocument();
    // Scalar moods from each target.
    expect(screen.getByText("uplifting")).toBeInTheDocument();
    expect(screen.getByText("peaceful")).toBeInTheDocument();
    // Genre chips from both sides.
    expect(screen.getByText("hip-hop")).toBeInTheDocument();
    expect(screen.getByText("indie")).toBeInTheDocument();
  });

  it("renders a per-track vibe + score breakdown when expanded", async () => {
    mockGetByIdFn.mockResolvedValue(
      makePlaylist({
        status: "PENDING",
        claudeTarget: {
          mood: "uplifting",
          energy: "high",
          danceability: "high",
          genres: ["pop", "rock"],
          tags: ["summer"],
        },
        mathTarget: {
          mood: "uplifting",
          energy: "medium",
          danceability: "high",
          genres: ["pop"],
          tags: [],
        },
        tracks: [
          {
            id: "g1",
            name: "Scored Track",
            artistsDisplay: "The Band",
            claudeScore: 0.7,
            mathScore: 0.6,
            finalScore: 0.65,
            // Populated vibe profile makes this row expandable.
            vibeMood: "uplifting",
            vibeEnergy: "high",
            vibeDanceability: "high",
            vibeGenres: ["pop"],
            vibeTags: ["summer"],
            vibeUpdatedAt: new Date(),
          },
        ],
      })
    );
    renderWithClient(<PlaylistDetailPage />);

    await screen.findByText("Scored Track");

    // The track row is a <details>; the breakdown tables live inside
    // it but are rendered even when collapsed. Both Claude and math
    // breakdown labels should appear (one per BreakdownTable heading).
    const claudeLabels = screen.getAllByText(/^claude$/i);
    const mathLabels = screen.getAllByText(/^math$/i);
    // One from Vibe-targets card, one from the breakdown table.
    expect(claudeLabels.length).toBeGreaterThanOrEqual(1);
    expect(mathLabels.length).toBeGreaterThanOrEqual(1);

    // Breakdown table headings exist.
    expect(screen.getAllByText(/component/i).length).toBeGreaterThan(0);
    // "Total" row header appears for each of the two breakdown tables.
    expect(screen.getAllByText("Total")).toHaveLength(2);
  });

  it("leaves the row non-expandable when the track has no vibe profile", async () => {
    mockGetByIdFn.mockResolvedValue(
      makePlaylist({
        status: "PENDING",
        claudeTarget: {
          mood: "uplifting",
          energy: "high",
          danceability: "high",
          genres: ["pop"],
          tags: [],
        },
        mathTarget: {
          mood: "uplifting",
          energy: "high",
          danceability: "high",
          genres: ["pop"],
          tags: [],
        },
        tracks: [
          {
            id: "g1",
            name: "Unclassified",
            artistsDisplay: "The Band",
            claudeScore: 0.5,
            mathScore: 0.5,
            finalScore: 0.5,
            // vibeUpdatedAt null → trackVibeProfile returns null → no expand.
          },
        ],
      })
    );
    renderWithClient(<PlaylistDetailPage />);

    await screen.findByText("Unclassified");
    // No breakdown table exists for this row.
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
  });

  it("does not render the targets section when both targets are null", async () => {
    mockGetByIdFn.mockResolvedValue(
      makePlaylist({
        status: "PENDING",
        claudeTarget: null,
        mathTarget: null,
      })
    );
    renderWithClient(<PlaylistDetailPage />);

    await screen.findByRole("heading", { name: /golden hour/i });
    expect(
      screen.queryByRole("heading", { name: /vibe targets/i })
    ).not.toBeInTheDocument();
  });

  it("omits the score cell when the track has no persisted scores", async () => {
    mockGetByIdFn.mockResolvedValue(
      makePlaylist({
        status: "PENDING",
        tracks: [
          { id: "g1", name: "Legacy Track", artistsDisplay: "The Band" },
        ],
      })
    );
    renderWithClient(<PlaylistDetailPage />);

    await screen.findByText("Legacy Track");
    // No `C 0.xx` / `M 0.xx` text anywhere for a row without scores.
    expect(screen.queryByText(/C 0\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/M 0\./)).not.toBeInTheDocument();
  });

  it("fires playlist.removeTrack when the × button is clicked on a PENDING row", async () => {
    const user = userEvent.setup();
    mockGetByIdFn.mockResolvedValue(
      makePlaylist({
        status: "PENDING",
        tracks: [
          { id: "g1", name: "Keeper", artistsDisplay: "A1" },
          { id: "g2", name: "Goner", artistsDisplay: "A2" },
        ],
      }),
    );
    renderWithClient(<PlaylistDetailPage />);

    await screen.findByText("Goner");
    const removeButton = screen.getByRole("button", {
      name: /remove goner from playlist/i,
    });
    await user.click(removeButton);

    await waitFor(() => {
      expect(mockRemoveTrackMutate).toHaveBeenCalledTimes(1);
    });
    expect(mockRemoveTrackMutate.mock.calls[0]![0]).toEqual({
      playlistId: "pl-1",
      trackId: "g2",
    });
  });

  it("still shows the × button on SAVED playlists", async () => {
    mockGetByIdFn.mockResolvedValue(
      makePlaylist({
        status: "SAVED",
        spotifyPlaylistId: "sp-xyz",
        tracks: [{ id: "g1", name: "Track", artistsDisplay: "Artist" }],
      }),
    );
    renderWithClient(<PlaylistDetailPage />);

    await screen.findByText("Track");
    expect(
      screen.getByRole("button", { name: /remove track from playlist/i }),
    ).toBeInTheDocument();
  });

  it("does not render the × button on FAILED playlists", async () => {
    mockGetByIdFn.mockResolvedValue(
      makePlaylist({
        status: "FAILED",
        errorMessage: "boom",
        tracks: [{ id: "g1", name: "Track", artistsDisplay: "Artist" }],
      }),
    );
    renderWithClient(<PlaylistDetailPage />);

    // FAILED shows the error UI, not the track list — the button
    // should not exist anywhere in the document.
    await screen.findByText(/generation failed/i);
    expect(
      screen.queryByRole("button", { name: /remove .* from playlist/i }),
    ).not.toBeInTheDocument();
  });
});
