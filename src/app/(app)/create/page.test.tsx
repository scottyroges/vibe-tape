import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockListFn } = vi.hoisted(() => ({
  mockListFn: vi.fn(),
}));

// Mock useVirtualizer — jsdom has no layout engine, so the real virtualizer
// renders zero items. This mock renders all items directly.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 73,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        key: i,
        size: 73,
        start: i * 73,
      })),
  }),
}));

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

import CreatePage from "./page";

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
  lastfmGenres: null,
  bpm: null,
  era: null,
  likedAt: new Date("2024-01-15"),
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-15"),
});

describe("CreatePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure a <main> element exists for the virtualizer scroll container
    document.body.innerHTML = "";
  });

  it("shows loading state while fetching", () => {
    mockListFn.mockReturnValue(new Promise(() => {})); // never resolves
    renderWithClient(<CreatePage />);

    expect(screen.getByText(/loading your library/i)).toBeInTheDocument();
  });

  it("renders song list after data loads", async () => {
    mockListFn.mockResolvedValue([
      makeSong({ id: "t1", name: "Bohemian Rhapsody", artist: "Queen" }),
      makeSong({ id: "t2", name: "Stairway to Heaven", artist: "Led Zeppelin" }),
    ]);
    renderWithClient(<CreatePage />);

    expect(await screen.findByText("Bohemian Rhapsody")).toBeInTheDocument();
    expect(screen.getByText("Queen")).toBeInTheDocument();
    expect(screen.getByText("Stairway to Heaven")).toBeInTheDocument();
    expect(screen.getByText("Led Zeppelin")).toBeInTheDocument();
  });

  it("renders error state with retry button on failure", async () => {
    const user = userEvent.setup();
    mockListFn.mockRejectedValueOnce(new Error("network error"));
    renderWithClient(<CreatePage />);

    expect(await screen.findByText(/failed to load your library/i)).toBeInTheDocument();

    // Retry should call the query again
    mockListFn.mockResolvedValueOnce([makeSong()]);
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("Test Song")).toBeInTheDocument();
  });

  it("renders empty state with link to dashboard when no songs", async () => {
    mockListFn.mockResolvedValue([]);
    renderWithClient(<CreatePage />);

    expect(await screen.findByText(/no songs in your library/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /go to dashboard/i });
    expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("renders album art placeholder when albumArtUrl is null", async () => {
    mockListFn.mockResolvedValue([
      makeSong({ albumArtUrl: null }),
    ]);
    renderWithClient(<CreatePage />);

    await screen.findByText("Test Song");
    // Should not have an img element, should have the SVG placeholder
    expect(document.querySelector("img")).not.toBeInTheDocument();
  });

  it("renders album art image when albumArtUrl is present", async () => {
    mockListFn.mockResolvedValue([
      makeSong({ albumArtUrl: "https://img.spotify.com/cover.jpg" }),
    ]);
    renderWithClient(<CreatePage />);

    await screen.findByText("Test Song");
    const img = document.querySelector("img");
    expect(img).toHaveAttribute("src", "https://img.spotify.com/cover.jpg");
  });
});
