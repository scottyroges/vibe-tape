"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTRPC } from "@/lib/trpc/client";
import { useQuery } from "@tanstack/react-query";
import { MusicNoteIcon } from "@/components/icons";
import styles from "./confirm.module.css";

export default function ConfirmPage() {
  const searchParams = useSearchParams();
  const seedIds = searchParams.get("seeds")?.split(",").filter(Boolean) ?? [];
  const trpc = useTRPC();
  const listQuery = useQuery(trpc.library.list.queryOptions());

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
      <div className={styles.comingSoon}>
        <p>Vibe analysis coming soon</p>
      </div>
      <Link href="/create" className={styles.backLink}>
        Back to song picker
      </Link>
    </div>
  );
}
