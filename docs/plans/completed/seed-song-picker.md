# Seed Song Picker UI

**Status:** Done
**Created:** 2026-03-21
**Goal:** Build a searchable, mobile-first song picker page where users select 3–5 seed songs from their liked library to start creating a vibe tape. Refactor the dashboard to show existing vibe tapes and a "Create New" CTA.

---

## Phase 1 — Virtualized Song List

New route `/create` that displays the user's full liked library in a fast, scrollable list. Read-only — validates virtualization works with the app-shell scroll container.

- [x] Install `@tanstack/react-virtual` for virtualized scrolling
- [x] Create `/create` route with song picker page
- [x] Update `library.list` query to sort by most recently liked (join `likedSong.likedAt`, order descending)
- [x] Virtualized list rendering — only mount visible rows. **Note:** TanStack Virtual's `scrollElement` must target the app-shell `.main` container (which has `overflow-y: auto`), not `window`.
- [x] Loading and error states — spinner while fetching, error message with retry on failure
- [x] Empty state — if no songs, show message with link to dashboard to sync library
- [x] Mobile-first layout — full-width list items, large tap targets
- [x] Show album art thumbnail (placeholder icon if null), song name, artist per row
- [x] Add tests for list rendering

**PR:** "Add virtualized song list page"

---

## Phase 2 — Search and Selection

Add search filtering and seed selection interactivity on top of the song list.

- [x] Search/filter bar — client-side filter by song name and artist (instant on 1k+ items), sticky at top
- [x] Selection UI — tap to select/deselect, visual indicator (checkmark, highlight)
- [x] Selection constraints — min 3, max 5 seeds. Show count (e.g., "3/5 selected")
- [x] "Continue" button — disabled until 3+ selected, navigates to `/create/confirm?seeds=id1,id2,...` with selected track IDs as URL params
- [x] Create placeholder `/create/confirm` page — reads seed IDs from URL params, shows selected seed summary with "Coming soon" message (future: vibe analysis)
- [x] Add tests for search filtering, selection logic, and constraints

**PR:** "Add search and seed selection to song picker"

---

## Phase 3 — Dashboard Refactor

Restructure the dashboard from a sync-focused page to the main hub: show existing vibe tapes and a prominent "Create New" button.

- [x] Move sync button to a secondary/settings position (still accessible, not the hero)
- [x] Add "Create New Vibe Tape" button — links to `/create`
- [x] Add placeholder section for existing vibe tapes (empty state for now — "No vibe tapes yet")
- [x] Keep song count visible
- [x] Add tests for updated dashboard layout

**PR:** "Refactor dashboard as vibe tape hub with create button"

---

## Decisions

- **Client-side search** — with ~1,500 songs, filtering in the browser is instant. No server-side search needed until libraries exceed 10k+.
- **Virtualized list** — TanStack Virtual renders only visible rows. Handles 10k+ items smoothly without DOM bloat.
- **3–5 seed constraint** — enforced in the UI. The "Continue" button is disabled below 3, selection is blocked above 5.
- **No component library** — CSS modules (existing pattern) + TanStack Virtual. Keep it lightweight.
- **Song data already available** — `library.list` tRPC query exists. Needs a sort update but no new endpoints.
- **Sort order** — most recently liked first (by `likedSong.likedAt` desc). Matches Spotify's default library view.
- **Empty library** — inline empty state with link to dashboard to sync. Don't redirect or duplicate the sync button.
- **Null album art** — show a placeholder music note icon. Keeps row heights uniform for virtualization.
- **Selection persistence** — React state on the picker page, encoded as URL params when navigating to `/create/confirm`. No localStorage or server state needed.
- **Dashboard stays client component** — it's mostly interactive (sync button, polling, mutations). Convert to server component later when vibe tapes need server-side data fetching.

## Open Questions

- None — all resolved:
  - Route: `/create` (picker) → `/create/confirm` (seed summary)
  - Selection persistence: React state on picker page, passed as URL params to confirm page
  - "Continue" flow: navigates to `/create/confirm?seeds=...` placeholder page until vibe analysis (item 4) is built
