import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockListFn, mockGenerateMutate, mockGet, mockRouterPush } = vi.hoisted(
  () => ({
    mockListFn: vi.fn(),
    mockGenerateMutate: vi.fn(),
    mockGet: vi.fn(),
    mockRouterPush: vi.fn(),
  })
);

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual("next/navigation");
  return {
    ...actual,
    useSearchParams: () => ({ get: mockGet }),
    useRouter: () => ({ push: mockRouterPush }),
  };
});

vi.mock("@/lib/trpc/client", () => ({
  useTRPC: () => ({
    library: {
      list: {
        queryOptions: () => ({
          queryKey: ["library", "list"],
          queryFn: mockListFn,
        }),
      },
    },
    playlist: {
      generate: {
        mutationOptions: (opts?: {
          onSuccess?: (data: { playlistId: string }) => void;
        }) => ({
          mutationFn: mockGenerateMutate,
          onSuccess: opts?.onSuccess,
        }),
      },
    },
  }),
}));

import ConfirmPage from "./page";

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

const makeSong = (
  overrides: Partial<{
    id: string;
    name: string;
    artist: string;
    albumArtUrl: string | null;
  }> = {}
) => ({
  id: overrides.id ?? "t1",
  spotifyId: "sp1",
  name: overrides.name ?? "Test Song",
  artist: overrides.artist ?? "Test Artist",
  album: "Test Album",
  albumArtUrl:
    "albumArtUrl" in overrides
      ? (overrides.albumArtUrl ?? null)
      : "https://img.spotify.com/cover.jpg",
  vibeMood: null,
  vibeEnergy: null,
  vibeDanceability: null,
  vibeGenres: [],
  vibeTags: [],
  vibeVersion: 0,
  vibeUpdatedAt: null,
  likedAt: new Date("2024-01-15"),
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-15"),
});

const SONGS = [
  makeSong({ id: "t1", name: "Song A" }),
  makeSong({ id: "t2", name: "Song B" }),
  makeSong({ id: "t3", name: "Song C" }),
];

describe("ConfirmPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListFn.mockResolvedValue(SONGS);
    mockGenerateMutate.mockResolvedValue({ playlistId: "pl-1" });
  });

  it("displays selected seed songs from URL params", async () => {
    mockGet.mockReturnValue("t1,t2,t3");
    renderWithClient(<ConfirmPage />);

    expect(await screen.findByText("Song A")).toBeInTheDocument();
    expect(screen.getByText("Song B")).toBeInTheDocument();
    expect(screen.getByText("Song C")).toBeInTheDocument();
  });

  it("renders duration presets and the Generate button", async () => {
    mockGet.mockReturnValue("t1,t2,t3");
    renderWithClient(<ConfirmPage />);

    await screen.findByText("Song A");
    expect(screen.getByRole("button", { name: /30min/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^1hr$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /generate playlist/i })
    ).toBeInTheDocument();
  });

  it("fires playlist.generate with selected seeds and default 60min duration", async () => {
    const user = userEvent.setup();
    mockGet.mockReturnValue("t1,t2,t3");
    renderWithClient(<ConfirmPage />);

    await screen.findByText("Song A");
    await user.click(
      screen.getByRole("button", { name: /generate playlist/i })
    );

    // React Query's mutationFn receives `(variables, context)`; we only
    // care about the first arg here.
    const vars = mockGenerateMutate.mock.calls[0]![0];
    expect(vars).toEqual({
      seedTrackIds: ["t1", "t2", "t3"],
      targetDurationMinutes: 60,
    });
  });

  it("sends a custom duration when a preset is clicked", async () => {
    const user = userEvent.setup();
    mockGet.mockReturnValue("t1,t2,t3");
    renderWithClient(<ConfirmPage />);

    await screen.findByText("Song A");
    await user.click(screen.getByRole("button", { name: /^90min$/i }));
    await user.click(
      screen.getByRole("button", { name: /generate playlist/i })
    );

    const vars = mockGenerateMutate.mock.calls[0]![0];
    expect(vars).toMatchObject({ targetDurationMinutes: 90 });
  });

  it("sends userIntent when the textarea is non-empty", async () => {
    const user = userEvent.setup();
    mockGet.mockReturnValue("t1,t2,t3");
    renderWithClient(<ConfirmPage />);

    await screen.findByText("Song A");
    await user.type(
      screen.getByLabelText(/tell us the vibe/i),
      "rainy morning"
    );
    await user.click(
      screen.getByRole("button", { name: /generate playlist/i })
    );

    const vars = mockGenerateMutate.mock.calls[0]![0];
    expect(vars).toMatchObject({ userIntent: "rainy morning" });
  });

  it("omits userIntent key when the textarea is blank", async () => {
    const user = userEvent.setup();
    mockGet.mockReturnValue("t1,t2,t3");
    renderWithClient(<ConfirmPage />);

    await screen.findByText("Song A");
    await user.click(
      screen.getByRole("button", { name: /generate playlist/i })
    );

    const call = mockGenerateMutate.mock.calls[0]![0];
    expect(call).not.toHaveProperty("userIntent");
  });

  it("disables the Generate button while the mutation is in-flight", async () => {
    const user = userEvent.setup();
    mockGet.mockReturnValue("t1,t2,t3");
    // Never-resolving mutation so isPending stays true.
    mockGenerateMutate.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<ConfirmPage />);

    await screen.findByText("Song A");
    const btn = screen.getByRole("button", { name: /generate playlist/i });
    expect(btn).toBeEnabled();

    await user.click(btn);

    // React Query flips `isPending` synchronously when `mutate` is called,
    // so the disabled state should appear on the next render.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /generating/i })
      ).toBeDisabled()
    );
  });

  it("redirects to /playlist/[id] on success", async () => {
    const user = userEvent.setup();
    mockGet.mockReturnValue("t1,t2,t3");
    renderWithClient(<ConfirmPage />);

    await screen.findByText("Song A");
    await user.click(
      screen.getByRole("button", { name: /generate playlist/i })
    );

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith("/playlist/pl-1");
    });
  });

  it("shows character counter for user intent", async () => {
    const user = userEvent.setup();
    mockGet.mockReturnValue("t1,t2,t3");
    renderWithClient(<ConfirmPage />);

    await screen.findByText("Song A");
    expect(screen.getByText("0/280")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/tell us the vibe/i), "hi");
    expect(screen.getByText("2/280")).toBeInTheDocument();
  });

  it("shows error when fewer than 3 seeds provided", () => {
    mockGet.mockReturnValue("t1,t2");
    renderWithClient(<ConfirmPage />);

    expect(
      screen.getByText(/please select 3–5 seed songs/i)
    ).toBeInTheDocument();
  });

  it("shows error when no seeds provided", () => {
    mockGet.mockReturnValue(null);
    renderWithClient(<ConfirmPage />);

    expect(
      screen.getByText(/please select 3–5 seed songs/i)
    ).toBeInTheDocument();
  });
});
