import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockListFn, mockPush } = vi.hoisted(() => ({
  mockListFn: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual("next/navigation");
  return {
    ...actual,
    useRouter: () => ({ push: mockPush }),
  };
});

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
    document.body.innerHTML = "";
    // jsdom doesn't implement scrollTo
    Element.prototype.scrollTo = vi.fn();
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

  it("filters songs by name when searching", async () => {
    const user = userEvent.setup();
    mockListFn.mockResolvedValue([
      makeSong({ id: "t1", name: "Bohemian Rhapsody", artist: "Queen" }),
      makeSong({ id: "t2", name: "Stairway to Heaven", artist: "Led Zeppelin" }),
    ]);
    renderWithClient(<CreatePage />);

    await screen.findByText("Bohemian Rhapsody");
    await user.type(screen.getByPlaceholderText("Search songs..."), "bohemian");

    expect(screen.getByText("Bohemian Rhapsody")).toBeInTheDocument();
    expect(screen.queryByText("Stairway to Heaven")).not.toBeInTheDocument();
  });

  it("filters songs by artist when searching", async () => {
    const user = userEvent.setup();
    mockListFn.mockResolvedValue([
      makeSong({ id: "t1", name: "Bohemian Rhapsody", artist: "Queen" }),
      makeSong({ id: "t2", name: "Stairway to Heaven", artist: "Led Zeppelin" }),
    ]);
    renderWithClient(<CreatePage />);

    await screen.findByText("Bohemian Rhapsody");
    await user.type(screen.getByPlaceholderText("Search songs..."), "zeppelin");

    expect(screen.queryByText("Bohemian Rhapsody")).not.toBeInTheDocument();
    expect(screen.getByText("Stairway to Heaven")).toBeInTheDocument();
  });

  it("search is case-insensitive", async () => {
    const user = userEvent.setup();
    mockListFn.mockResolvedValue([
      makeSong({ id: "t1", name: "Bohemian Rhapsody", artist: "Queen" }),
    ]);
    renderWithClient(<CreatePage />);

    await screen.findByText("Bohemian Rhapsody");
    await user.type(screen.getByPlaceholderText("Search songs..."), "BOHEMIAN");

    expect(screen.getByText("Bohemian Rhapsody")).toBeInTheDocument();
  });

  it("shows all songs when search is cleared", async () => {
    const user = userEvent.setup();
    mockListFn.mockResolvedValue([
      makeSong({ id: "t1", name: "Bohemian Rhapsody", artist: "Queen" }),
      makeSong({ id: "t2", name: "Stairway to Heaven", artist: "Led Zeppelin" }),
    ]);
    renderWithClient(<CreatePage />);

    await screen.findByText("Bohemian Rhapsody");
    const searchInput = screen.getByPlaceholderText("Search songs...");
    await user.type(searchInput, "bohemian");
    await user.clear(searchInput);

    expect(screen.getByText("Bohemian Rhapsody")).toBeInTheDocument();
    expect(screen.getByText("Stairway to Heaven")).toBeInTheDocument();
  });

  it("selects a song on click", async () => {
    mockListFn.mockResolvedValue([
      makeSong({ id: "t1", name: "Bohemian Rhapsody", artist: "Queen" }),
    ]);
    renderWithClient(<CreatePage />);

    const row = (await screen.findByText("Bohemian Rhapsody")).closest("[class*='row']")!;
    await userEvent.click(row);

    expect(row.className).toMatch(/rowSelected/);
  });

  it("deselects a song on second click", async () => {
    mockListFn.mockResolvedValue([
      makeSong({ id: "t1", name: "Bohemian Rhapsody", artist: "Queen" }),
    ]);
    renderWithClient(<CreatePage />);

    const row = (await screen.findByText("Bohemian Rhapsody")).closest("[class*='row']")!;
    await userEvent.click(row);
    expect(row.className).toMatch(/rowSelected/);

    await userEvent.click(row);
    expect(row.className).not.toMatch(/rowSelected/);
  });

  it("prevents selecting more than 5 songs", async () => {
    mockListFn.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) =>
        makeSong({ id: `t${i}`, name: `Song ${i}`, artist: `Artist ${i}` })
      )
    );
    renderWithClient(<CreatePage />);

    await screen.findByText("Song 0");
    // Select 5 songs
    for (let i = 0; i < 5; i++) {
      const row = screen.getByText(`Song ${i}`).closest("[class*='row']")!;
      await userEvent.click(row);
    }

    // Try to select 6th
    const sixthRow = screen.getByText("Song 5").closest("[class*='row']")!;
    await userEvent.click(sixthRow);
    expect(sixthRow.className).not.toMatch(/rowSelected/);

    expect(screen.getByText("5/5 selected")).toBeInTheDocument();
  });

  it("shows correct selection count", async () => {
    mockListFn.mockResolvedValue([
      makeSong({ id: "t1", name: "Song A", artist: "Artist A" }),
      makeSong({ id: "t2", name: "Song B", artist: "Artist B" }),
      makeSong({ id: "t3", name: "Song C", artist: "Artist C" }),
    ]);
    renderWithClient(<CreatePage />);

    await screen.findByText("Song A");
    expect(screen.getByText("0/5 selected")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Song A").closest("[class*='row']")!);
    expect(screen.getByText("1/5 selected")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Song B").closest("[class*='row']")!);
    expect(screen.getByText("2/5 selected")).toBeInTheDocument();
  });

  it("continue button is disabled with fewer than 3 selections", async () => {
    mockListFn.mockResolvedValue([
      makeSong({ id: "t1", name: "Song A", artist: "Artist A" }),
      makeSong({ id: "t2", name: "Song B", artist: "Artist B" }),
    ]);
    renderWithClient(<CreatePage />);

    await screen.findByText("Song A");
    const button = screen.getByRole("button", { name: /continue/i });
    expect(button).toBeDisabled();

    await userEvent.click(screen.getByText("Song A").closest("[class*='row']")!);
    await userEvent.click(screen.getByText("Song B").closest("[class*='row']")!);
    expect(button).toBeDisabled();
  });

  it("continue button is enabled with 3+ selections", async () => {
    mockListFn.mockResolvedValue(
      Array.from({ length: 3 }, (_, i) =>
        makeSong({ id: `t${i}`, name: `Song ${i}`, artist: `Artist ${i}` })
      )
    );
    renderWithClient(<CreatePage />);

    await screen.findByText("Song 0");
    for (let i = 0; i < 3; i++) {
      await userEvent.click(screen.getByText(`Song ${i}`).closest("[class*='row']")!);
    }

    expect(screen.getByRole("button", { name: /continue/i })).not.toBeDisabled();
  });

  it("continue button navigates with selected seed IDs", async () => {
    mockListFn.mockResolvedValue(
      Array.from({ length: 3 }, (_, i) =>
        makeSong({ id: `t${i}`, name: `Song ${i}`, artist: `Artist ${i}` })
      )
    );
    renderWithClient(<CreatePage />);

    await screen.findByText("Song 0");
    for (let i = 0; i < 3; i++) {
      await userEvent.click(screen.getByText(`Song ${i}`).closest("[class*='row']")!);
    }

    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(mockPush).toHaveBeenCalledWith(
      expect.stringMatching(/\/create\/confirm\?seeds=/)
    );
    // Verify all 3 IDs are in the URL
    const url = mockPush.mock.calls[0]![0] as string;
    expect(url).toContain("t0");
    expect(url).toContain("t1");
    expect(url).toContain("t2");
  });
});
