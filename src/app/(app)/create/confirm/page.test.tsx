import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockListFn, mockGet } = vi.hoisted(() => ({
  mockListFn: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual("next/navigation");
  return {
    ...actual,
    useSearchParams: () => ({ get: mockGet }),
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

const makeSong = (overrides: Partial<{ id: string; name: string; artist: string; albumArtUrl: string | null }> = {}) => ({
  id: overrides.id ?? "t1",
  spotifyId: "sp1",
  name: overrides.name ?? "Test Song",
  artist: overrides.artist ?? "Test Artist",
  album: "Test Album",
  albumArtUrl: "albumArtUrl" in overrides ? (overrides.albumArtUrl ?? null) : "https://img.spotify.com/cover.jpg",
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

describe("ConfirmPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays selected seed songs from URL params", async () => {
    mockGet.mockReturnValue("t1,t2,t3");
    mockListFn.mockResolvedValue([
      makeSong({ id: "t1", name: "Song A", artist: "Artist A" }),
      makeSong({ id: "t2", name: "Song B", artist: "Artist B" }),
      makeSong({ id: "t3", name: "Song C", artist: "Artist C" }),
      makeSong({ id: "t4", name: "Song D", artist: "Artist D" }),
    ]);
    renderWithClient(<ConfirmPage />);

    expect(await screen.findByText("Song A")).toBeInTheDocument();
    expect(screen.getByText("Song B")).toBeInTheDocument();
    expect(screen.getByText("Song C")).toBeInTheDocument();
    expect(screen.queryByText("Song D")).not.toBeInTheDocument();
  });

  it("shows coming soon message", async () => {
    mockGet.mockReturnValue("t1,t2,t3");
    mockListFn.mockResolvedValue([
      makeSong({ id: "t1" }),
      makeSong({ id: "t2" }),
      makeSong({ id: "t3" }),
    ]);
    renderWithClient(<ConfirmPage />);

    expect(await screen.findByText(/vibe analysis coming soon/i)).toBeInTheDocument();
  });

  it("shows back link to song picker", async () => {
    mockGet.mockReturnValue("t1,t2,t3");
    mockListFn.mockResolvedValue([
      makeSong({ id: "t1" }),
      makeSong({ id: "t2" }),
      makeSong({ id: "t3" }),
    ]);
    renderWithClient(<ConfirmPage />);

    await screen.findByText(/vibe analysis coming soon/i);
    const link = screen.getByRole("link", { name: /back to song picker/i });
    expect(link).toHaveAttribute("href", "/create");
  });

  it("shows error when fewer than 3 seeds provided", () => {
    mockGet.mockReturnValue("t1,t2");
    renderWithClient(<ConfirmPage />);

    expect(screen.getByText(/please select 3–5 seed songs/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to song picker/i })).toHaveAttribute("href", "/create");
  });

  it("shows error when no seeds provided", () => {
    mockGet.mockReturnValue(null);
    renderWithClient(<ConfirmPage />);

    expect(screen.getByText(/please select 3–5 seed songs/i)).toBeInTheDocument();
  });
});
