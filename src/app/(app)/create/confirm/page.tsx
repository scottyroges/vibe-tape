"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTRPC } from "@/lib/trpc/client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MusicNoteIcon } from "@/components/icons";
import styles from "./confirm.module.css";

const DURATION_PRESETS = [30, 60, 90, 120] as const;
const DEFAULT_DURATION_MINUTES = 60;
const USER_INTENT_MAX_LENGTH = 280;

export default function ConfirmPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const seedIds = searchParams.get("seeds")?.split(",").filter(Boolean) ?? [];
  const trpc = useTRPC();
  const listQuery = useQuery(trpc.library.list.queryOptions());

  const [durationMinutes, setDurationMinutes] = useState<number>(
    DEFAULT_DURATION_MINUTES
  );
  const [userIntent, setUserIntent] = useState("");

  const generateMutation = useMutation(
    trpc.playlist.generate.mutationOptions({
      onSuccess: (data) => {
        router.push(`/playlist/${data.playlistId}`);
      },
    })
  );

  if (seedIds.length < 3 || seedIds.length > 5) {
    return (
      <div className={styles.container}>
        <h1 className={styles.heading}>Invalid Selection</h1>
        <div className={styles.centered}>
          <p>Please select 3–5 seed songs.</p>
          <Link href="/create" className={styles.backLink}>
            Back to song picker
          </Link>
        </div>
      </div>
    );
  }

  if (listQuery.isLoading) {
    return (
      <div className={styles.container}>
        <h1 className={styles.heading}>Your Seeds</h1>
        <div className={styles.centered}>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  const seeds = (listQuery.data ?? []).filter((song) =>
    seedIds.includes(song.id)
  );

  const trimmedIntent = userIntent.trim();
  const canGenerate = seeds.length >= 3 && !generateMutation.isPending;

  const handleGenerate = () => {
    if (!canGenerate) return;
    generateMutation.mutate({
      seedTrackIds: seedIds,
      targetDurationMinutes: durationMinutes,
      ...(trimmedIntent.length > 0 ? { userIntent: trimmedIntent } : {}),
    });
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.heading}>Your Seeds</h1>
      <div className={styles.seedList}>
        {seeds.map((song) => (
          <div key={song.id} className={styles.seedRow}>
            {song.albumArtUrl ? (
              <img
                className={styles.albumArt}
                src={song.albumArtUrl}
                alt=""
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
        ))}
      </div>

      <div className={styles.section}>
        <label className={styles.sectionLabel}>Playlist length</label>
        <div className={styles.durationPresets}>
          {DURATION_PRESETS.map((mins) => (
            <button
              key={mins}
              type="button"
              className={
                durationMinutes === mins
                  ? `${styles.durationButton} ${styles.durationButtonActive}`
                  : styles.durationButton
              }
              onClick={() => setDurationMinutes(mins)}
              disabled={generateMutation.isPending}
            >
              {mins % 60 === 0 ? `${mins / 60}hr` : `${mins}min`}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <label htmlFor="vibe-intent" className={styles.sectionLabel}>
          Tell us the vibe (optional)
        </label>
        <textarea
          id="vibe-intent"
          className={styles.vibeInput}
          placeholder="e.g. rainy Sunday coffee shop, or getting hyped for a run"
          value={userIntent}
          onChange={(e) => setUserIntent(e.target.value)}
          maxLength={USER_INTENT_MAX_LENGTH}
          rows={3}
          disabled={generateMutation.isPending}
        />
        <div className={styles.charCount}>
          {userIntent.length}/{USER_INTENT_MAX_LENGTH}
        </div>
      </div>

      <button
        type="button"
        className={styles.generateButton}
        onClick={handleGenerate}
        disabled={!canGenerate}
      >
        {generateMutation.isPending ? "Generating..." : "Generate playlist"}
      </button>

      {generateMutation.isError && (
        <p className={styles.error}>
          Couldn&apos;t start generation. Please try again.
        </p>
      )}

      <Link href="/create" className={styles.backLink}>
        Back to song picker
      </Link>
    </div>
  );
}
