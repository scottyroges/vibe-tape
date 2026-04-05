"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";
import { MusicNoteIcon } from "@/components/icons";
import type { VibeProfile } from "@/lib/vibe-profile";
import {
  scoreTrackBreakdown,
  type ScoreBreakdown,
} from "@/lib/playlist-scoring";
import type { CanonicalMood } from "@/lib/prompts/classify-tracks";
import styles from "./playlist.module.css";
import { MAX_POLLS, POLL_INTERVAL_MS } from "./constants";

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
  const {
    status,
    vibeName,
    vibeDescription,
    userIntent,
    tracks,
    seedSongIds,
    claudeTarget,
    mathTarget,
  } = playlist;
  // Seed ids are inlined into the track list via a `Seed` badge on each
  // row, so there's no separate seeds section. Seeds are guaranteed to
  // appear in `generatedTrackIds` via `requiredTrackIds` at generation
  // time (see playlist-scoring.ts `rankAndFilter`), so the lookup
  // always resolves.
  const seedIdSet = new Set(seedSongIds);

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

      {(claudeTarget || mathTarget) && (
        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>Vibe targets</h2>
          <div className={styles.targetsGrid}>
            {claudeTarget && (
              <VibeTargetCard label="Claude" target={claudeTarget} />
            )}
            {mathTarget && (
              <VibeTargetCard label="Math (seed centroid)" target={mathTarget} />
            )}
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
              claudeScore={t.claudeScore}
              mathScore={t.mathScore}
              finalScore={t.finalScore}
              vibeProfile={trackVibeProfile(t)}
              claudeTarget={claudeTarget}
              mathTarget={mathTarget}
              isSeed={seedIdSet.has(t.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Narrow a track row's loose DB-shape vibe fields (`string | null`) to
 * the strict `VibeProfile` shape the scoring functions expect. Every
 * populated `vibe_mood` in the DB is guaranteed canonical by the
 * Claude v2 prompt, so the cast is trusted. Returns `null` when the
 * track has no vibe data at all (enrichment hasn't run yet) — callers
 * treat that as "no breakdown to show".
 */
function trackVibeProfile(track: {
  vibeMood: string | null;
  vibeEnergy: string | null;
  vibeDanceability: string | null;
  vibeGenres: string[];
  vibeTags: string[];
  vibeUpdatedAt: Date | string | null;
}): VibeProfile | null {
  if (!track.vibeUpdatedAt) return null;
  return {
    mood: track.vibeMood as CanonicalMood | null,
    energy: track.vibeEnergy as "low" | "medium" | "high" | null,
    danceability: track.vibeDanceability as "low" | "medium" | "high" | null,
    genres: track.vibeGenres,
    tags: track.vibeTags,
  };
}

function TrackRow({
  albumArtUrl,
  title,
  artist,
  claudeScore,
  mathScore,
  finalScore,
  vibeProfile,
  claudeTarget,
  mathTarget,
  isSeed = false,
}: {
  albumArtUrl: string | null;
  title: string;
  artist: string;
  // All three scores are optional so this component works for both
  // generated tracks (always have scores) and legacy rows without
  // persisted scores. When any is null/undefined, the score cell is
  // omitted.
  claudeScore?: number | null;
  mathScore?: number | null;
  finalScore?: number | null;
  // Per-component breakdown inputs. If any is missing, the row stays
  // non-expandable (legacy rows, tracks without vibe data).
  vibeProfile?: VibeProfile | null;
  claudeTarget?: VibeProfile | null;
  mathTarget?: VibeProfile | null;
  // When true, renders a small "Seed" pill next to the title so the
  // user can tell at a glance which tracks in the generated playlist
  // are the ones they originally picked. Seeds are guaranteed to
  // appear in the generated list via `requiredTrackIds`.
  isSeed?: boolean;
}) {
  const hasScores =
    claudeScore != null && mathScore != null && finalScore != null;
  // Only show the expand affordance when we have everything needed to
  // render a meaningful breakdown: the track's vibe profile AND both
  // targets. Partial data leaves the row as a flat summary.
  const canExpand = !!vibeProfile && !!claudeTarget && !!mathTarget;

  const summary = (
    <>
      {albumArtUrl ? (
        <Image
          className={styles.albumArt}
          src={albumArtUrl}
          alt=""
          width={44}
          height={44}
        />
      ) : (
        <div className={styles.albumArtPlaceholder}>
          <MusicNoteIcon />
        </div>
      )}
      <div className={styles.trackInfo}>
        <div className={styles.trackName}>
          {title}
          {isSeed && (
            <span
              className={styles.seedBadge}
              title="One of your seed tracks"
            >
              Seed
            </span>
          )}
        </div>
        <div className={styles.artistName}>{artist}</div>
      </div>
      {hasScores && (
        <div
          className={styles.scoreCell}
          aria-label={`Scores — average ${formatScore(finalScore)}, Claude ${formatScore(claudeScore)}, math ${formatScore(mathScore)}`}
          title={`Claude ${formatScore(claudeScore)} · math ${formatScore(mathScore)}`}
        >
          <div className={styles.scoreFinal}>{formatScore(finalScore)}</div>
          <div className={styles.scoreBreakdown}>
            <span>C {formatScore(claudeScore)}</span>
            <span>M {formatScore(mathScore)}</span>
          </div>
        </div>
      )}
    </>
  );

  if (!canExpand) {
    return <div className={styles.trackRow}>{summary}</div>;
  }

  return (
    <details className={styles.trackRowDetails}>
      <summary className={styles.trackRow}>{summary}</summary>
      <TrackBreakdownPanel
        vibeProfile={vibeProfile}
        claudeTarget={claudeTarget}
        mathTarget={mathTarget}
      />
    </details>
  );
}

/**
 * Expanded details for a generated track: the track's own vibe profile
 * rendered as chips, then a side-by-side table of per-component
 * similarity vs each of the two targets. Columns show similarity and
 * weighted contribution so the user can see where the final score
 * came from.
 */
function TrackBreakdownPanel({
  vibeProfile,
  claudeTarget,
  mathTarget,
}: {
  vibeProfile: VibeProfile;
  claudeTarget: VibeProfile;
  mathTarget: VibeProfile;
}) {
  const claudeBreakdown = scoreTrackBreakdown(vibeProfile, claudeTarget);
  const mathBreakdown = scoreTrackBreakdown(vibeProfile, mathTarget);
  return (
    <div className={styles.trackBreakdown}>
      <div className={styles.trackBreakdownProfile}>
        <div className={styles.trackBreakdownLabel}>Track vibe</div>
        <dl className={styles.targetScalars}>
          {vibeProfile.mood && (
            <>
              <dt>Mood</dt>
              <dd>{vibeProfile.mood}</dd>
            </>
          )}
          {vibeProfile.energy && (
            <>
              <dt>Energy</dt>
              <dd>{vibeProfile.energy}</dd>
            </>
          )}
          {vibeProfile.danceability && (
            <>
              <dt>Dance</dt>
              <dd>{vibeProfile.danceability}</dd>
            </>
          )}
        </dl>
        {vibeProfile.genres.length > 0 && (
          <div className={styles.targetChipGroup}>
            <div className={styles.targetChipGroupLabel}>Genres</div>
            <div className={styles.targetChips}>
              {vibeProfile.genres.map((g) => (
                <span key={g} className={styles.targetChip}>
                  {g}
                </span>
              ))}
            </div>
          </div>
        )}
        {vibeProfile.tags.length > 0 && (
          <div className={styles.targetChipGroup}>
            <div className={styles.targetChipGroupLabel}>Tags</div>
            <div className={styles.targetChips}>
              {vibeProfile.tags.map((t) => (
                <span key={t} className={styles.targetChip}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <BreakdownTable label="Claude" breakdown={claudeBreakdown} />
      <BreakdownTable label="Math" breakdown={mathBreakdown} />
    </div>
  );
}

function BreakdownTable({
  label,
  breakdown,
}: {
  label: string;
  breakdown: ScoreBreakdown;
}) {
  const rows: { name: string; key: keyof Omit<ScoreBreakdown, "total"> }[] = [
    { name: "Mood", key: "mood" },
    { name: "Energy", key: "energy" },
    { name: "Dance", key: "danceability" },
    { name: "Genres", key: "genres" },
    { name: "Tags", key: "tags" },
  ];
  return (
    <div className={styles.breakdownTable}>
      <div className={styles.trackBreakdownLabel}>{label}</div>
      <table>
        <thead>
          <tr>
            <th scope="col" className={styles.breakdownNameCol}>
              Component
            </th>
            <th scope="col">Sim</th>
            <th scope="col">×Wt</th>
            <th scope="col">=Contrib</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ name, key }) => {
            const c = breakdown[key];
            return (
              <tr key={key}>
                <th scope="row" className={styles.breakdownNameCol}>
                  {name}
                </th>
                <td>{formatScore(c.similarity)}</td>
                <td>{c.weight.toFixed(2)}</td>
                <td>{formatScore(c.contribution)}</td>
              </tr>
            );
          })}
          <tr className={styles.breakdownTotalRow}>
            <th scope="row" className={styles.breakdownNameCol}>
              Total
            </th>
            <td />
            <td />
            <td>{formatScore(breakdown.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Scores come back in `[0, 1]`; display as a 2-decimal number. `0.00`
 * and `1.00` both render cleanly with tabular digits so the column
 * aligns.
 */
function formatScore(value: number): string {
  return value.toFixed(2);
}

/**
 * Renders one of the two vibe profile targets (Claude or math) as a
 * compact card: scalar fields stacked, then chip lists for genres and
 * tags. Empty arrays and null scalars are hidden rather than showing
 * "—" so the card only surfaces signals the target actually carries.
 */
function VibeTargetCard({
  label,
  target,
}: {
  label: string;
  target: VibeProfile;
}) {
  return (
    <div className={styles.targetCard}>
      <div className={styles.targetLabel}>{label}</div>
      <dl className={styles.targetScalars}>
        {target.mood && (
          <>
            <dt>Mood</dt>
            <dd>{target.mood}</dd>
          </>
        )}
        {target.energy && (
          <>
            <dt>Energy</dt>
            <dd>{target.energy}</dd>
          </>
        )}
        {target.danceability && (
          <>
            <dt>Dance</dt>
            <dd>{target.danceability}</dd>
          </>
        )}
      </dl>
      {target.genres.length > 0 && (
        <div className={styles.targetChipGroup}>
          <div className={styles.targetChipGroupLabel}>Genres</div>
          <div className={styles.targetChips}>
            {target.genres.map((g) => (
              <span key={g} className={styles.targetChip}>
                {g}
              </span>
            ))}
          </div>
        </div>
      )}
      {target.tags.length > 0 && (
        <div className={styles.targetChipGroup}>
          <div className={styles.targetChipGroupLabel}>Tags</div>
          <div className={styles.targetChips}>
            {target.tags.map((t) => (
              <span key={t} className={styles.targetChip}>
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
