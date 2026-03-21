"use client";

import { authClient } from "@/lib/auth-client";
import styles from "./page.module.css";

export default function LoginPage() {
  function handleLogin() {
    authClient.signIn.social({
      provider: "spotify",
      callbackURL: "/dashboard",
    });
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>Vibe Tape</h1>
      <p className={styles.subtitle}>
        Pick a few songs. Discover the vibe. Generate the playlist.
      </p>
      <button className={styles.button} onClick={handleLogin}>
        Continue with Spotify
      </button>
    </div>
  );
}
