"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTRPC } from "@/lib/trpc/client";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MusicNoteIcon } from "@/components/icons";
import styles from "./create.module.css";

const MAX_SEEDS = 5;
const MIN_SEEDS = 3;

const ROW_HEIGHT = 73;

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default function CreatePage() {
  const trpc = useTRPC();
  const router = useRouter();
  const listQuery = useQuery(trpc.library.list.queryOptions());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const listWrapperRef = useRef<HTMLDivElement>(null);

  const songs = listQuery.data ?? [];

  const filteredSongs = useMemo(() => {
    if (!searchQuery) return songs;
    const query = searchQuery.toLowerCase();
    return songs.filter(
      (song) =>
        song.name.toLowerCase().includes(query) ||
        song.artist.toLowerCase().includes(query)
    );
  }, [songs, searchQuery]);

  useEffect(() => {
    listWrapperRef.current?.scrollTo(0, 0);
  }, [searchQuery]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_SEEDS) {
        next.add(id);
      }
      return next;
    });
  }, []);

  const virtualizer = useVirtualizer({
    count: filteredSongs.length,
    getScrollElement: () => listWrapperRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  if (listQuery.isLoading) {
    return (
      <div className={styles.container}>
        <h1 className={styles.heading}>Choose Songs</h1>
        <div className={styles.centered}>
          <p>Loading your library...</p>
        </div>
      </div>
    );
  }

  if (listQuery.isError) {
    return (
      <div className={styles.container}>
        <h1 className={styles.heading}>Choose Songs</h1>
        <div className={styles.centered}>
          <p>Failed to load your library.</p>
          <button
            className={styles.retryButton}
            onClick={() => listQuery.refetch()}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (songs.length === 0) {
    return (
      <div className={styles.container}>
        <h1 className={styles.heading}>Choose Songs</h1>
        <div className={styles.centered}>
          <p>No songs in your library yet.</p>
          <Link href="/dashboard" className={styles.dashboardLink}>
            Go to dashboard to sync your library
          </Link>
        </div>
      </div>
    );
  }

  const canContinue = selectedIds.size >= MIN_SEEDS;

  return (
    <div className={styles.container}>
      <h1 className={styles.heading}>Choose Songs</h1>
      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search songs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <span className={styles.selectionCount}>
          {selectedIds.size}/{MAX_SEEDS} selected
        </span>
      </div>
      <div ref={listWrapperRef} className={styles.listWrapper}>
        <div
          className={styles.listContainer}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const song = filteredSongs[virtualRow.index]!;
            const isSelected = selectedIds.has(song.id);
            return (
              <div
                key={song.id}
                className={`${styles.row} ${isSelected ? styles.rowSelected : ""}`}
                style={{
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onClick={() => toggleSelection(song.id)}
              >
                {song.albumArtUrl ? (
                  <img
                    className={styles.albumArt}
                    src={song.albumArtUrl}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <div className={styles.albumArtPlaceholder}>
                    <MusicNoteIcon />
                  </div>
                )}
                <div className={styles.trackInfo}>
                  <div className={styles.trackName}>{song.name}</div>
                  <div className={styles.artistName}>{song.artist}</div>
                </div>
                <div className={`${styles.checkmark} ${isSelected ? styles.checkmarkSelected : ""}`}>
                  {isSelected && <CheckIcon />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className={styles.footer}>
        <button
          className={styles.continueButton}
          disabled={!canContinue}
          onClick={() =>
            router.push(
              `/create/confirm?seeds=${Array.from(selectedIds).join(",")}`
            )
          }
        >
          Continue
        </button>
      </div>
    </div>
  );
}
