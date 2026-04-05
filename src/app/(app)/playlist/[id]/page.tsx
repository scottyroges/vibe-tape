"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";
import { MusicNoteIcon } from "@/components/icons";
import styles from "./playlist.module.css";

/**
 * Poll interval while the playlist is GENERATING. 1s gives the user
 * near-instant feedback (realistic generation takes 3–6 seconds).
 * Exported so tests can drive fake timers precisely.
 */
export const POLL_INTERVAL_MS = 1000;

/**
 * Hard cap on client-side polling as a belt-and-suspenders guard
 * against a stuck GENERATING row whose server-side TTL override also
 * misfires. 120 * 1s = 2 minutes (20× realistic generation time).
 * Exported so tests can match the number without duplicating the
 * constant.
 */
export const MAX_POLLS = 120;

export default function PlaylistDetailPage() {
  const params = useParams<{ id: string }>();
  const playlistId = params.id;
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const pollCountRef = useRef(0);
  const [pollingCapped, setPollingCapped] = useState(false);

  const playlistQuery = useQuery({
    ...trpc.playlist.getById.queryOptions({ id: playlistId }),
    // Keep `refetchInterval` pure — it can be called multiple times per
    // fetch cycle (re-subscription, StrictMode, etc.), so incrementing
    // a counter here would tick faster than wall clock. The actual
    // counter lives in the effect below, keyed on `dataUpdatedAt`.
    refetchInterval: (query) => {
      if (pollingCapped) return false;
      return query.state.data?.status === "GENERATING"
        ? POLL_INTERVAL_MS
        : false;
    },
  });

  // Increment the poll counter exactly once per completed fetch while
  // we're in `GENERATING`. `dataUpdatedAt` advances on every successful
  // refetch, so this useEffect fires once per poll. Once the cap is
  // hit, `refetchInterval` returns `false` and polling stops on the
  // next evaluation.
  useEffect(() => {
    if (playlistQuery.data?.status !== "GENERATING") return;
    pollCountRef.current += 1;
    if (pollCountRef.current >= MAX_POLLS) {
      setPollingCapped(true);
    }
  }, [playlistQuery.dataUpdatedAt, playlistQuery.data?.status]);

  // Reset poll count whenever the playlist id changes.
  useEffect(() => {
    pollCountRef.current = 0;
    setPollingCapped(false);
  }, [playlistId]);

  const saveMutation = useMutation(
    trpc.playlist.save.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.playlist.getById.queryKey({ id: playlistId }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.playlist.listByUser.queryKey(),
        });
      },
    })
  );

  const discardMutation = useMutation(
    trpc.playlist.discard.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.playlist.listByUser.queryKey(),
        });
        router.push("/dashboard");
      },
    })
  );

  // Regenerate and top-up both flip the row to GENERATING server-side,
  // so invalidating `getById` on success picks that up and the existing
  // polling loop kicks in — same UX path as the initial generate.
  const regenerateMutation = useMutation(
    trpc.playlist.regenerate.mutationOptions({
      onSuccess: () => {
        pollCountRef.current = 0;
        setPollingCapped(false);
        queryClient.invalidateQueries({
          queryKey: trpc.playlist.getById.queryKey({ id: playlistId }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.playlist.listByUser.queryKey(),
        });
      },
    })
  );

  const topUpMutation = useMutation(
    trpc.playlist.topUp.mutationOptions({
      onSuccess: () => {
        pollCountRef.current = 0;
        setPollingCapped(false);
        queryClient.invalidateQueries({
          queryKey: trpc.playlist.getById.queryKey({ id: playlistId }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.playlist.listByUser.queryKey(),
        });
      },
    })
  );

  if (playlistQuery.isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.centered}>
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  if (playlistQuery.isError || !playlistQuery.data) {
    return (
      <div className={styles.container}>
        <div className={styles.centered}>
          <p>Couldn&apos;t load this playlist.</p>
          <Link href="/dashboard" className={styles.backLink}>
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const playlist = playlistQuery.data;
  const { status, vibeName, vibeDescription, userIntent, tracks, seeds } =
    playlist;

  // ── GENERATING ────────────────────────────────────────────────────────
  if (status === "GENERATING") {
    return (
      <div className={styles.container}>
        <div className={styles.centered}>
          <div className={styles.spinner} aria-hidden />
          <h1 className={styles.generatingHeading}>
            {pollingCapped
              ? "Taking longer than expected"
              : "Picking tracks…"}
          </h1>
          <p className={styles.generatingSubtext}>
            {pollingCapped
              ? "Generation is running longer than usual. Refresh to check again."
              : "Claude is shaping the vibe from your seeds."}
          </p>
          {pollingCapped && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                pollCountRef.current = 0;
                setPollingCapped(false);
                playlistQuery.refetch();
              }}
            >
              Refresh
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── FAILED ────────────────────────────────────────────────────────────
  if (status === "FAILED") {
    return (
      <div className={styles.container}>
        <div className={styles.centered}>
          <h1 className={styles.heading}>Generation failed</h1>
          <p className={styles.error}>
            {playlist.errorMessage ?? "Something went wrong."}
          </p>
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => discardMutation.mutate({ playlistId })}
              disabled={discardMutation.isPending}
            >
              {discardMutation.isPending ? "Discarding…" : "Discard"}
            </button>
          </div>
          <Link href="/create" className={styles.backLink}>
            Start over
          </Link>
        </div>
      </div>
    );
  }

  // ── PENDING / SAVED shared layout ─────────────────────────────────────
  return (
    <div className={styles.container}>
      {userIntent && (
        <p className={styles.userIntent}>You said: &ldquo;{userIntent}&rdquo;</p>
      )}
      <h1 className={styles.heading}>{vibeName}</h1>
      {vibeDescription && (
        <p className={styles.description}>{vibeDescription}</p>
      )}

      {status === "SAVED" && (
        <p className={styles.savedIndicator}>Synced to Spotify</p>
      )}

      {saveMutation.isError && (
        <p className={styles.error}>
          Couldn&apos;t save to Spotify. Please try again. If this keeps
          happening, check Spotify for an empty playlist you can delete.
        </p>
      )}

      <div className={styles.buttonRow}>
        {status === "PENDING" && (
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => saveMutation.mutate({ playlistId })}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? "Saving…" : "Save to Spotify"}
          </button>
        )}
        {status === "SAVED" && playlist.spotifyPlaylistId && (
          <a
            className={styles.primaryButton}
            href={`https://open.spotify.com/playlist/${playlist.spotifyPlaylistId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Spotify
          </a>
        )}
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => regenerateMutation.mutate({ playlistId })}
          disabled={
            regenerateMutation.isPending || topUpMutation.isPending
          }
        >
          {regenerateMutation.isPending ? "Regenerating…" : "Regenerate"}
        </button>
        {status === "SAVED" && (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => topUpMutation.mutate({ playlistId })}
            disabled={
              topUpMutation.isPending || regenerateMutation.isPending
            }
          >
            {topUpMutation.isPending ? "Adding…" : "Add more"}
          </button>
        )}
        {status === "PENDING" && (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => discardMutation.mutate({ playlistId })}
            disabled={discardMutation.isPending}
          >
            {discardMutation.isPending ? "Discarding…" : "Discard"}
          </button>
        )}
      </div>

      {seeds.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>Seeds</h2>
          <div className={styles.trackList}>
            {seeds.map((t) => (
              <TrackRow
                key={t.id}
                albumArtUrl={t.albumArtUrl}
                title={t.name}
                artist={t.artistsDisplay}
              />
            ))}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>
          Tracks ({tracks.length})
        </h2>
        <div className={styles.trackList}>
          {tracks.map((t) => (
            <TrackRow
              key={t.id}
              albumArtUrl={t.albumArtUrl}
              title={t.name}
              artist={t.artistsDisplay}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function TrackRow({
  albumArtUrl,
  title,
  artist,
}: {
  albumArtUrl: string | null;
  title: string;
  artist: string;
}) {
  return (
    <div className={styles.trackRow}>
      {albumArtUrl ? (
        <img className={styles.albumArt} src={albumArtUrl} alt="" />
      ) : (
        <div className={styles.albumArtPlaceholder}>
          <MusicNoteIcon />
        </div>
      )}
      <div className={styles.trackInfo}>
        <div className={styles.trackName}>{title}</div>
        <div className={styles.artistName}>{artist}</div>
      </div>
    </div>
  );
}
