"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useTRPC } from "@/lib/trpc/client";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import styles from "./create.module.css";

const ROW_HEIGHT = 73;

function MusicNoteIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

export default function CreatePage() {
  const trpc = useTRPC();
  const listQuery = useQuery(trpc.library.list.queryOptions());
  const scrollElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    scrollElementRef.current = document.querySelector("[data-scroll-container]");
  }, []);

  const songs = listQuery.data ?? [];

  const virtualizer = useVirtualizer({
    count: songs.length,
    getScrollElement: () => scrollElementRef.current,
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

  return (
    <div className={styles.container}>
      <h1 className={styles.heading}>Choose Songs</h1>
      <div
        className={styles.listContainer}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const song = songs[virtualRow.index]!;
          return (
            <div
              key={song.id}
              className={styles.row}
              style={{
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
