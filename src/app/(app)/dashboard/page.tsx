"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useTRPC } from "@/lib/trpc/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import styles from "./dashboard.module.css";

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

  return (
    <div className={styles.container}>
      <h1 className={styles.heading}>Dashboard</h1>
      <Link href="/create" className={styles.createButton}>
        Create New Vibe Tape
      </Link>
      <section className={styles.tapesSection}>
        <h2 className={styles.sectionHeading}>Your Vibe Tapes</h2>
        <p className={styles.emptyState}>No vibe tapes yet</p>
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
