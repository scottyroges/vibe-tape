"use client";

import { useTRPC } from "@/lib/trpc/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import styles from "./dashboard.module.css";

export default function DashboardPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const countQuery = useQuery(trpc.library.count.queryOptions());

  const syncMutation = useMutation(
    trpc.library.sync.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.library.count.queryKey() });
      },
    })
  );

  return (
    <div className={styles.container}>
      <h1 className={styles.heading}>Dashboard</h1>
      <div className={styles.stats}>
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
          disabled={syncMutation.isPending}
        >
          {syncMutation.isPending ? "Syncing..." : "Sync Library"}
        </button>
      </div>
      {syncMutation.isError && (
        <p className={styles.error}>Sync failed. Please try again.</p>
      )}
    </div>
  );
}
