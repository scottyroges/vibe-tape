"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useTRPC } from "@/lib/trpc/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";
import styles from "./dashboard.module.css";

type PlaylistSummary =
  inferRouterOutputs<AppRouter>["playlist"]["listByUser"][number];

export default function DashboardPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const countQuery = useQuery(trpc.library.count.queryOptions());

  const syncStatusQuery = useQuery({
    ...trpc.library.syncStatus.queryOptions(),
    refetchInterval: (query) => {
      return query.state.data?.status === "SYNCING" ? 2000 : false;
    },
  });

  const isSyncing = syncStatusQuery.data?.status === "SYNCING";

  const playlistsQuery = useQuery(trpc.playlist.listByUser.queryOptions());

  const syncMutation = useMutation(
    trpc.library.sync.mutationOptions({
      onSuccess: () => {
        queryClient.setQueryData(trpc.library.syncStatus.queryKey(), { status: "SYNCING" });
      },
    })
  );

  // When sync status transitions from SYNCING to IDLE, refresh the count
  const prevStatusRef = useRef(syncStatusQuery.data?.status);
  useEffect(() => {
    const currentStatus = syncStatusQuery.data?.status;
    if (prevStatusRef.current === "SYNCING" && currentStatus === "IDLE") {
      queryClient.invalidateQueries({ queryKey: trpc.library.count.queryKey() });
      syncMutation.reset();
    }
    prevStatusRef.current = currentStatus;
  }, [syncStatusQuery.data?.status, queryClient, syncMutation, trpc.library.count]);

  const invalidatePlaylists = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.playlist.listByUser.queryKey(),
    });

  const regenerateMutation = useMutation(
    trpc.playlist.regenerate.mutationOptions({
      onSuccess: invalidatePlaylists,
    })
  );
  const topUpMutation = useMutation(
    trpc.playlist.topUp.mutationOptions({
      onSuccess: invalidatePlaylists,
    })
  );
  const discardMutation = useMutation(
    trpc.playlist.discard.mutationOptions({
      onSuccess: invalidatePlaylists,
    })
  );

  const playlists = playlistsQuery.data ?? [];

  // Narrow the busy state to the specific card being mutated. React Query
  // exposes the in-flight variables on the mutation object, so we can
  // compare against each card's id instead of disabling every row.
  const busyPlaylistId =
    (regenerateMutation.isPending && regenerateMutation.variables?.playlistId) ||
    (topUpMutation.isPending && topUpMutation.variables?.playlistId) ||
    (discardMutation.isPending && discardMutation.variables?.playlistId) ||
    null;

  const mutationError =
    regenerateMutation.error ?? topUpMutation.error ?? discardMutation.error;

  return (
    <div className={styles.container}>
      <h1 className={styles.heading}>Dashboard</h1>
      <Link href="/create" className={styles.createButton}>
        Create New Vibe Tape
      </Link>
      <section className={styles.tapesSection}>
        <h2 className={styles.sectionHeading}>Your Vibe Tapes</h2>
        {mutationError && (
          <p className={styles.error} role="alert">
            Couldn&apos;t update that playlist. Please try again.
          </p>
        )}
        {playlistsQuery.isLoading ? (
          <p className={styles.emptyState}>Loading…</p>
        ) : playlists.length === 0 ? (
          <p className={styles.emptyState}>
            No vibe tapes yet. Pick some seeds to create your first one.
          </p>
        ) : (
          <ul className={styles.tapeList}>
            {playlists.map((p) => (
              <PlaylistCard
                key={p.id}
                playlist={p}
                onRegenerate={() =>
                  regenerateMutation.mutate({ playlistId: p.id })
                }
                onTopUp={() => topUpMutation.mutate({ playlistId: p.id })}
                onDiscard={() => discardMutation.mutate({ playlistId: p.id })}
                isBusy={busyPlaylistId === p.id}
              />
            ))}
          </ul>
        )}
      </section>
      <section className={styles.librarySection}>
        <h2 className={styles.sectionHeading}>Library</h2>
        <div className={styles.libraryRow}>
          <span className={styles.count}>
            {countQuery.isLoading
              ? "Loading..."
              : countQuery.isError
                ? "—"
                : `${countQuery.data?.count ?? 0} ${countQuery.data?.count === 1 ? "song" : "songs"}`}
          </span>
          <button
            className={styles.syncButton}
            onClick={() => syncMutation.mutate()}
            disabled={isSyncing || syncMutation.isPending}
          >
            {isSyncing
              ? "Syncing..."
              : syncMutation.isPending
                ? "Starting..."
                : "Sync Library"}
          </button>
        </div>
        {syncStatusQuery.data?.status === "FAILED" && (
          <p className={styles.error}>Last sync failed. Try again.</p>
        )}
        {syncMutation.isError && (
          <p className={styles.error}>Could not start sync. Please try again.</p>
        )}
      </section>
    </div>
  );
}

function PlaylistCard({
  playlist,
  onRegenerate,
  onTopUp,
  onDiscard,
  isBusy,
}: {
  playlist: PlaylistSummary;
  onRegenerate: () => void;
  onTopUp: () => void;
  onDiscard: () => void;
  isBusy: boolean;
}) {
  const { id, vibeName, vibeDescription, status, trackCount, spotifyPlaylistId, createdAt } =
    playlist;
  const dateLabel = new Date(createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const canDiscard = status !== "SAVED";

  return (
    <li className={styles.tapeCard}>
      <Link href={`/playlist/${id}`} className={styles.tapeCardBody}>
        <div className={styles.tapeHeader}>
          <span className={styles.tapeName}>{vibeName}</span>
          <StatusBadge status={status} />
        </div>
        {vibeDescription && (
          <p className={styles.tapeDescription}>{vibeDescription}</p>
        )}
        <p className={styles.tapeMeta}>
          {trackCount} {trackCount === 1 ? "track" : "tracks"} · {dateLabel}
        </p>
      </Link>
      <div className={styles.tapeActions}>
        {status === "SAVED" && spotifyPlaylistId && (
          <a
            className={styles.tapeActionButton}
            href={`https://open.spotify.com/playlist/${spotifyPlaylistId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Spotify
          </a>
        )}
        {(status === "PENDING" || status === "SAVED") && (
          <>
            <button
              type="button"
              className={styles.tapeActionButton}
              onClick={onRegenerate}
              disabled={isBusy}
            >
              Regenerate
            </button>
            <button
              type="button"
              className={styles.tapeActionButton}
              onClick={onTopUp}
              disabled={isBusy}
            >
              Add more
            </button>
          </>
        )}
        {canDiscard && (
          <button
            type="button"
            className={styles.tapeActionButton}
            onClick={onDiscard}
            disabled={isBusy}
          >
            Discard
          </button>
        )}
      </div>
    </li>
  );
}

function StatusBadge({
  status,
}: {
  status: PlaylistSummary["status"];
}) {
  const label =
    status === "GENERATING"
      ? "Generating"
      : status === "PENDING"
        ? "Pending"
        : status === "SAVED"
          ? "Saved"
          : "Failed";
  return (
    <span
      className={styles.statusBadge}
      data-status={status}
      aria-label={`Status: ${label}`}
    >
      {label}
    </span>
  );
}
